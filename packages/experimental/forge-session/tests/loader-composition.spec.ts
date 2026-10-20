/** Real Loader and AgentLoop composition; only the model and the GitHub CLI are fixtures. */

import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalBashExecutor from '@deepseek-ai/dsh-bash-local'
import ForgeService from '@deepseek-ai/dsh-experimental-forge'
import * as ForgeGitHub from '@deepseek-ai/dsh-experimental-forge-github'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { pluginRecordOf, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory'
import ForgeSessionService from '../src/index.ts'
import type { SessionChangeRequest, SessionChangeRequestsListener } from '../src/index.ts'

/** GitHub CLI fixture: `pr create` prints PR 8; `api graphql` answers the head lookup and snapshot queries. */
const FAKE_GH = String.raw`
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(new URL('./gh.log', import.meta.url), JSON.stringify(args) + '\n')
const reply = (data) => { process.stdout.write(JSON.stringify({ data })); process.exit(0) }
if (args[0] === 'pr' && args[1] === 'create') {
  process.stdout.write('https://github.com/octo/demo/pull/8\n')
  process.stderr.write('\nCreating pull request for other into main in octo/demo\n\n')
  process.exit(0)
}
if (args[0] !== 'api' || args[1] !== 'graphql') {
  process.stderr.write('unexpected gh invocation\n')
  process.exit(2)
}
const fields = Object.fromEntries(args.flatMap((arg, index) => args[index - 1] === '-f' ? [[arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]] : []))
if ('branch' in fields) {
  reply({ repository: { defaultBranchRef: { name: 'main' }, pullRequests: { nodes: fields.branch === 'feat' ? [{ number: 7, isCrossRepository: false }] : [] } } })
}
const node = (number) => ({
  number,
  url: 'https://github.com/octo/demo/pull/' + number,
  title: 'Change ' + number,
  state: 'OPEN',
  isDraft: false,
  updatedAt: '2026-10-09T00:00:00Z',
  author: { login: 'octo' },
  headRefName: number === 7 ? 'feat' : 'other',
  headRefOid: 'a'.repeat(40),
  baseRefName: 'main',
  mergeable: 'MERGEABLE',
  reviewDecision: null,
  reviewThreads: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: {
    state: number === 7 ? 'PENDING' : 'SUCCESS',
    contexts: { pageInfo: { hasNextPage: false }, nodes: [{
      __typename: 'CheckRun', name: 'test', status: number === 7 ? 'IN_PROGRESS' : 'COMPLETED', conclusion: number === 7 ? null : 'SUCCESS',
      detailsUrl: null, checkSuite: { workflowRun: { workflow: { name: 'ci' } } },
    }] },
  } } }] },
})
const data = {}
let repository
for (const match of fields.query.matchAll(/(r\d+): repository\(|(p\d+): pullRequest\(number: (\d+)\)/g)) {
  if (match[1] !== undefined) data[repository = match[1]] = {}
  else data[repository][match[2]] = node(Number(match[3]))
}
reply(data)
`

/** `git push` fixture printing the refs a new branch push reports. */
const FAKE_GIT = `#!/bin/sh
printf 'To github.com:octo/demo.git\\n * [new branch]      feat -> feat\\n' >&2
`

class ScriptedModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly commands: readonly string[]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const command = this.commands[this.requests.length - 1]
    if (command !== undefined) {
      const call = { type: 'tool-call' as const, id: ToolCallId(`shell-${this.requests.length}`), name: 'bash', arguments: JSON.stringify({ command, description: 'Run the scripted command' }) }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: call }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Pushed and opened the pull request.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const suite = process.platform === 'win32' ? describe.skip : describe

suite('forge-session through a real cordis.yml Loader composition', () => {
  it('binds the pull requests that bash pushes discover and creates, and polls them through the GitHub provider', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-forge-session-loader-')))
    const bin = join(root, 'bin')
    await mkdir(bin)
    await writeFile(join(root, 'fake-gh.mjs'), FAKE_GH)
    await writeFile(join(bin, 'gh'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(root, 'fake-gh.mjs'))} "$@"\n`)
    await writeFile(join(bin, 'git'), FAKE_GIT)
    await chmod(join(bin, 'gh'), 0o755)
    await chmod(join(bin, 'git'), 0o755)

    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-llm', LlmRuntime],
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
      ['@deepseek-ai/dsh-working-directory', WorkingDirectoryService],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-agent-loop', AgentLoop],
      ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
      ['@deepseek-ai/dsh-shell-env', ShellEnv],
      ['@deepseek-ai/dsh-bash-local', LocalBashExecutor],
      ['@deepseek-ai/dsh-tool-bash', ToolBash],
      ['@deepseek-ai/dsh-experimental-forge', ForgeService],
      ['@deepseek-ai/dsh-experimental-forge-github', ForgeGitHub],
      ['@deepseek-ai/dsh-experimental-forge-session', ForgeSessionService],
    ])
    const configs: Record<string, readonly string[]> = {
      '@deepseek-ai/dsh-agent-loop': ['agents: []'],
      '@deepseek-ai/dsh-shell-env': [`dshHome: ${JSON.stringify(join(root, 'dsh-home'))}`],
      '@deepseek-ai/dsh-bash-local': ['timeoutMs: 20000'],
      '@deepseek-ai/dsh-experimental-forge': ['activeIntervalMs: 600000', 'idleIntervalMs: 600000'],
      '@deepseek-ai/dsh-experimental-forge-github': [`ghCommand: ${JSON.stringify(join(bin, 'gh'))}`],
      '@deepseek-ai/dsh-experimental-forge-session': ['discoveryTimeoutMs: 20000'],
    }
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [...modules.keys()].flatMap(name => [
      `- name: 'cordis:${name}'`,
      ...name in configs ? ['  config:', ...(configs[name] ?? []).map(line => `    ${line}`)] : [],
    ]).join('\n') + '\n')

    const ctx = context = new Context()
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    for (const [specifier, plugin] of modules) ctx.loader.builtins[specifier] = plugin
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    for (const entry of ctx.loader.entries()) await entry.fiber?.await()

    const path = `PATH=${JSON.stringify(`${bin}:`)}"$PATH"`
    const model = new ScriptedModel([`${path} git push -u origin feat`, `${path} gh pr create --fill --head other`])
    ctx.llm.registerAdapter(['fixture'], model)
    const agent = await ctx.agentLoop.create(SessionId('forge-session-loader'), { provider: 'fixture', model: 'fixture' }, { cwd: root })
    const idle: PromiseWithResolvers<void> = Promise.withResolvers()
    const stop = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') idle.resolve()
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Push feat and open a pull request.' }], source: { kind: 'user' } }))
    await idle.promise
    stop()

    expect(model.requests).toHaveLength(3)
    const github = (number: number) => ({ repository: { forge: 'github', host: 'github.com', owner: 'octo', name: 'demo' }, number })
    const records = () => agent.session.snapshotEvents().flatMap((event) => {
      const record = pluginRecordOf(event)
      return record === undefined ? [] : [record.data]
    })
    await vi.waitFor(() => { expect(records()).toEqual([
      { action: 'discover', url: 'https://github.com/octo/demo/pull/7' },
    ]) })
    const byUrl = (entries: readonly SessionChangeRequest[]) => [...entries].sort((left, right) => left.url.localeCompare(right.url))
    expect(byUrl(ctx.forgeSession.changeRequests(agent.session))).toEqual([
      { url: 'https://github.com/octo/demo/pull/7', origin: 'discovered', ref: github(7), update: null },
      { url: 'https://github.com/octo/demo/pull/8', origin: 'created', ref: github(8), update: null },
    ])
    const lookups = (await readFile(join(root, 'gh.log'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[])
    expect(lookups.find(args => args.includes('branch=feat'))).toEqual(expect.arrayContaining(['--hostname', 'github.com', 'owner=octo', 'name=demo']))

    const listener = vi.fn<SessionChangeRequestsListener>()
    ctx.forgeSession.watch(agent.session, listener)
    await vi.waitFor(() => { expect(byUrl(listener.mock.lastCall?.[0] ?? []).map(entry => entry.update !== null && 'snapshot' in entry.update
      ? [entry.update.snapshot.title, entry.update.snapshot.checksRollup]
      : null)).toEqual([['Change 7', 'pending'], ['Change 8', 'success']]) })

    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === 'cordis:@deepseek-ai/dsh-experimental-forge-session')
    await entry?.fiber?.dispose()
    expect(ctx.sessionProjections.checkpoint(agent.session)).not.toHaveProperty('forgeChangeRequests')
  }, 60_000)
})

/** Real package installation and Loader/HMR; only Creator output is scripted. */
import { mkdtemp, mkdir, writeFile, readFile, rename, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { boot, initProfile, loadProfileDirectory, readProfilePatches, readProfileManifest, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import Hmr from '@deepseek-ai/dsh-hmr'
import PluginManager from '@deepseek-ai/dsh-plugin-manager'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm, { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Access from '@deepseek-ai/dsh-api-remote-access'
import type { SubagentActivation, SubagentActivationSpec } from '@deepseek-ai/dsh-subagent'
import Recommendations from '../src/index.ts'
import type { CreationView } from '../src/types.ts'
import { writeBundle } from './fixture.ts'

it.each(['portable-bundle', 'foreign-nested-row'] as const)('validates and installs through pnpm/HMR: %s', async (scenario) => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-creation-loader-'))
  let owner: Context | undefined
  onTestFinished(async () => { await owner?.fiber.dispose(); await rm(home, { recursive: true, force: true }) })
  const dir = join(home, 'profiles', 'test')
  const base = join(home, 'fixture-base')
  const anchor = join(home, 'package.json')
  await mkdir(base)
  await writeFile(anchor, JSON.stringify({ name: 'installation', dependencies: {} }))
  await writeFile(join(base, 'package.json'), JSON.stringify({ name: 'fixture-base', version: '1.0.0',
    dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  await writeFile(join(base, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    ['session', 'sessions'], ['projection', 'projections'], ['llm', 'llm'], ['prompt', 'prompt'],
    ['tools', 'tools'], ['agents', 'agents'], ['access', 'access'], ['manager', 'manager'],
    ['recommendations', 'recommendations'],
  ].map(([id, name]) => ({ id, name: 'cordis:' + name! })) }]))
  initProfile(dir, ['fixture-base'])
  const manifestPath = join(dir, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
  await writeFile(manifestPath, JSON.stringify({ ...manifest, dependencies: { 'fixture-base': 'file:' + base } }))
  await mkdir(join(dir, 'node_modules'))
  await symlink(base, join(dir, 'node_modules', 'fixture-base'), 'junction')
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', dir, home, cwd: home, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: anchor,
    startedBundles: loadProfileDirectory('test', dir, anchor).layers.map(layer => layer.packageName),
    overlays: [], telemetryDisabledEnv: undefined,
  }
  const starts: SubagentActivationSpec[] = []
  const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (ctx) => {
    owner = ctx
    ctx.provide('profileContext', profile)
    ctx.provide('appReady', { onReady: (listener) => { listener(); return () => {} } })
    ctx.provide('subagents', { startActivation: async (spec: SubagentActivationSpec): Promise<SubagentActivation & { childId: SessionId }> => {
      starts.push(spec)
      const instructions = JSON.parse(spec.request.prompt.find(block => block.type === 'text')!.text) as { packageName: string }
      await writeBundle(spec.request.cwd!, instructions.packageName)
      if (scenario === 'foreign-nested-row') {
        await writeFile(join(spec.request.cwd!, 'cordis.patch.yml'), JSON.stringify([{ insert: [{
          id: instructions.packageName + ':group', name: instructions.packageName, group: true,
          config: [{ id: 'access', name: instructions.packageName }],
        }] }]))
      } else {
        await rename(join(spec.request.cwd!, 'index.js'), join(spec.request.cwd!, 'runtime.mjs'))
        await symlink('./runtime.mjs', join(spec.request.cwd!, 'index.js'))
      }
      return { childId: spec.childId!, dispose: async () => {},
        result: Promise.resolve({ output: [], stopReason: 'completed', structured: { ready: true } }) }
    } })
    Object.assign(ctx.loader.builtins, { sessions: Sessions, projections: Projections, llm: Llm, prompt: SystemPrompt,
      tools: Tools, agents: Agents, access: Access, manager: PluginManager, recommendations: Recommendations })
  })
  await ctx.plugin(Timer)
  await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
  await ctx.hmr.runExclusive(async () => {})
  await ctx.plugin(AgentLoop, { agents: [] })
  const agent = await ctx.agentLoop.create(SessionId('creation-live'))
  const callId = ToolCallId('create-live')
  const result = await ctx.tools.execute({ name: 'suggest_view', callId, agent, signal: new AbortController().signal,
    arguments: { title: 'Counter', brief: 'Keep a counter in the right sidebar.', slot: 'sidebar-right' } })
  expect(result.isError).toBe(false)
  agent.session.append('tool/result', { turn: 1, step: 1,
    message: createToolResultMessage({ callId, content: result.content, isError: result.isError }),
    ...result.meta === undefined ? {} : { meta: result.meta },
  }, { surfaceOp: 'append' })
  const receipt = () => (ctx.sessionProjections.snapshot(agent.session).values.creationRecommendations as CreationView).decisions[callId]
  expect(starts).toHaveLength(0)
  const access = [...ctx.loader.entries()].find(entry => entry.options.id === 'access')
  expect(await ctx.creationRecommendations.act(agent, callId, 'create', 'page')).toEqual({ status: 'accepted' })
  if (scenario === 'foreign-nested-row') {
    await vi.waitFor(() => { expect(receipt()?.phase).toBe('failed') })
    expect([...ctx.loader.entries()].find(entry => entry.options.id === 'access')).toBe(access)
    expect(access?.options.name).toBe('cordis:access')
    expect(access?.fiber).toBeDefined()
    expect(readProfileManifest('test', dir).dsh?.profile?.bundles).toEqual(['fixture-base'])
    return
  }
  await vi.waitFor(() => { expect(receipt()?.phase).toBe('installed') }, { timeout: 20_000 })
  expect(receipt()?.application).toBe('applied')
  expect(starts[0]?.request.agentPreset).toBe('cordis')
  expect(starts[0]?.request.cwd?.startsWith(join(home, '.dsh-created-plugins'))).toBe(true)
  await rm(starts[0]!.request.cwd!, { recursive: true })
  const name = receipt()!.bundleName!
  await ctx.pluginManager.setBundleEnabled(name, false)
  expect((await ctx.pluginManager.setBundleEnabled(name, true)).application).toBe('applied')
  const live = () => [...ctx.loader.entries()].find(entry => entry.options.id === name + ':counter')?.fiber
  expect(live()).toBeDefined()
  expect(readProfileManifest('test', dir).dsh?.profile?.bundles).toContain(name)
  await ctx.creationRecommendations.act(agent, callId, 'keep', 'page')
  expect(receipt()?.phase).toBe('kept')
  expect(live()).toBeDefined()
  await ctx.creationRecommendations.act(agent, callId, 'undo', 'page')
  expect(receipt()?.phase).toBe('removed')
  expect(live()).toBeUndefined()
  expect(readProfileManifest('test', dir).dsh?.profile?.bundles).toEqual(['fixture-base'])
  expect((await ctx.pluginManager.listBundles()).find(bundle => bundle.name === name)?.installed).not.toBe(true)
}, 30_000)

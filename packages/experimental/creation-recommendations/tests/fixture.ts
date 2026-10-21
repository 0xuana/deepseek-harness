/** Real Agent, Tools and projections with controlled Creator and profile operations. */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { expect, onTestFinished, vi } from 'vitest'
import { MessageId, ToolCallId, type AssistantMessage } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import Skills from '@deepseek-ai/dsh-skill'
import * as SkillTool from '@deepseek-ai/dsh-tool-skill'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import type { BundleInfo, ChangeResult } from '@deepseek-ai/dsh-plugin-manager/types'
import type { SubagentActivationSpec, SubagentResult } from '@deepseek-ai/dsh-subagent'
import * as CreationRecommendations from '../src/index.ts'
import { creationProjection } from '../src/projection.ts'
import type { CreationCardState, CreationDecision } from '../src/types.ts'

export const callId = ToolCallId('block:creation-1')
export const proposal = { title: 'Counter', brief: 'Keep a counter visible for this task.', slot: 'sidebar-right' as const }

export function installedBundle(name: string): BundleInfo {
  return { name, official: false, optional: false, availability: 'profile', installed: true,
    enabled: true, removable: true, updatable: true, rows: [], overrides: [] }
}

export async function writeBundle(directory: string, name: string): Promise<void> {
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module',
    main: './index.js', exports: { '.': './index.js', './client': './index.js' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  await writeFile(join(directory, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: name + ':counter', name }] }]))
  await writeFile(join(directory, 'index.js'), 'export function apply(ctx) { ctx.provide("createdCounter", true) }\n')
}

export async function fixture(initial?: CreationDecision) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-creation-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  const harness = await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(RemoteAccess)
  await ctx.plugin(Skills)
  await ctx.plugin(SkillTool)
  const bundles: BundleInfo[] = []
  const manager = {
    listBundles: vi.fn(async (): Promise<BundleInfo[]> => bundles),
    installBundle: vi.fn(async (path: string): Promise<ChangeResult> => {
      const decision = current()!
      bundles.push(installedBundle(decision.bundleName!))
      return { application: 'applied', changed: true, stage: 'install', target: path }
    }),
    removeBundle: vi.fn(async (name: string): Promise<ChangeResult> => {
      bundles.splice(bundles.findIndex(bundle => bundle.name === name), 1)
      return { application: 'applied', changed: true, stage: 'remove', target: name }
    }),
  }
  const result = Promise.withResolvers<SubagentResult>()
  const entered = Promise.withResolvers<SubagentActivationSpec>()
  const dispose = vi.fn(async () => { result.resolve({ output: [], stopReason: 'aborted' }) })
  const startActivation = vi.fn(async (spec: SubagentActivationSpec) => {
    entered.resolve(spec)
    return { childId: spec.childId!, result: result.promise, dispose }
  })
  ctx.provide('pluginManager', manager)
  ctx.provide('subagents', { startActivation })
  const workspace = join(directory, 'workspace')
  await mkdir(workspace)
  ctx.provide('profileContext', { dir: directory, cwd: workspace })
  const agentHandle = await ctx.agents.create({ sessionId: SessionId('creation-root'), meta: { cwd: workspace } })
  const agent = agentHandle.agent
  const events: SessionEvent[] = []
  ctx.on('session/event', (session, event) => { if (session === agent.session) events.push(event) })
  if (initial !== undefined) appendPluginRecord(agent.session, 'plugin:creation-recommendations/decision', initial)
  const fiber = await ctx.plugin(CreationRecommendations)
  const projection = creationProjection(CreationRecommendations.Config.parse({}))
  const state = () => events.reduce(projection.apply, projection.init())
  const current = (): CreationCardState | undefined => state().view.decisions[callId]
  /** Log an assistant answer ending in a dsh-action block, as the model would write it. */
  let step = 0
  const propose = async (id = 'creation-1', args: object = proposal, caller = agent) => {
    const text = '方案在下方，点击创建即可开始。\n\n```dsh-action\n' + JSON.stringify({ action: 'create_personalized_page', ...args }) + '\n```'
    const message: AssistantMessage = { role: 'assistant', id: MessageId(id), content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'fixture', model: 'fixture' } }
    const turn = caller === agent ? Math.max(1, state().turn) : 1
    caller.session.append('assistant/message', { turn, step: ++step, message, stream: [] }, { surfaceOp: 'append' })
    await Promise.resolve()
    return ToolCallId('block:' + id)
  }
  const complete = async () => {
    const spec = await entered.promise
    const decision = current()!
    await writeBundle(spec.request.cwd!, decision.bundleName!)
    result.resolve({ output: [], stopReason: 'completed', structured: { ready: true } })
    await vi.waitFor(() => { expect(current()?.phase).toBe('installed') })
    return spec
  }
  return { ctx, agent, agentHandle, harness, directory, manager, bundles, startActivation, dispose, result, entered,
    fiber, propose, current, state, complete, events }
}

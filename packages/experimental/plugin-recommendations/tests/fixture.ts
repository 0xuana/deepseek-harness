/** Real Agent, skills and projections with a controlled profile manager. */
import { Context } from '@deepseek-ai/cordis'
import { onTestFinished, vi } from 'vitest'
import { MessageId, ToolCallId, type AssistantMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import Skills from '@deepseek-ai/dsh-skill'
import * as SkillTool from '@deepseek-ai/dsh-tool-skill'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import type { BundleInfo, ChangeResult } from '@deepseek-ai/dsh-plugin-manager/types'
import * as PluginRecommendations from '../src/index.ts'
import { recommendationProjection } from '../src/projection.ts'

export const bundle: BundleInfo = {
  name: 'official-search', official: true, optional: true, availability: 'installation',
  enabled: false, installed: false, removable: false, updatable: false, rows: [], overrides: [],
  meta: { title: { en: 'Search', zh: '搜索' }, description: 'Search past conversations.' },
}
export const callId = ToolCallId('block:answer-1')

/** One assistant answer carrying the given dsh-action objects, as the model writes it.
 * @param id - message id; the card id is `block:<id>`.
 * @param blocks - objects written into separate fences, in order.
 * @param turn - turn recorded on the message.
 * @returns the logged message event payload.
 */
export function answer(id: string, blocks: readonly object[], turn = 1): SessionEvent<'assistant/message'>['data'] {
  const text = ['下方可以直接启用。', ...blocks.map(block => '```dsh-action\n' + JSON.stringify(block) + '\n```')].join('\n\n')
  const message: AssistantMessage = { role: 'assistant', id: MessageId(id), content: [{ type: 'text', text }],
    source: { kind: 'model', provider: 'fixture', model: 'fixture' } }
  return { turn, step: 1, message, stream: [] }
}

export const block = { action: 'enable_official_plugin', name: bundle.name, reason: 'Search your conversation history.' }

export async function fixture() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(RemoteAccess)
  await ctx.plugin(Skills)
  await ctx.plugin(SkillTool)
  const manager = {
    listBundles: vi.fn(async (): Promise<BundleInfo[]> => [bundle]),
    setBundleEnabled: vi.fn(async (): Promise<ChangeResult> => ({ application: 'applied', changed: true, stage: 'enable', target: bundle.name, enabled: true })),
  }
  ctx.provide('pluginManager', manager)
  const fiber = await ctx.plugin(PluginRecommendations)
  const handle = await ctx.agents.create({ sessionId: SessionId('recommendations') })
  const agent = handle.agent
  const events: SessionEvent[] = []
  ctx.on('session/event', (session, event) => { if (session === agent.session) events.push(event) })
  const projection = recommendationProjection(PluginRecommendations.Config.parse({}))
  const state = () => events.reduce(projection.apply, projection.init())
  /** Log an answer whose last block names the official plugin. */
  const propose = (id = 'answer-1', blocks: readonly object[] = [block], caller = agent) => {
    caller.session.append('assistant/message', answer(id, blocks, Math.max(1, state().turn)), { surfaceOp: 'append' })
    return ToolCallId('block:' + id)
  }
  return { ctx, agent, handle, manager, fiber, events, state, propose }
}

import { expect, it, vi } from 'vitest'
import { agentEvents, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import * as PluginRecommendations from '../src/index.ts'
import { callId, fixture } from './fixture.ts'

async function prepare(
  f: Awaited<ReturnType<typeof fixture>>, agent: Agent = f.agent,
  signal = new AbortController().signal, admitted?: () => void | Promise<void>,
) {
  const decision = await agentEvents(f.ctx, agent).waterfall('agent/pre-step', { messages: [], turn: 2, step: 1, signal, modelSelection: { provider: 'mock', model: 'mock' } },
    async (): Promise<PreStepDecision> => { await admitted?.(); return { kind: 'enter', messages: [] } })
  return decision.kind === 'reject' ? decision : {
    ...decision, messages: decision.messages.filter(message => message.source.kind === 'plugin-recommendations'),
  }
}

function text(decision: PreStepDecision): string {
  if (decision.kind !== 'enter') throw new Error('request was rejected')
  return decision.messages.flatMap(message => message.content.flatMap(part => part.type === 'text' ? [part.text] : [])).join('\n')
}

function enter(agent: Agent, decision: PreStepDecision) {
  if (decision.kind === 'enter') for (const message of decision.messages) {
    agent.session.append('user/message', message, { surfaceOp: 'append' })
  }
}

it('reports the card outcome on the next request without waking the conversation', async () => {
  const f = await fixture()
  const followup = vi.spyOn(f.agent, 'followup')
  const steer = vi.spyOn(f.agent, 'steer')
  const inject = vi.spyOn(f.agent, 'inject')
  expect(await prepare(f)).toEqual({ kind: 'enter', messages: [] })
  f.propose()
  expect(await prepare(f)).toEqual({ kind: 'enter', messages: [] })
  await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')
  expect(f.agent.status).toBe('idle')
  const decision = await prepare(f)
  if (decision.kind !== 'enter') throw new Error('request was rejected')
  expect(decision.messages).toHaveLength(1)
  expect(decision.messages[0]!.content).toMatchSnapshot('applied plugin status')
  enter(f.agent, decision)
  expect(await prepare(f)).toEqual({ kind: 'enter', messages: [] })
  expect(followup).not.toHaveBeenCalled()
  expect(steer).not.toHaveBeenCalled()
  expect(inject).not.toHaveBeenCalled()
})

it('retains undelivered status through cancellation, rejection, plugin reload and Session reopen', async () => {
  const f = await fixture()
  f.propose()
  await f.ctx.pluginRecommendations.act(f.agent, callId, 'dismiss')
  const cancelled = new AbortController()
  await expect(prepare(f, f.agent, cancelled.signal, () => { cancelled.abort() })).rejects.toThrow()
  const rejected = f.ctx.on('agent/pre-step', async (): Promise<PreStepDecision> => ({ kind: 'reject' }))
  expect((await prepare(f)).kind).toBe('reject')
  rejected()
  // A prepared message is not acknowledged until it enters the durable log.
  expect((await prepare(f)).kind).toBe('enter')
  await f.fiber.dispose()
  expect(await prepare(f)).toEqual({ kind: 'enter', messages: [] })
  await f.ctx.plugin(PluginRecommendations)
  await f.handle.dispose()
  const reopened = await f.ctx.agents.create({ sessionId: f.agent.id, seed: [...f.events] })
  const decision = await prepare(f, reopened.agent)
  if (decision.kind !== 'enter') throw new Error('request was rejected')
  expect(JSON.stringify(decision.messages[0]!.content)).toContain('dismissed')
  enter(reopened.agent, decision)
  expect(await prepare(f, reopened.agent)).toEqual({ kind: 'enter', messages: [] })
})

it('keeps a later outcome pending when an earlier status message enters the log', async () => {
  const f = await fixture()
  f.propose()
  f.manager.setBundleEnabled.mockResolvedValueOnce({ application: 'failed', changed: false, stage: 'enable', target: 'official-search' })
  await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')
  const failed = await prepare(f)
  await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')
  enter(f.agent, failed)
  const applied = await prepare(f)
  if (applied.kind !== 'enter') throw new Error('request was rejected')
  expect(applied.messages).toHaveLength(1)
  expect(text(applied)).toContain('[{"plugin":"official-search","outcome":"applied"}]')
  enter(f.agent, applied)
  expect(await prepare(f)).toEqual({ kind: 'enter', messages: [] })
})

it('reports a receipt without a logged proposal by outcome only', async () => {
  const f = await fixture()
  appendPluginRecord(f.agent.session, 'plugin:plugin-recommendations/decision', { callId: ToolCallId('older-card'), outcome: 'dismissed' })
  expect(text(await prepare(f))).toContain('\n[{"outcome":"dismissed"}]')
})

it('does not supply status when cancellation arrives after downstream request preparation', async () => {
  const f = await fixture()
  f.propose()
  await f.ctx.pluginRecommendations.act(f.agent, callId, 'dismiss')
  await f.fiber.dispose()
  const controller = new AbortController()
  f.ctx.on('agent/pre-step', async (_event, next) => {
    const decision = await next()
    controller.abort()
    return decision
  }, { prepend: true })
  await f.ctx.plugin(PluginRecommendations)
  expect(await prepare(f, f.agent, controller.signal)).toEqual({ kind: 'enter', messages: [] })
})

it('does not add context if the plugin unloads during request preparation', async () => {
  const f = await fixture()
  f.propose()
  await f.ctx.pluginRecommendations.act(f.agent, callId, 'dismiss')
  expect(await prepare(f, f.agent, undefined, async () => { await f.fiber.dispose() })).toEqual({ kind: 'enter', messages: [] })
})

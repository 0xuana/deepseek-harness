import { expect, it, vi } from 'vitest'
import { agentEvents, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { fixture, callId, proposal } from './fixture.ts'
import * as CreationRecommendations from '../src/index.ts'

async function prepare(
  f: Awaited<ReturnType<typeof fixture>>, agent: Agent = f.agent,
  signal = new AbortController().signal, admitted?: () => void | Promise<void>,
) {
  const decision = await agentEvents(f.ctx, agent).waterfall('agent/pre-step', { messages: [], turn: 2, step: 1, signal, modelSelection: { provider: 'mock', model: 'mock' } },
    async (): Promise<PreStepDecision> => { await admitted?.(); return { kind: 'enter', messages: [] } })
  return decision.kind === 'reject' ? decision : {
    ...decision, messages: decision.messages.filter(message => message.source.kind === 'personalized-pages'),
  }
}

function enter(agent: Agent, decision: PreStepDecision) {
  if (decision.kind === 'enter') for (const message of decision.messages) {
    agent.session.append('user/message', message, { surfaceOp: 'append' })
  }
}

it('reports the latest card status on the next request without waking the conversation', async () => {
  const f = await fixture()
  const followup = vi.spyOn(f.agent, 'followup')
  const steer = vi.spyOn(f.agent, 'steer')
  const inject = vi.spyOn(f.agent, 'inject')
  expect(await prepare(f)).toEqual({ kind: 'enter', messages: [] })
  await f.propose()
  expect(await prepare(f)).toEqual({ kind: 'enter', messages: [] })
  await f.ctx.creationRecommendations.act(f.agent, callId, 'create', 'page')
  await f.entered.promise
  await f.ctx.creationRecommendations.act(f.agent, callId, 'cancel', 'page')
  expect(f.current()?.phase).toBe('cancelled')
  expect(f.agent.status).toBe('idle')
  const decision = await prepare(f)
  expect(decision.kind).toBe('enter')
  if (decision.kind !== 'enter') throw new Error('request was rejected')
  expect(decision.messages).toHaveLength(1)
  expect(decision.messages[0]!.content).toMatchSnapshot('cancelled page status')
  expect(decision.messages[0]!.source.kind).toBe('personalized-pages')
  enter(f.agent, decision)
  expect(await prepare(f)).toEqual({ kind: 'enter', messages: [] })
  expect(followup).not.toHaveBeenCalled()
  expect(steer).not.toHaveBeenCalled()
  expect(inject).not.toHaveBeenCalled()
})

it('retains undelivered status through cancellation, plugin reload and Session reopen', async () => {
  const f = await fixture()
  await f.propose()
  await f.ctx.creationRecommendations.act(f.agent, callId, 'dismiss', 'page')
  const cancelled = new AbortController()
  await expect(prepare(f, f.agent, cancelled.signal, () => { cancelled.abort() })).rejects.toThrow()
  const rejected = f.ctx.on('agent/pre-step', async (): Promise<PreStepDecision> => ({ kind: 'reject' }))
  expect((await prepare(f)).kind).toBe('reject')
  rejected()
  // A prepared message is not acknowledged until it enters the durable log.
  expect((await prepare(f)).kind).toBe('enter')
  await f.fiber.dispose()
  expect(await prepare(f)).toEqual({ kind: 'enter', messages: [] })
  await f.ctx.plugin(CreationRecommendations)
  await f.agentHandle.dispose()
  const reopened = await f.ctx.agents.create({ sessionId: f.agent.id, seed: [...f.events] })
  const decision = await prepare(f, reopened.agent)
  if (decision.kind !== 'enter') throw new Error('request was rejected')
  expect(decision.messages).toHaveLength(1)
  expect(JSON.stringify(decision.messages[0]!.content)).toContain('dismissed')
  enter(reopened.agent, decision)
  expect(await prepare(f, reopened.agent)).toEqual({ kind: 'enter', messages: [] })
})

it('keeps a later state update pending when an earlier status message enters the log', async () => {
  const f = await fixture()
  await f.propose()
  await f.ctx.creationRecommendations.act(f.agent, callId, 'create', 'page')
  await f.entered.promise
  const creating = await prepare(f)
  await f.ctx.creationRecommendations.act(f.agent, callId, 'cancel', 'page')
  enter(f.agent, creating)
  const cancelled = await prepare(f)
  if (cancelled.kind !== 'enter') throw new Error('request was rejected')
  expect(cancelled.messages).toHaveLength(1)
  expect(JSON.stringify(cancelled.messages[0]!.content)).toContain('cancelled')
  enter(f.agent, cancelled)
  expect(await prepare(f)).toEqual({ kind: 'enter', messages: [] })
})

it('does not supply status when cancellation arrives after downstream request preparation', async () => {
  const f = await fixture()
  await f.propose()
  await f.ctx.creationRecommendations.act(f.agent, callId, 'dismiss', 'page')
  await f.fiber.dispose()
  const controller = new AbortController()
  f.ctx.on('agent/pre-step', async (_event, next) => {
    const decision = await next()
    controller.abort()
    return decision
  }, { prepend: true })
  await f.ctx.plugin(CreationRecommendations)
  expect(await prepare(f, f.agent, controller.signal)).toEqual({ kind: 'enter', messages: [] })
})

it('does not add context if the plugin unloads during request preparation', async () => {
  const f = await fixture()
  await f.propose()
  await f.ctx.creationRecommendations.act(f.agent, callId, 'dismiss', 'page')
  expect(await prepare(f, f.agent, undefined, async () => { await f.fiber.dispose() })).toEqual({ kind: 'enter', messages: [] })
})

it('reports installed and removed outcomes, including application errors, without starting another Creator', async () => {
  const f = await fixture()
  await f.propose()
  await f.ctx.creationRecommendations.act(f.agent, callId, 'create', 'page')
  await f.complete()
  const installed = await prepare(f)
  if (installed.kind !== 'enter') throw new Error('request was rejected')
  expect(JSON.stringify(installed.messages[0]!.content)).toContain('installed')
  enter(f.agent, installed)
  await f.ctx.creationRecommendations.act(f.agent, callId, 'undo', 'page')
  const removed = await prepare(f)
  if (removed.kind !== 'enter') throw new Error('request was rejected')
  expect(JSON.stringify(removed.messages[0]!.content)).toContain('removed')
  enter(f.agent, removed)
  appendPluginRecord(f.agent.session, 'plugin:creation-recommendations/decision', {
    callId: ToolCallId('older-card'), slot: 'page', phase: 'installed', application: 'failed',
  })
  const failedApplication = await prepare(f)
  if (failedApplication.kind !== 'enter') throw new Error('request was rejected')
  expect(JSON.stringify(failedApplication.messages[0]!.content)).toContain('failed')
  expect(JSON.stringify(failedApplication.messages[0]!.content)).not.toContain(callId)
  expect(f.startActivation).toHaveBeenCalledOnce()
})

it('keeps an unstarted proposal across later human messages and lets the next proposal replace it', async () => {
  const f = await fixture()
  await f.propose()
  const human = createUserMessage({ content: [{ type: 'text', text: 'Let us discuss something else.' }], source: { kind: 'user' } })
  f.agent.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [human] })
  f.agent.session.append('user/message', human, { surfaceOp: 'append' })
  expect(f.current()).toBeUndefined()
  expect(await prepare(f)).toEqual({ kind: 'enter', messages: [] })
  f.agent.session.append('turn/start', { turn: 2 })
  await f.propose(ToolCallId('creation-2'), { ...proposal, title: 'Checklist' })
  expect(f.current()).toEqual({ callId, phase: 'replaced', slot: 'sidebar-right' })
  // Replacement is the model's own choice, so no status notice is queued for it.
  expect(await prepare(f)).toEqual({ kind: 'enter', messages: [] })
  expect(await f.ctx.creationRecommendations.act(f.agent, callId, 'create', 'page')).toEqual({
    status: 'settled', decision: { callId, phase: 'replaced', slot: 'sidebar-right' },
  })
  await f.agentHandle.dispose()
  const reopened = await f.ctx.agents.create({ sessionId: f.agent.id, seed: [...f.events] })
  expect(await f.ctx.creationRecommendations.act(reopened.agent, callId, 'create', 'page')).toEqual({
    status: 'settled', decision: { callId, phase: 'replaced', slot: 'sidebar-right' },
  })
  expect(f.startActivation).not.toHaveBeenCalled()
  expect(f.manager.installBundle).not.toHaveBeenCalled()
})

it('keeps accepted work and its retry available across later user messages', async () => {
  const f = await fixture()
  await f.propose()
  await f.ctx.creationRecommendations.act(f.agent, callId, 'create', 'page')
  await f.entered.promise
  const message = createUserMessage({ content: [{ type: 'text', text: 'What is next?' }], source: { kind: 'user' } })
  f.agent.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] })
  expect(f.current()?.phase).toBe('creating')
  await f.ctx.creationRecommendations.act(f.agent, callId, 'cancel', 'page')
  f.agent.session.append('user/message', message, { surfaceOp: 'append' })
  expect(f.current()?.phase).toBe('cancelled')
  expect(await f.ctx.creationRecommendations.act(f.agent, callId, 'create', 'page')).toEqual({ status: 'accepted' })
  await vi.waitFor(() => { expect(f.startActivation).toHaveBeenCalledTimes(2) })
})

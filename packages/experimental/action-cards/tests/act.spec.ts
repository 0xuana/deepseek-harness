import { expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ActionCardResult } from '../src/index.ts'
import { ACTION, callId, fixture, proposal } from './fixture.ts'

const dismissed = (data?: object) => ({ status: 'settled', decision: { callId, action: ACTION, phase: 'dismissed', ...data === undefined ? {} : { data } } })

it('refuses unknown cards, closed owners, removed kinds and undeclared verbs before any handler runs', async () => {
  const f = await fixture()
  expect(await f.ctx.actionCards.act(f.agent, callId, 'start')).toEqual({ status: 'refused', reason: 'unknown' })
  f.propose()
  for (const id of ['toString', 'constructor']) {
    expect(await f.ctx.actionCards.act(f.agent, ToolCallId(id), 'dismiss')).toEqual({ status: 'refused', reason: 'unknown' })
  }
  for (const verb of ['toString', 'missing']) {
    expect(await f.ctx.actionCards.act(f.agent, callId, verb)).toEqual({ status: 'refused', reason: 'unavailable' })
  }
  const roots = vi.spyOn(f.ctx.agents, 'roots').mockReturnValue([])
  expect(await f.ctx.actionCards.act(f.agent, callId, 'start')).toEqual({ status: 'refused', reason: 'not-live-root' })
  roots.mockRestore()
  await f.kindFiber.dispose()
  expect(await f.ctx.actionCards.act(f.agent, callId, 'dismiss')).toEqual({ status: 'refused', reason: 'unavailable' })
  const service = f.ctx.actionCards
  await f.cards.dispose()
  expect(await service.act(f.agent, callId, 'dismiss')).toEqual({ status: 'refused', reason: 'closing' })
  expect(f.act).not.toHaveBeenCalled()
})

it('applies the shared access and read-only checks the kind declares, then hands typed details to the kind', async () => {
  const f = await fixture()
  f.propose()
  const access = vi.spyOn(f.ctx.remoteAccess, 'allows').mockReturnValue(false)
  expect(await f.ctx.actionCards.act(f.agent, callId, 'publish')).toEqual({ status: 'refused', reason: 'access-denied' })
  expect(await f.ctx.actionCards.act(f.agent, callId, 'start', { note: 'x' })).toEqual({ status: 'settled', decision: { callId, action: ACTION, phase: 'start' } })
  access.mockRestore()
  expect(f.act).toHaveBeenCalledWith(f.agent, { callId, turn: 1, ...proposal }, 'start', { note: 'x' })
  const resolve = vi.fn(() => ({ mode: 'read-only', workspaceRoot: '/' }))
  f.ctx.provide('sandboxPolicy', { resolve })
  expect(await f.ctx.actionCards.act(f.agent, callId, 'write')).toEqual({ status: 'refused', reason: 'read-only' })
  expect(resolve).toHaveBeenCalledWith({ session: f.agent.session })
  expect((await f.ctx.actionCards.act(f.agent, callId, 'publish')).status).toBe('settled')
  resolve.mockReturnValue({ mode: 'workspace-write', workspaceRoot: '/' })
  expect((await f.ctx.actionCards.act(f.agent, callId, 'write')).status).toBe('settled')
  f.propose(ToolCallId('call-invalid'), { ...proposal, details: { value: 3 } }, f.agent, 2)
  expect(await f.ctx.actionCards.act(f.agent, ToolCallId('call-invalid'), 'start')).toEqual({ status: 'refused', reason: 'unavailable' })
  expect(f.act).toHaveBeenCalledTimes(3)
})

it('records dismissal of an unstarted or open card with the kind data, and settles started or final cards', async () => {
  const f = await fixture({
    openPhases: ['failed'],
    dismissal: (card, payload) => ({ value: card.details.value, ...z.object({ choice: z.string() }).safeParse(payload).data }),
  })
  f.propose()
  expect(await f.ctx.actionCards.act(f.agent, callId, 'dismiss', { choice: 'later' })).toEqual(dismissed({ value: 'a', choice: 'later' }))
  expect(f.view().decisions[callId]?.phase).toBe('dismissed')
  for (const verb of ['dismiss', 'start']) expect(await f.ctx.actionCards.act(f.agent, callId, verb)).toEqual(dismissed({ value: 'a', choice: 'later' }))
  f.ctx.actionCards.record(f.agent, { callId, action: ACTION, phase: 'failed' })
  expect(await f.ctx.actionCards.act(f.agent, callId, 'dismiss')).toEqual(dismissed({ value: 'a' }))
  f.ctx.actionCards.record(f.agent, { callId, action: ACTION, phase: 'running', data: { step: 1 } })
  expect(await f.ctx.actionCards.act(f.agent, callId, 'dismiss')).toEqual({ status: 'settled',
    decision: { callId, action: ACTION, phase: 'running', data: { step: 1 } } })
  f.propose(ToolCallId('call-invalid'), { ...proposal, details: { value: 3 } }, f.agent, 2)
  expect(await f.ctx.actionCards.act(f.agent, ToolCallId('call-invalid'), 'dismiss')).toEqual({ status: 'settled',
    decision: { callId: 'call-invalid', action: ACTION, phase: 'dismissed' } })
  expect(f.act).not.toHaveBeenCalled()
})

it('dismisses without data when the kind records none', async () => {
  const f = await fixture()
  f.propose()
  expect(await f.ctx.actionCards.act(f.agent, callId, 'dismiss', { choice: 'later' })).toEqual(dismissed())
})

it('shares one operation between concurrent actions on a card and drains it on unload', async () => {
  const pending = Promise.withResolvers<ActionCardResult>()
  onTestFinished(() => { pending.resolve({ status: 'accepted' }) })
  const f = await fixture({ act: vi.fn(() => pending.promise) })
  f.propose()
  const first = f.ctx.actionCards.act(f.agent, callId, 'start')
  expect(f.ctx.actionCards.act(f.agent, callId, 'dismiss')).toBe(first)
  const disposing = f.cards.dispose()
  pending.resolve({ status: 'accepted' })
  expect(await first).toEqual({ status: 'accepted' })
  await disposing
})

it('rejects a second kind for the same action and releases a kind through its disposer', async () => {
  const f = await fixture()
  const kind = (action: string) => ({ action, skill: 'other-skill', details: z.object({}), verbs: { start: {} },
    act: () => Promise.resolve<ActionCardResult>({ status: 'accepted' }) })
  expect(() => f.ctx.actionCards.register(kind(ACTION))).toThrow('action-cards: action "test_action" is already registered')
  const unregister = f.ctx.actionCards.register(kind('other_action'))
  f.propose(ToolCallId('call-other'), { action: 'other_action', title: 'Other', brief: 'Other card.', details: {} })
  expect(await f.ctx.actionCards.act(f.agent, ToolCallId('call-other'), 'start')).toEqual({ status: 'accepted' })
  unregister()
  expect(await f.ctx.actionCards.act(f.agent, ToolCallId('call-other'), 'start')).toEqual({ status: 'refused', reason: 'unavailable' })
})

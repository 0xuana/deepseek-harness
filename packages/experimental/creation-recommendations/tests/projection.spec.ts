import { expect, it } from 'vitest'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { creationOf, creationProjection as projectionFor } from '../src/projection.ts'
import { MessageId, type AssistantMessage } from '@deepseek-ai/dsh-llm'

const creationProjection = projectionFor({ queuedMessageLimit: 2 })

const callId = ToolCallId('creation')
const proposal = { callId, title: 'Counter', brief: 'Keep count visible', slot: 'page' }
const ptc: SessionEvent<'tool/ptc-dispatch'> = { type: 'tool/ptc-dispatch', seq: SessionSeq(1), time: 0,
  data: { rootCallId: callId, parentCallId: callId, subCallId: callId, name: 'suggest_view', arguments: {},
    content: [], isError: false, meta: { creationRecommendation: proposal } } }

it('folds native and PTC metadata, ignores failed or malformed proposals, and resets the per-turn reservation', () => {
  const empty = creationProjection.init()
  expect(creationOf({ type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 1 } })).toBeUndefined()
  expect(creationOf(ptc)).toEqual(proposal)
  const native: SessionEvent<'tool/result'> = { type: 'tool/result', seq: SessionSeq(2), time: 0, surfaceOp: 'append',
    data: { turn: 1, step: 1, message: createToolResultMessage({ callId, content: [], isError: false }),
      meta: { creationRecommendation: proposal } } }
  const card = { ...native, data: { ...native.data, meta: { actionCard: { action: 'create_personalized_page', callId, data: proposal } } } }
  expect(creationOf(card)).toEqual(proposal)
  expect(creationOf({ ...card, data: { ...card.data,
    meta: { actionCard: { action: 'create_personalized_page', callId, data: { ...proposal, initialContent: 'A: 小李，未开始' } } },
  } })).toEqual({ ...proposal, initialContent: 'A: 小李，未开始' })
  expect(creationOf({ ...ptc, data: { ...ptc.data, meta: card.data.meta } })).toEqual(proposal)
  expect(creationProjection.apply(empty, card).proposals[callId]).toEqual(proposal)
  const other = { ...card, data: { ...card.data, meta: { actionCard: { action: 'other', callId: 'other-card', data: {} } } } }
  expect(creationOf(other)).toBeUndefined()
  expect(creationProjection.apply(empty, other).firstCall).toBe('other-card')
  const state = creationProjection.apply(empty, native)
  expect(state.proposals[callId]).toEqual(proposal)
  expect(creationProjection.wire.view(state)).toEqual({ decisions: {} })
  for (const event of [
    { ...ptc, data: { ...ptc.data, isError: true } },
    { ...ptc, data: { ...ptc.data, meta: { creationRecommendation: { ...proposal, slot: 'invalid' } } } },
    { ...native, data: { turn: 1, step: 1, message: native.data.message } },
  ]) {
    expect(creationOf(event)).toBeUndefined()
    expect(creationProjection.apply(empty, event)).toBe(empty)
  }
  const foreign = { ...ptc, data: { ...ptc.data, meta: { pluginRecommendation: { callId: 'official' } } } }
  expect(creationProjection.apply(empty, foreign).firstCall).toBe('official')
  expect(creationProjection.apply(state, foreign).view.decisions[callId]).toEqual({ callId, phase: 'suppressed', slot: proposal.slot })
  expect(creationProjection.apply(state, { type: 'turn/start', seq: SessionSeq(3), time: 0, data: { turn: 2 } }).firstCall).toBeNull()
})

it('replaces only undecided earlier proposals and never a proposal by its own replay', () => {
  const empty = creationProjection.init()
  const first = creationProjection.apply(empty, ptc)
  expect(creationProjection.apply(first, ptc).view.decisions).toEqual({})
  const later: SessionEvent<'tool/ptc-dispatch'> = { ...ptc, seq: SessionSeq(5), data: { ...ptc.data,
    meta: { creationRecommendation: { ...proposal, callId: ToolCallId('creation-2'), title: 'Checklist' } } } }
  const nextTurn = creationProjection.apply(first, { type: 'turn/start', seq: SessionSeq(4), time: 0, data: { turn: 2 } })
  expect(creationProjection.apply(nextTurn, later).view.decisions).toEqual({ [callId]: { callId, phase: 'replaced', slot: 'page' } })
  const dismissed = { ...nextTurn, view: { decisions: { [callId]: { callId, phase: 'dismissed' as const, slot: 'page' as const } } } }
  expect(creationProjection.apply(dismissed, later).view.decisions[callId]).toEqual({ callId, phase: 'dismissed', slot: 'page' })
})

function answer(id: string, text: string, seq = 7): SessionEvent<'assistant/message'> {
  const message: AssistantMessage = { role: 'assistant', id: MessageId(id), content: [{ type: 'text', text }],
    source: { kind: 'model', provider: 'fixture', model: 'fixture' } }
  return { type: 'assistant/message', seq: SessionSeq(seq), time: 0, surfaceOp: 'append', data: { turn: 1, step: 1, message, stream: [] } }
}

it('reads the last valid dsh-action block of an answer, keeps one card per turn, and suppresses while messages are queued', () => {
  const block = (fields: object) => '```dsh-action\n' + JSON.stringify({ action: 'create_personalized_page', ...fields }) + '\n```'
  const fields = { title: 'Counter', brief: 'Keep count visible', slot: 'page' as const }
  expect(creationOf(answer('m1', '先回答。\n\n' + block(fields)))).toEqual({ callId: ToolCallId('block:m1'), ...fields })
  expect(creationOf(answer('m2', block({ ...fields, title: '' }) + '\n' + block({ ...fields, title: 'Second' })))).toEqual({ callId: ToolCallId('block:m2'), ...fields, title: 'Second' })
  for (const text of ['没有围栏', '```dsh-action\n{broken\n```', block({ ...fields, action: 'other' }), block({ ...fields, slot: 'elsewhere' }), block({ ...fields, extra: 1 })]) {
    expect(creationOf(answer('m3', text))).toBeUndefined()
  }
  const empty = creationProjection.init()
  const first = creationProjection.apply(empty, answer('m1', block(fields)))
  expect(first.proposals[ToolCallId('block:m1')]).toEqual({ callId: ToolCallId('block:m1'), ...fields })
  const second = creationProjection.apply(first, answer('m4', block({ ...fields, title: 'Late' }), 8))
  expect(second.proposals[ToolCallId('block:m4')]).toBeUndefined()
  const nextTurn = creationProjection.apply(second, { type: 'turn/start', seq: SessionSeq(9), time: 0, data: { turn: 2 } })
  expect(creationProjection.apply(nextTurn, answer('m4', block({ ...fields, title: 'Late' }), 10)).view.decisions[ToolCallId('block:m1')]).toEqual({ callId: ToolCallId('block:m1'), phase: 'replaced', slot: 'page' })
  const queued = creationProjection.apply(creationProjection.apply(nextTurn,
    { type: 'agent/inbox/spliced', seq: SessionSeq(11), time: 0, data: { target: 'next-turn', start: 0, inserted: [ptc.data as never, ptc.data as never] } }),
  answer('m5', block(fields), 12))
  expect(queued.queued).toBe(2)
  expect(queued.view.decisions[ToolCallId('block:m5')]).toEqual({ callId: ToolCallId('block:m5'), phase: 'suppressed', slot: 'page' })
})

it('yields to another action in the same answer or turn and logs the page block as never offered', () => {
  const page = { action: 'create_personalized_page', title: 'Counter', brief: 'Keep count visible', slot: 'page' as const }
  const plugin = { action: 'enable_official_plugin', name: 'official-search', reason: 'Search past work.' }
  const fence = (fields: object) => '```dsh-action\n' + JSON.stringify(fields) + '\n```'
  const empty = creationProjection.init()
  // Another action's block anywhere in the answer wins, whatever the order.
  for (const text of [fence(page) + '\n' + fence(plugin), fence(plugin) + '\n' + fence(page)]) {
    const state = creationProjection.apply(empty, answer('m1', text))
    expect(state.view.decisions[ToolCallId('block:m1')]).toEqual({ callId: ToolCallId('block:m1'), phase: 'suppressed', slot: 'page' })
    expect(state.proposals[ToolCallId('block:m1')]).toBeDefined()
  }
  // Another action's answer earlier in the turn holds it; a block that names no action does not.
  const official = creationProjection.apply(empty, answer('m1', fence(plugin)))
  expect(official.firstCall).toBe('block:m1')
  expect(creationProjection.apply(official, answer('m1', fence(plugin)))).toBe(official)
  expect(creationProjection.apply(empty, answer('m1', fence({ title: 'no action' })))).toBe(empty)
  expect(creationProjection.apply(official, answer('m2', fence(page), 8)).view.decisions[ToolCallId('block:m2')])
    .toEqual({ callId: ToolCallId('block:m2'), phase: 'suppressed', slot: 'page' })
  // Another action's block later in the turn retracts this turn's undecided page card.
  const offered = creationProjection.apply(empty, answer('m1', fence(page)))
  expect(offered.view.decisions).toEqual({})
  const retracted = creationProjection.apply(offered, answer('m2', fence(plugin), 8))
  expect(retracted.view.decisions[ToolCallId('block:m1')]).toEqual({ callId: ToolCallId('block:m1'), phase: 'suppressed', slot: 'page' })
  expect(creationProjection.apply(retracted, answer('m3', fence(plugin), 9))).toBe(retracted)
})

it('reads only text parts of an answer and ignores splices outside the next-turn queue', () => {
  const fields = { title: 'Counter', brief: 'Keep count visible', slot: 'page' as const }
  const event = answer('m1', '```dsh-action\n' + JSON.stringify({ action: 'create_personalized_page', ...fields }) + '\n```')
  const message: AssistantMessage = { ...event.data.message, content: [{ type: 'tool-call', id: ToolCallId('call'), name: 'skill', arguments: '{}' }, ...event.data.message.content] }
  expect(creationOf({ ...event, data: { ...event.data, message } })).toEqual({ callId: ToolCallId('block:m1'), ...fields })
  const empty = creationProjection.init()
  expect(creationProjection.apply(empty, { type: 'agent/inbox/spliced', seq: SessionSeq(1), time: 0,
    data: { target: 'next-step', start: 0, inserted: [ptc.data as never] } })).toBe(empty)
})

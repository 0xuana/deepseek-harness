import { expect, it } from 'vitest'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { creationOf, creationProjection } from '../src/projection.ts'

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
  expect(creationProjection.apply(state, foreign)).toBe(state)
  expect(creationProjection.apply(state, { type: 'turn/start', seq: SessionSeq(3), time: 0, data: { turn: 2 } }).firstCall).toBeNull()
})

it('replaces only undecided earlier proposals and never a proposal by its own replay', () => {
  const empty = creationProjection.init()
  const first = creationProjection.apply(empty, ptc)
  expect(creationProjection.apply(first, ptc).view.decisions).toEqual({})
  const later: SessionEvent<'tool/ptc-dispatch'> = { ...ptc, seq: SessionSeq(5), data: { ...ptc.data,
    meta: { creationRecommendation: { ...proposal, callId: ToolCallId('creation-2'), title: 'Checklist' } } } }
  expect(creationProjection.apply(first, later).view.decisions).toEqual({ [callId]: { callId, phase: 'replaced', slot: 'page' } })
  const dismissed = { ...first, view: { decisions: { [callId]: { callId, phase: 'dismissed' as const, slot: 'page' as const } } } }
  expect(creationProjection.apply(dismissed, later).view.decisions[callId]).toEqual({ callId, phase: 'dismissed', slot: 'page' })
})

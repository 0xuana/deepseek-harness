import { expect, it } from 'vitest'
import { createToolResultMessage, createUserMessage, MessageId, ToolCallId, type AssistantMessage } from '@deepseek-ai/dsh-llm'
import {
  appendPluginRecord, Session, SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, SessionSeq, type SessionEvent, type SessionHeader,
} from '@deepseek-ai/dsh-session'
import { creationOf, creationProjection as projectionFor, type CreationState } from '../src/projection.ts'

const creationProjection = projectionFor({ queuedMessageLimit: 2 })
const fields = { title: 'Counter', brief: 'Keep count visible', slot: 'page' as const }
const block = (values: object) => '```dsh-action\n' + JSON.stringify({ action: 'create_personalized_page', ...values }) + '\n```'

function init(inherited = 0): CreationState {
  const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId('creation'), createdAt: 0, isSeeded: inherited > 0 }
  return creationProjection.init(header, SessionLogOffset(inherited))
}

function answer(id: string, text: string, seq = 7, reasoning?: string): SessionEvent<'assistant/message'> {
  const message: AssistantMessage = { role: 'assistant', id: MessageId(id),
    content: [...reasoning === undefined ? [] : [{ type: 'reasoning' as const, text: reasoning }], { type: 'text', text }],
    source: { kind: 'model', provider: 'fixture', model: 'fixture' } }
  return { type: 'assistant/message', seq: SessionSeq(seq), time: 0, surfaceOp: 'append', data: { turn: 1, step: 1, message, stream: [] } }
}

function turn(value: number, seq: number): SessionEvent<'turn/start'> {
  return { type: 'turn/start', seq: SessionSeq(seq), time: 0, data: { turn: value } }
}

it('reads the last valid dsh-action block of an answer and nothing from other events', () => {
  expect(creationOf(answer('m1', '先回答。\n\n' + block(fields)))).toEqual({ callId: ToolCallId('block:m1'), ...fields })
  expect(creationOf(answer('m2', block({ ...fields, title: '' }) + '\n' + block({ ...fields, title: 'Second' })))).toEqual({ callId: ToolCallId('block:m2'), ...fields, title: 'Second' })
  for (const text of ['没有围栏', '```dsh-action\n{broken\n```', block({ ...fields, action: 'other' }), block({ ...fields, slot: 'elsewhere' }), block({ ...fields, extra: 1 }), block({ ...fields, turn: 3 })]) {
    expect(creationOf(answer('m3', text))).toBeUndefined()
  }
  expect(creationOf(answer('m4', '答案在上面。', 7, block(fields)))).toBeUndefined()
  expect(creationOf(turn(1, 0))).toBeUndefined()
  const result: SessionEvent<'tool/result'> = { type: 'tool/result', seq: SessionSeq(1), time: 0, surfaceOp: 'append',
    data: { turn: 1, step: 1, message: createToolResultMessage({ callId: ToolCallId('tool'), content: [], isError: false }),
      meta: { creationRecommendation: { callId: 'tool', ...fields } } } }
  expect(creationOf(result)).toBeUndefined()
  expect(creationProjection.apply(init(), result)).toEqual(init())
})

it('keeps one card per turn, records the admitting turn and replaces only undecided earlier cards', () => {
  const first = [turn(1, 0), answer('m1', block(fields), 1)].reduce(creationProjection.apply, init())
  expect(first.view.proposals).toEqual({ [ToolCallId('block:m1')]: { callId: ToolCallId('block:m1'), ...fields, turn: 1 } })
  expect(creationProjection.apply(first, answer('m1', block(fields), 2)).view).toEqual(first.view)
  const late = creationProjection.apply(first, answer('m2', block({ ...fields, title: 'Late' }), 2))
  expect(late).toBe(first)
  const nextTurn = [turn(2, 3), answer('m3', block({ ...fields, title: 'Next' }), 4)].reduce(creationProjection.apply, first)
  expect(nextTurn.view.proposals[ToolCallId('block:m3')]).toEqual({ callId: ToolCallId('block:m3'), ...fields, title: 'Next', turn: 2 })
  expect(nextTurn.view.decisions).toEqual({ [ToolCallId('block:m1')]: { callId: ToolCallId('block:m1'), phase: 'replaced', slot: 'page' } })
  const dismissed: CreationState = { ...first, view: { ...first.view,
    decisions: { [ToolCallId('block:m1')]: { callId: ToolCallId('block:m1'), phase: 'dismissed', slot: 'page' } } } }
  const afterDismissal = [turn(2, 3), answer('m3', block(fields), 4)].reduce(creationProjection.apply, dismissed)
  expect(afterDismissal.view.decisions).toEqual(dismissed.view.decisions)
})

it('never offers a proposal written while user messages are queued for later turns', () => {
  const queued = [
    turn(1, 0),
    { type: 'agent/inbox/spliced', seq: SessionSeq(1), time: 0, data: { target: 'next-step', start: 0, inserted: [
      createUserMessage({ content: [{ type: 'text', text: 'steer' }], source: { kind: 'user' } })] } },
    { type: 'agent/inbox/spliced', seq: SessionSeq(2), time: 0, data: { target: 'next-turn', start: 0, inserted: ['one', 'two'].map(text =>
      createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })) } },
    answer('m1', block(fields), 3),
  ] satisfies SessionEvent[]
  const state = queued.reduce<CreationState>(creationProjection.apply, init())
  expect(state.queued).toBe(2)
  expect(state.view.decisions[ToolCallId('block:m1')]).toEqual({ callId: ToolCallId('block:m1'), phase: 'suppressed', slot: 'page' })
  expect(creationProjection.apply(state, answer('m2', block(fields), 4))).toBe(state)
})

it('ignores the events a forked Session inherits from its parent', () => {
  const parent = [turn(1, 0), answer('m1', block(fields), 1)]
  const inherited = init(parent.length)
  expect(parent.reduce(creationProjection.apply, inherited)).toBe(inherited)
  const own = [turn(2, 2), answer('m2', block({ ...fields, title: 'Fork' }), 3)].reduce(creationProjection.apply, inherited)
  expect(Object.keys(own.view.proposals)).toEqual([ToolCallId('block:m2')])
  expect(own.view.decisions).toEqual({})
})

it('skips decision records that do not match the receipt schema', () => {
  const session = Session.create(SessionId('records'))
  const malformed = { callId: ToolCallId('block:m1'), phase: 'dismissed' as const, slot: 'page' as const, customLocation: '   ' }
  appendPluginRecord(session, 'plugin:creation-recommendations/decision', malformed)
  appendPluginRecord(session, 'plugin:creation-recommendations/decision', { ...malformed, customLocation: 'Left entry' })
  const [skipped, recorded] = session.snapshotEvents()
  const state = creationProjection.apply(init(), skipped!)
  expect(state).toEqual(init())
  expect(creationProjection.apply(state, recorded!).view.decisions).toEqual({
    [ToolCallId('block:m1')]: { ...malformed, customLocation: 'Left entry' },
  })
})

it('publishes proposals and receipts as one view reused across internal state changes', () => {
  const state = [turn(1, 0), answer('m1', block({ ...fields, initialContent: 'A: 1' }), 1)].reduce(creationProjection.apply, init())
  const view = creationProjection.wire.view(state)
  expect(view).toBe(state.view)
  expect(creationProjection.wire.viewSchema.parse(view)).toEqual(view)
  expect(creationProjection.wire.view(creationProjection.apply(state, turn(2, 2)))).toBe(view)
})

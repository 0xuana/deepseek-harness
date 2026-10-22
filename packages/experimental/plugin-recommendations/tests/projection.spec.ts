import { expect, it } from 'vitest'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, SessionSeq, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { recommendationOf, recommendationProjection, type RecommendationState } from '../src/projection.ts'
import { answer, block } from './fixture.ts'

const projection = recommendationProjection({ queuedMessageLimit: 2 })
const page = { action: 'create_personalized_page', title: 'Counter', brief: 'Count tasks.', slot: 'page' }
const id = (message: string) => ToolCallId('block:' + message)
let seq = 0
const event = <K extends 'assistant/message' | 'turn/start' | 'agent/inbox/spliced' | 'user/message'>(type: K, data: SessionEvent<K>['data']) =>
  ({ type, seq: SessionSeq(++seq), time: 0, data }) as SessionEvent<K>
const apply = (state: RecommendationState, ...events: SessionEvent[]) => events.reduce(projection.apply, state)

function init(inherited = 0): RecommendationState {
  const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId('recommendations'), createdAt: 0, isSeeded: inherited > 0 }
  return projection.init(header, SessionLogOffset(inherited))
}

it('reads the last valid official-plugin block of an answer and ignores malformed blocks', () => {
  const empty = init()
  expect(apply(empty, event('assistant/message', answer('m1', [{ ...block, name: 'first' }, block])))
    .view.proposals[id('m1')]).toEqual({ callId: id('m1'), name: block.name, reason: block.reason, turn: 0 })
  expect(apply(empty, event('assistant/message', answer('m2', [{ ...block, name: '  trimmed ', reason: ' Reason. ' }]))).view.proposals[id('m2')])
    .toEqual({ callId: id('m2'), name: 'trimmed', reason: 'Reason.', turn: 0 })
  for (const invalid of [{ ...block, name: ' ' }, { ...block, reason: '' }, { ...block, extra: 1 }, { ...block, action: 'other' }, { name: block.name }]) {
    expect(apply(empty, event('assistant/message', answer('m3', [invalid])))).toBe(empty)
  }
  const text = { role: 'assistant', id: 'm4', content: [{ type: 'text', text: '```dsh-action\n{broken\n```' }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } }
  expect(apply(empty, event('assistant/message', { turn: 1, step: 1, message: text, stream: [] } as never))).toBe(empty)
  expect(apply(empty, event('turn/start', { turn: 1 }))).toEqual({ ...empty, turn: 1 })
})

it('publishes the admitted proposals with their turns beside the card states as the client view', () => {
  const state = apply(init(), event('turn/start', { turn: 3 }), event('assistant/message', answer('m1', [block], 3)))
  const view = projection.wire.view(state)
  expect(view).toBe(state.view)
  expect(view).toEqual({ decisions: {}, proposals: { [id('m1')]: { callId: id('m1'), name: block.name, reason: block.reason, turn: 3 } } })
  expect(projection.wire.viewSchema.parse(view)).toEqual(view)
  expect(projection.wire.view(apply(state, event('turn/start', { turn: 4 })))).toBe(view)
})

it('never yields to another action and keeps one card per turn of its own', () => {
  const empty = init()
  // Page blocks in the same answer, before or after, do not change this experiment's card.
  for (const blocks of [[block, page], [page, block]]) {
    const state = apply(empty, event('assistant/message', answer('m1', blocks)))
    expect(state.view.decisions).toEqual({})
    expect(state.view.proposals[id('m1')]).toBeDefined()
  }
  // A page answer earlier in the turn neither holds the turn nor hides a later plugin block.
  const pageFirst = apply(empty, event('assistant/message', answer('m1', [page])))
  expect(pageFirst).toBe(empty)
  expect(apply(pageFirst, event('assistant/message', answer('m2', [block]))).view.proposals[id('m2')]).toBeDefined()
  // This experiment's own later block in the same turn creates nothing.
  const own = apply(empty, event('assistant/message', answer('m1', [block])))
  const later = apply(own, event('assistant/message', answer('m2', [{ ...block, name: 'later' }])))
  expect(later).toBe(own)
  expect(apply(own, event('assistant/message', answer('m1', [block])))).toEqual(own)
  expect(apply(own, event('turn/start', { turn: 2 })).firstCall).toBeNull()
})

it('ignores the events a forked Session inherits from its parent', () => {
  const parent = [event('turn/start', { turn: 1 }), event('assistant/message', answer('m1', [block]))]
  const inherited = init(seq + 1)
  expect(parent.reduce(projection.apply, inherited)).toBe(inherited)
  const own = apply(inherited, event('turn/start', { turn: 2 }), event('assistant/message', answer('m2', [block], 2)))
  expect(Object.keys(own.view.proposals)).toEqual([id('m2')])
  expect(own.view.decisions).toEqual({})
})

it('reads only the text parts of an answer', () => {
  const data = answer('m1', [block])
  const message = { ...data.message, content: [{ type: 'tool-call' as const, id: ToolCallId('call'), name: 'skill', arguments: '{}' }, ...data.message.content] }
  expect(recommendationOf(event('assistant/message', { ...data, message }))).toEqual({ callId: id('m1'), name: block.name, reason: block.reason })
})

it('lets a later proposal replace only undecided cards', () => {
  const first = apply(init(), event('assistant/message', answer('m1', [block])))
  const second = apply(first, event('turn/start', { turn: 2 }), event('assistant/message', answer('m2', [block], 2)))
  expect(second.view.decisions).toEqual({ [id('m1')]: 'replaced' })
  const dismissed = { ...first, view: { ...first.view, decisions: { [id('m1')]: 'dismissed' as const } } }
  expect(apply(dismissed, event('turn/start', { turn: 2 }), event('assistant/message', answer('m2', [block], 2))).view.decisions)
    .toEqual({ [id('m1')]: 'dismissed' })
})

it('suppresses proposals written while user messages are queued and folds inbox splices', () => {
  const message = createUserMessage({ content: [{ type: 'text', text: 'Next question.' }], source: { kind: 'user' } })
  const empty = init()
  const queued = apply(empty, event('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message, message] }))
  expect(queued.queued).toBe(2)
  expect(apply(queued, event('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [message] }))).toBe(queued)
  expect(apply(queued, event('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 3, inserted: [] })).queued).toBe(0)
  const suppressed = apply(queued, event('assistant/message', answer('m1', [block])))
  expect(suppressed.view.decisions[id('m1')]).toBe('suppressed')
  expect(suppressed.view.proposals[id('m1')]).toBeDefined()
  const one = apply(queued, event('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }))
  expect(apply(one, event('assistant/message', answer('m1', [block]))).view.decisions).toEqual({})
})

it('acknowledges delivered status only through the notice sequence', () => {
  const state = { ...init(), pendingStatus: { a: 3, b: 7 } }
  const notice = createUserMessage({ content: [{ type: 'text', text: 'status' }],
    source: { kind: 'plugin-recommendations', through: SessionSeq(5), form: 'notice', summary: 'Official plugin status updated' } })
  expect(apply(state, event('user/message', notice)).pendingStatus).toEqual({ b: 7 })
  const human = createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })
  expect(apply(state, event('user/message', human))).toBe(state)
})

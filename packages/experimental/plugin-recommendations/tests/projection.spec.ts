import { expect, it } from 'vitest'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { recommendationOf, recommendationProjection } from '../src/projection.ts'
import { answer, block } from './fixture.ts'

const projection = recommendationProjection({ queuedMessageLimit: 2 })
const page = { action: 'create_personalized_page', title: 'Counter', brief: 'Count tasks.', slot: 'page' }
const id = (message: string) => ToolCallId('block:' + message)
let seq = 0
const event = <K extends 'assistant/message' | 'turn/start' | 'agent/inbox/spliced' | 'user/message'>(type: K, data: SessionEvent<K>['data']) =>
  ({ type, seq: SessionSeq(++seq), time: 0, data }) as SessionEvent<K>
const apply = (state: ReturnType<typeof projection.init>, ...events: SessionEvent[]) => events.reduce(projection.apply, state)

it('reads the last valid official-plugin block of an answer and ignores malformed blocks', () => {
  const empty = projection.init()
  expect(apply(empty, event('assistant/message', answer('m1', [{ ...block, name: 'first' }, block])))
    .proposals[id('m1')]).toEqual({ callId: id('m1'), name: block.name, reason: block.reason })
  expect(apply(empty, event('assistant/message', answer('m2', [{ ...block, name: '  trimmed ', reason: ' Reason. ' }]))).proposals[id('m2')])
    .toEqual({ callId: id('m2'), name: 'trimmed', reason: 'Reason.' })
  for (const invalid of [{ ...block, name: ' ' }, { ...block, reason: '' }, { ...block, extra: 1 }, { ...block, action: 'other' }, { name: block.name }]) {
    expect(apply(empty, event('assistant/message', answer('m3', [invalid])))).toBe(empty)
  }
  const text = { role: 'assistant', id: 'm4', content: [{ type: 'text', text: '```dsh-action\n{broken\n```' }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } }
  expect(apply(empty, event('assistant/message', { turn: 1, step: 1, message: text, stream: [] } as never))).toBe(empty)
  expect(apply(empty, event('turn/start', { turn: 1 }))).toEqual({ ...empty, turn: 1 })
  expect(projection.wire.view(apply(empty, event('assistant/message', answer('m1', [block]))))).toEqual({ decisions: {} })
})

it('never yields to another action and keeps one card per turn of its own', () => {
  const empty = projection.init()
  // Page blocks in the same answer, before or after, do not change this experiment's card.
  for (const blocks of [[block, page], [page, block]]) {
    const state = apply(empty, event('assistant/message', answer('m1', blocks)))
    expect(state.view.decisions).toEqual({})
    expect(state.proposals[id('m1')]).toBeDefined()
  }
  // A page answer earlier in the turn neither holds the turn nor hides a later plugin block.
  const pageFirst = apply(empty, event('assistant/message', answer('m1', [page])))
  expect(pageFirst).toBe(empty)
  expect(apply(pageFirst, event('assistant/message', answer('m2', [block]))).proposals[id('m2')]).toBeDefined()
  // This experiment's own later block in the same turn creates nothing.
  const own = apply(empty, event('assistant/message', answer('m1', [block])))
  const later = apply(own, event('assistant/message', answer('m2', [{ ...block, name: 'later' }])))
  expect(later).toBe(own)
  expect(apply(own, event('assistant/message', answer('m1', [block])))).toEqual(own)
  expect(apply(own, event('turn/start', { turn: 2 })).firstCall).toBeNull()
})

it('reads only the text parts of an answer', () => {
  const data = answer('m1', [block])
  const message = { ...data.message, content: [{ type: 'tool-call' as const, id: ToolCallId('call'), name: 'skill', arguments: '{}' }, ...data.message.content] }
  expect(recommendationOf(event('assistant/message', { ...data, message }))).toEqual({ callId: id('m1'), name: block.name, reason: block.reason })
})

it('lets a later proposal replace only undecided cards', () => {
  const first = apply(projection.init(), event('assistant/message', answer('m1', [block])))
  const second = apply(first, event('turn/start', { turn: 2 }), event('assistant/message', answer('m2', [block], 2)))
  expect(second.view.decisions).toEqual({ [id('m1')]: 'replaced' })
  const dismissed = { ...first, view: { decisions: { [id('m1')]: 'dismissed' as const } } }
  expect(apply(dismissed, event('turn/start', { turn: 2 }), event('assistant/message', answer('m2', [block], 2))).view.decisions)
    .toEqual({ [id('m1')]: 'dismissed' })
})

it('suppresses proposals written while user messages are queued and folds inbox splices', () => {
  const message = createUserMessage({ content: [{ type: 'text', text: 'Next question.' }], source: { kind: 'user' } })
  const empty = projection.init()
  const queued = apply(empty, event('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message, message] }))
  expect(queued.queued).toBe(2)
  expect(apply(queued, event('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [message] }))).toBe(queued)
  expect(apply(queued, event('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 3, inserted: [] })).queued).toBe(0)
  expect(apply(queued, event('assistant/message', answer('m1', [block]))).view.decisions[id('m1')]).toBe('suppressed')
  const one = apply(queued, event('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }))
  expect(apply(one, event('assistant/message', answer('m1', [block]))).view.decisions).toEqual({})
})

it('acknowledges delivered status only through the notice sequence', () => {
  const state = { ...projection.init(), pendingStatus: { a: 3, b: 7 } }
  const notice = createUserMessage({ content: [{ type: 'text', text: 'status' }],
    source: { kind: 'plugin-recommendations', through: SessionSeq(5), form: 'notice', summary: 'Official plugin status updated' } })
  expect(apply(state, event('user/message', notice)).pendingStatus).toEqual({ b: 7 })
  const human = createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })
  expect(apply(state, event('user/message', human))).toBe(state)
})

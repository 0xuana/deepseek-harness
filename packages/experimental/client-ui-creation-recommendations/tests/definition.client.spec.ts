import { expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { recommendationDefinition, recommendationOf } from '../src/client/definition.ts'

const value = { callId: ToolCallId('rec-1'), title: 'Counter', brief: 'Show a counter', slot: 'sidebar-right' as const }

it('reads identical proposal facts from native and nested PTC results', () => {
  const native = { type: 'tool/result', data: { message: { isError: false }, meta: { creationRecommendation: value } } }
  const ptc = { type: 'tool/ptc-dispatch', data: { isError: false, meta: { creationRecommendation: value } } }
  expect(recommendationOf(native)).toEqual(value)
  expect(recommendationOf(ptc)).toEqual(value)
  for (const event of [native, ptc]) {
    expect(recommendationOf({ ...event, data: { ...event.data, meta: { actionCard: { action: 'create_personalized_page', callId: value.callId, data: value } } } })).toEqual(value)
    expect(recommendationOf({ ...event, data: { ...event.data, meta: { actionCard: { action: 'another_action', callId: value.callId, data: value } } } })).toBeUndefined()
    const withContent = { ...value, initialContent: '1. a\n2. b' }
    expect(recommendationOf({ ...event, data: { ...event.data, meta: { actionCard: { action: 'create_personalized_page', callId: value.callId, data: withContent } } } })).toEqual(withContent)
  }
})

it('falls back for unrelated, failed, missing, and malformed data', () => {
  for (const event of [
    { type: 'other', data: null }, { type: 'other', data: {} },
    { type: 'tool/result', data: {} },
    { type: 'tool/result', data: { message: { isError: true } } },
    { type: 'tool/result', data: { message: {}, meta: [] } },
    { type: 'tool/result', data: { message: {}, meta: {} } },
    ...[null, [], {}, { ...value, brief: 3 }, { ...value, callId: '' }, { ...value, title: '' }, { ...value, brief: '' }, { ...value, slot: 'other' }, { ...value, initialContent: 3 }].map(data => ({
      type: 'tool/result', data: { message: {}, meta: { creationRecommendation: data } },
    })),
  ]) expect(recommendationOf(event)).toBeUndefined()
})

it('indexes proposal data while keeping the tool position free of cards', () => {
  type Match = Parameters<typeof recommendationDefinition.start>[1]
  type Context = Parameters<typeof recommendationDefinition.buildViewNode>[0]
  const match: Match = { role: 'start', event: { type: 'tool/result', seq: SessionSeq(7), time: 0, surfaceOp: 'append', data: {
    turn: 1, step: 1, message: createToolResultMessage({ callId: value.callId, content: [], isError: false }),
    meta: { creationRecommendation: value },
  } }, location: { kind: 'session' } }
  expect(recommendationDefinition.match(match.event)).toEqual({ id: 'rec-1', role: 'start' })
  expect(recommendationDefinition.match({ type: 'turn/start', seq: SessionSeq(1), time: 0, data: { turn: 1 } })).toBeNull()
  const context = { key: 'rec:rec-1', id: 'rec-1', start: match, state: value } as Context
  expect(recommendationDefinition.start(context, match)).toEqual(value)
  expect(recommendationDefinition.update({ ...context, state: value })).toEqual(value)
  expect(recommendationDefinition.buildViewNode?.(context)).toMatchObject({
    key: 'rec:rec-1', anchorSeq: 7, visibility: 'hidden', data: value,
  })
  expect(recommendationDefinition.buildViewNode?.({ ...context, state: undefined })).toBeNull()
  expect(recommendationDefinition.buildViewNode?.({ ...context, start: undefined })).toBeNull()
})

it('reads the last valid dsh-action block from an assistant answer and ignores malformed ones', () => {
  const block = (fields: object) => '```dsh-action\n' + JSON.stringify({ action: 'create_personalized_page', ...fields }) + '\n```'
  const fields = { title: 'Counter', brief: 'Show a counter', slot: 'sidebar-right' as const }
  const answer = (id: string, text: string) => ({ type: 'assistant/message', data: { message: { id, role: 'assistant', content: [{ type: 'text', text }] } } })
  expect(recommendationOf(answer('m1', '方案在下方。\n\n' + block(fields)))).toEqual({ callId: 'block:m1', ...fields })
  expect(recommendationOf(answer('m2', block({ ...fields, title: '' }) + '\n' + block({ ...fields, initialContent: '1. a' })))).toEqual({ callId: 'block:m2', ...fields, initialContent: '1. a' })
  for (const text of ['没有围栏', '```dsh-action\n{broken\n```', block({ ...fields, action: 'other' }), block({ ...fields, slot: 'elsewhere' }), block({ ...fields, initialContent: 2 })]) {
    expect(recommendationOf(answer('m3', text))).toBeUndefined()
  }
  expect(recommendationOf({ type: 'assistant/message', data: { message: { id: '', role: 'assistant', content: [{ type: 'text', text: block(fields) }] } } })).toBeUndefined()
})

it('reads only the text parts of an answer', () => {
  const fields = { title: 'Counter', brief: 'Keep count visible', slot: 'page' }
  const block = '```dsh-action\n' + JSON.stringify({ action: 'create_personalized_page', ...fields }) + '\n```'
  const content = [{ type: 'tool-call', id: 'call', name: 'skill', arguments: '{}' }, 'raw', { type: 'text', text: 3 }, { type: 'text', text: block }]
  expect(recommendationOf({ type: 'assistant/message', data: { message: { id: 'm1', role: 'assistant', content } } }))
    .toEqual({ callId: 'block:m1', ...fields })
})

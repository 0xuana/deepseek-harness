import { expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { recommendationDefinition, recommendationOf } from '../src/client/definition.ts'

const value = {
  callId: ToolCallId('rec-1'), name: 'search', titleEn: 'Search', titleZh: '搜索',
  descriptionEn: '', descriptionZh: '', request: 'find a conversation', reason: 'Search history',
}

it('reads identical proposal facts from native and nested PTC results', () => {
  const native = { type: 'tool/result', data: { message: { isError: false }, meta: { pluginRecommendation: value } } }
  const ptc = { type: 'tool/ptc-dispatch', data: { isError: false, meta: { pluginRecommendation: value } } }
  expect(recommendationOf(native)).toEqual(value)
  expect(recommendationOf(ptc)).toEqual(value)
})

it('falls back for unrelated, failed, missing, and malformed data', () => {
  for (const event of [
    { type: 'other', data: null }, { type: 'other', data: {} },
    { type: 'tool/result', data: {} },
    { type: 'tool/result', data: { message: { isError: true } } },
    { type: 'tool/result', data: { message: {}, meta: [] } },
    { type: 'tool/result', data: { message: {}, meta: {} } },
    ...[null, [], {}, { ...value, reason: 3 }, { ...value, callId: '' }, { ...value, name: '' },
      { ...value, request: '' }, { ...value, reason: '' }].map(data => ({
      type: 'tool/result', data: { message: {}, meta: { pluginRecommendation: data } },
    })),
  ]) expect(recommendationOf(event)).toBeUndefined()
})

it('indexes proposal data while keeping the tool position free of cards', () => {
  type Match = Parameters<typeof recommendationDefinition.start>[1]
  type Context = Parameters<typeof recommendationDefinition.buildViewNode>[0]
  const match: Match = { role: 'start', event: { type: 'tool/result', seq: SessionSeq(7), time: 0, surfaceOp: 'append', data: {
    turn: 1, step: 1, message: createToolResultMessage({ callId: value.callId, content: [], isError: false }),
    meta: { pluginRecommendation: value },
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

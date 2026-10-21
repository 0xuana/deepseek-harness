import { expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { recommendationDefinition, recommendationOf } from '../src/client/definition.ts'
import { actionBlocksOf } from '../src/client/action-block.ts'

const block = { action: 'enable_official_plugin', name: 'search', reason: 'Search history' }
const fence = (value: unknown) => '```dsh-action\n' + JSON.stringify(value) + '\n```'
const answer = (text: string, id = 'm1') => ({ type: 'assistant/message', data: { message: { id, content: [{ type: 'text', text }] } } })
const value = { callId: ToolCallId('block:m1'), name: 'search', reason: 'Search history' }

it('reads well-formed dsh-action objects in order and skips malformed or non-object fences', () => {
  expect(actionBlocksOf(['先回答。', fence(block), '```dsh-action json\n[1]\n```', '```dsh-action\n{broken\n```', '```ts\n{"action":"x"}\n```', fence({ action: 'other' })].join('\n\n')))
    .toEqual([block, { action: 'other' }])
  expect(actionBlocksOf('没有围栏')).toEqual([])
})

it('reads the last valid official-plugin block of an answer as its proposal', () => {
  expect(recommendationOf(answer('先回答。\n\n' + fence({ ...block, name: 'first' }) + '\n' + fence(block)))).toEqual(value)
  expect(recommendationOf(answer(fence({ ...block, name: ' search ', reason: ' Search history ' })))).toEqual(value)
  const mixed = { type: 'assistant/message', data: { message: { id: 'm1', content: [{ type: 'thinking', text: fence({ ...block, name: 'hidden' }) }, 'raw', { type: 'text', text: fence(block) }] } } }
  expect(recommendationOf(mixed)).toEqual(value)
})

it('ignores other events, malformed answers and invalid blocks', () => {
  for (const event of [
    { type: 'tool/result', data: { meta: { pluginRecommendation: value } } },
    { type: 'assistant/message', data: null },
    { type: 'assistant/message', data: { message: null } },
    { type: 'assistant/message', data: { message: { id: 'm1', content: 'text' } } },
    { type: 'assistant/message', data: { message: { content: [] } } },
    { type: 'assistant/message', data: { message: { id: '', content: [] } } },
    answer('没有围栏'),
    ...[[1], { ...block, action: 'create_personalized_page' }, { ...block, extra: true }, { action: block.action, name: 'search' },
      { ...block, name: 3 }, { ...block, name: ' ' }, { ...block, reason: 3 }, { ...block, reason: '' }].map(item => answer(fence(item))),
  ]) expect(recommendationOf(event)).toBeUndefined()
})

it('indexes proposal data while keeping the answer free of cards', () => {
  type Match = Parameters<typeof recommendationDefinition.start>[1]
  type Context = Parameters<typeof recommendationDefinition.buildViewNode>[0]
  const match: Match = { role: 'start', event: { type: 'assistant/message', seq: SessionSeq(7), time: 0, surfaceOp: 'append', data: {
    turn: 1, step: 1, stream: [],
    message: { role: 'assistant', id: MessageId('m1'), content: [{ type: 'text', text: fence(block) }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } },
  } }, location: { kind: 'session' } }
  expect(recommendationDefinition.match(match.event)).toEqual({ id: 'block:m1', role: 'start' })
  expect(recommendationDefinition.match({ type: 'turn/start', seq: SessionSeq(1), time: 0, data: { turn: 1 } })).toBeNull()
  const context = { key: 'rec:block:m1', id: 'block:m1', start: match, state: value } as Context
  expect(recommendationDefinition.start(context, match)).toEqual(value)
  expect(recommendationDefinition.update({ ...context, state: value })).toEqual(value)
  expect(recommendationDefinition.buildViewNode?.(context)).toMatchObject({
    key: 'rec:block:m1', anchorSeq: 7, visibility: 'hidden', data: value,
  })
  expect(recommendationDefinition.buildViewNode?.({ ...context, state: undefined })).toBeNull()
  expect(recommendationDefinition.buildViewNode?.({ ...context, start: undefined })).toBeNull()
})

import { expect, it } from 'vitest'
import { actionBlocksOf } from '../src/action-block.ts'

it('reads well-formed dsh-action objects in order and skips malformed or non-object fences', () => {
  const text = [
    '先回答问题。', '',
    '```dsh-action', '{"action":"create_personalized_page","title":"A","brief":"B","slot":"page"}', '```', '',
    '```dsh-action json', '[1, 2]', '```', '',
    '```dsh-action', '{not json', '```', '',
    '```ts', '{"action":"ignored"}', '```', '',
    '```dsh-action', '{"action":"other","title":"C"}', '```',
  ].join('\n')
  expect(actionBlocksOf(text)).toEqual([
    { action: 'create_personalized_page', title: 'A', brief: 'B', slot: 'page' },
    { action: 'other', title: 'C' },
  ])
  expect(actionBlocksOf('没有围栏')).toEqual([])
})

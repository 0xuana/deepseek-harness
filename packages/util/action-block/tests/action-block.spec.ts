import { expect, it } from 'vitest'
import { ACTION_BLOCK_LANGUAGE, actionBlocksOf, actionOf } from '../src/index.ts'

it('reads well-formed dsh-action objects in order and skips malformed or non-object fences', () => {
  const text = [
    '先回答问题。', '',
    `\`\`\`${ACTION_BLOCK_LANGUAGE}`, '{"action":"create_personalized_page","title":"A","brief":"B","slot":"page"}', '```', '',
    '```dsh-action json', '[1, 2]', '```', '',
    '```dsh-action', '"text"', '```', '',
    '```dsh-action', 'null', '```', '',
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

it('names the action of a block only when it is a non-blank string', () => {
  expect(actionOf({ action: 'enable_official_plugin', name: 'x' })).toBe('enable_official_plugin')
  for (const block of [{ action: ' ' }, { action: 1 }, { title: 'A' }, null, 'text', 3]) expect(actionOf(block)).toBeUndefined()
})

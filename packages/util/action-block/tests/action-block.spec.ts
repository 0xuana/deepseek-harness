import { describe, expect, it } from 'vitest'
import { ACTION_BLOCK_LANGUAGE, actionBlocksOf, actionOf, hideDirectiveFences, scanDirectiveFences } from '../src/index.ts'

const page = { action: 'create_personalized_page', title: 'A', brief: 'B', slot: 'page' }
const json = JSON.stringify(page)
const block = ['```dsh-action', json, '```'].join('\n')

describe('actionBlocksOf', () => {
  it('reads well-formed dsh-action objects in order and skips malformed or non-object fences', () => {
    const text = [
      '先回答问题。', '',
      `\`\`\`${ACTION_BLOCK_LANGUAGE}`, json, '```', '',
      '```dsh-action json', '[1, 2]', '```', '',
      '```dsh-action', '"text"', '```', '',
      '```dsh-action', 'null', '```', '',
      '```dsh-action', '{not json', '```', '',
      '```ts', '{"action":"ignored"}', '```', '',
      '```dsh-note', '{"action":"ignored"}', '```', '',
      '```dsh-action', '{"action":"other","title":"C"}', '```',
    ].join('\n')
    expect(actionBlocksOf(text)).toEqual([page, { action: 'other', title: 'C' }])
    expect(actionBlocksOf('没有围栏')).toEqual([])
  })

  it('reads the valid block after a broken one', () => {
    expect(actionBlocksOf(['```dsh-action', '{"action":', '```', '', block].join('\n'))).toEqual([page])
  })

  it('recognizes fences indented by up to three spaces but not by four', () => {
    for (const indent of [' ', '  ', '   ']) {
      expect(actionBlocksOf([`${indent}\`\`\`dsh-action`, json, `${indent}\`\`\``].join('\n'))).toEqual([page])
    }
    expect(actionBlocksOf(['    ```dsh-action', json, '    ```'].join('\n'))).toEqual([])
  })

  it('closes a fence only with a line of at least as many of the same character and nothing but trailing spaces', () => {
    expect(actionBlocksOf(['````dsh-action', json, '````'].join('\n'))).toEqual([page])
    expect(actionBlocksOf(['````dsh-action', json, '`````  '].join('\n'))).toEqual([page])
    expect(actionBlocksOf(['```dsh-action  ', json, '``` \t'].join('\n'))).toEqual([page])
    expect(actionBlocksOf(['~~~dsh-action `quoted`', json, '~~~'].join('\n'))).toEqual([page])
    expect(actionBlocksOf(['````dsh-action', json, '```', '````'].join('\n'))).toEqual([])
    expect(actionBlocksOf(['```dsh-action', json, '~~~', '```'].join('\n'))).toEqual([])
    expect(actionBlocksOf(['```dsh-action', json, '``` and more text'].join('\n'))).toEqual([])
    expect(actionBlocksOf(['```dsh-action', json, '``` and more text', '```'].join('\n'))).toEqual([])
  })

  it('treats a dsh-action example inside another fence as that fence’s content', () => {
    const markdown = ['````markdown', block, '````'].join('\n')
    const tilde = ['~~~', block, '~~~'].join('\n')
    const unclosedCode = ['```ts', 'const a = 1', block].join('\n')
    for (const text of [markdown, tilde, unclosedCode]) expect(actionBlocksOf(text)).toEqual([])
    expect(actionBlocksOf([markdown, '', tilde, '', block].join('\n'))).toEqual([page])
  })

  it('ignores an unclosed fence, a fence glued to a sentence and an inline code span', () => {
    expect(actionBlocksOf(['```dsh-action', json].join('\n'))).toEqual([])
    expect(actionBlocksOf(['方案如下：```dsh-action', json, '```'].join('\n'))).toEqual([])
    expect(actionBlocksOf(['```dsh-action``` 是标记', json, '```'].join('\n'))).toEqual([])
  })

  it('reads answers with CRLF line endings', () => {
    expect(actionBlocksOf(['回答', '', '```dsh-action', json, '```  ', ''].join('\r\n'))).toEqual([page])
  })
})

describe('scanDirectiveFences', () => {
  it('reports the offsets, closure and body of each top-level dsh- fence', () => {
    const text = 'Intro\n\n```dsh-action\n{"a":1}\n```\n\n```ts\ncode\n```\n```dsh-note extra\nline 1\nline 2\n'
    expect(scanDirectiveFences(text)).toEqual([
      { language: 'dsh-action', start: text.indexOf('```dsh-action'), end: text.indexOf('\n\n```ts') + 1, closed: true, body: '{"a":1}' },
      { language: 'dsh-note', start: text.indexOf('```dsh-note'), end: text.length, closed: false, body: 'line 1\nline 2' },
    ])
    const crlf = '```dsh-action\r\n{}\r\n```\r\nafter'
    expect(scanDirectiveFences(crlf)).toEqual([{ language: 'dsh-action', start: 0, end: crlf.indexOf('after'), closed: true, body: '{}' }])
    expect(scanDirectiveFences('```dsh-action\n```')).toEqual([{ language: 'dsh-action', start: 0, end: 17, closed: true, body: '' }])
    expect(scanDirectiveFences('``` dsh-action\n{}\n```')).toMatchObject([{ language: 'dsh-action', closed: true }])
    expect(scanDirectiveFences('```\n{}\n```\n```python\n```')).toEqual([])
  })
})

describe('hideDirectiveFences', () => {
  it('removes a closed fence and leaves one blank line where the block was', () => {
    expect(hideDirectiveFences(`A\n\n${block}\n\nB`)).toBe('A\n\nB')
    expect(hideDirectiveFences(`A\n\n${block}\nB`)).toBe('A\n\nB')
    expect(hideDirectiveFences(`A\n${block}\n\nB`)).toBe('A\n\nB')
    expect(hideDirectiveFences(`A\n${block}\nB`)).toBe('A\nB')
    expect(hideDirectiveFences(`${block}\n\n后记`)).toBe('\n后记')
    expect(hideDirectiveFences(`A\n\n${block}\n\n\`\`\`dsh-note\nx\n\`\`\`\n\nB`)).toBe('A\n\nB')
  })

  it('drops the blank line a removed last fence leaves', () => {
    expect(hideDirectiveFences(`方案在下方。\n\n${block}`)).toBe('方案在下方。\n')
    expect(hideDirectiveFences(`方案在下方。\n\n${block}\n`)).toBe('方案在下方。\n')
    expect(hideDirectiveFences(`方案在下方。\n${block}`)).toBe('方案在下方。\n')
    expect(hideDirectiveFences(block)).toBe('')
  })

  it('removes an unclosed last fence only while it is streaming', () => {
    const streaming = '说明\n\n```dsh-action\n{"action":"create_pers'
    expect(hideDirectiveFences(streaming, { streaming: true })).toBe('说明\n')
    expect(hideDirectiveFences(streaming)).toBe(streaming)
    expect(hideDirectiveFences(streaming, { streaming: false })).toBe(streaming)
    expect(hideDirectiveFences(`${block}\n\n${streaming}`)).toBe(`\n${streaming}`)
  })

  it('keeps nested examples, glued fences and the whitespace around other code blocks', () => {
    const prose = 'Intro\n\n\n```ts\n  const a = 1\n\n```\n\n\nOutro  '
    expect(hideDirectiveFences(prose)).toBe(prose)
    expect(hideDirectiveFences(`${prose}\n${block}`)).toBe(`${prose}\n`)
    for (const text of [['````markdown', block, '````'].join('\n'), ['~~~', block, '~~~'].join('\n'), ['方案：```dsh-action', json, '```'].join('\n')]) {
      expect(hideDirectiveFences(text, { streaming: true })).toBe(text)
    }
    expect(hideDirectiveFences('没有围栏')).toBe('没有围栏')
  })

  it('keeps CRLF line endings around a removed fence', () => {
    expect(hideDirectiveFences(['A', '', '```dsh-action', json, '```', '', 'B'].join('\r\n'))).toBe('A\r\n\r\nB')
  })
})

describe('actionOf', () => {
  it('names the action of a block only when it is a non-blank string', () => {
    expect(actionOf({ action: 'enable_official_plugin', name: 'x' })).toBe('enable_official_plugin')
    for (const value of [{ action: ' ' }, { action: 1 }, { title: 'A' }, null, 'text', 3]) expect(actionOf(value)).toBeUndefined()
  })
})

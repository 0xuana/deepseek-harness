import { expect, it } from 'vitest'
import { hideDirectiveFences } from '../src/client/chat/directive-fences.ts'

const block = '```dsh-action\n{"action":"create_personalized_page","title":"A","brief":"B","slot":"page"}\n```'

it('hides closed top-level dsh- fences and trims the edges they leave', () => {
  expect(hideDirectiveFences(`方案在下方。\n\n${block}`)).toBe('方案在下方。')
  expect(hideDirectiveFences(`${block}\n\n后记`)).toBe('后记')
  expect(hideDirectiveFences(`前\n\n${block}\n\n后`)).toBe('前\n\n后')
  expect(hideDirectiveFences('```dsh-action json\n{}\n```   \n尾')).toBe('尾')
})

it('keeps an unclosed fence in a finished answer and hides it while streaming', () => {
  const unclosed = '说明\n\n```dsh-action\n{"action":"create_pers'
  expect(hideDirectiveFences(unclosed)).toBe(unclosed)
  expect(hideDirectiveFences(unclosed, { streaming: false })).toBe(unclosed)
  expect(hideDirectiveFences(unclosed, { streaming: true })).toBe('说明')
})

it('follows CommonMark fences for nested examples, longer fences and fence characters after text', () => {
  const nested = '示例：\n\n````markdown\n' + block + '\n````'
  expect(hideDirectiveFences(nested)).toBe(nested)
  expect(hideDirectiveFences('前\n\n````dsh-action\n{"note":"```"}\n```\n````\n\n后')).toBe('前\n\n后')
  const glued = '见下方：```dsh-action\n{}\n```'
  expect(hideDirectiveFences(glued)).toBe(glued)
})

it('keeps other text as written, including blank lines inside other code blocks', () => {
  const code = '看代码：\n\n```ts\nconst a = 1\n\n\n\nconst b = 2\n```\n\n完'
  expect(hideDirectiveFences(code)).toBe(code)
  expect(hideDirectiveFences(`${code}\n\n${block}`)).toBe(code)
  expect(hideDirectiveFences('\n没有围栏  \n')).toBe('\n没有围栏  \n')
})

import { expect, it } from 'vitest'
import { hideDirectiveFences } from '../src/client/chat/directive-fences.ts'

it('hides dsh- fences, closed or still streaming, and keeps prose and other fences', () => {
  const block = '```dsh-action\n{"action":"create_personalized_page","title":"A","brief":"B","slot":"page"}\n```'
  expect(hideDirectiveFences(`方案在下方。\n\n${block}`)).toBe('方案在下方。')
  expect(hideDirectiveFences(`${block}\n\n后记`)).toBe('后记')
  expect(hideDirectiveFences('说明\n\n```dsh-action\n{"action":"create_pers')).toBe('说明')
  expect(hideDirectiveFences('```dsh-action json\n{}\n```   \n尾')).toBe('尾')
  const code = '看代码：\n\n```ts\nconst a = 1\n```\n\n完'
  expect(hideDirectiveFences(code)).toBe(code)
  expect(hideDirectiveFences('没有围栏')).toBe('没有围栏')
})

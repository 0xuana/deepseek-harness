/** CSS checks for the Turn tail slot held by the completed-turn footer or a steering batch start. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/client/chat/${name}`, import.meta.url)), 'utf8')

describe('Turn tail slot spacing', () => {
  it('combines the flow and footer offsets around turn-tail content', () => {
    expect(read('ChatView.module.css')).toMatch(/margin-top:\s*var\(--dsh-chat-flow-gap, 6px\)/)
    const tail = read('TurnTailNodeView.module.css')
    expect(tail).toMatch(/\.root\s*\{[^}]*gap:\s*16px/s)
    expect(tail).toMatch(/\.actions\s*\{[^}]*margin-top:\s*4px/s)
  })

  it('keeps the tail slot above a marked steering batch start and out of neighbour gaps', () => {
    const view = read('ChatView.module.css')
    const marked = String.raw`:has\(> \[data-slot="conversation\.chat\.node"\] > \[data-chat-steering-batch`
    expect(view).toMatch(new RegExp(String.raw`\.flowItem${marked}="start"\]\)\s*\{\s*--dsh-chat-flow-gap:\s*calc\(44px \+ var\(--dsh-content-font-delta, 0px\)\);`))
    expect(view.match(new RegExp(String.raw`:not\(\.running\):not\(${marked}\]\)\)\s*\{\s*--dsh-chat-flow-gap:\s*1[26]px;`, 'g'))).toHaveLength(2)
  })
})

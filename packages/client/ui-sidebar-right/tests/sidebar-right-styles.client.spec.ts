/** Right sidebar slide style contracts shared with the panel's opening effect. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DOCKED_ITEMS } from '../src/client/shell/SidebarRight.tsx'

const css = readFileSync(fileURLToPath(new URL('../src/client/shell/SidebarRight.module.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')

/** Each top-level rule in source order: its selector list and normalized declarations. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectorList = '', body = '']) => ({
  selectors: selectorList.split(',').map(value => value.trim()),
  declarations: new Map(body.split(';').filter(part => part.includes(':')).map((part) => {
    const colon = part.indexOf(':')
    return [part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' ')] as const
  })),
}))

/**
 * The index of the rule whose selector list is exactly the given selectors.
 * @param selectors - expected selector list in order.
 * @returns the rule's source position.
 */
function ruleIndex(selectors: readonly string[]): number {
  const index = rules.findIndex(rule => rule.selectors.join() === selectors.join())
  expect(index).not.toBe(-1)
  return index
}

describe('SidebarRight.module.css', () => {
  const items = DOCKED_ITEMS.split(',').map(value => `:global(${value.trim()})`)

  it('slides exactly the docked items the opening effect settles', () => {
    expect(rules[ruleIndex(items.map(item => `.panel ${item}`))]?.declarations.get('transform'))
      .toBe('translateX(var(--dsh-sidebar-width))')
    expect(rules[ruleIndex(items.map(item => `.panel[data-sidebar-right-open] ${item}`))]?.declarations.get('transform'))
      .toBe('none')
  })

  it('removes the open and close slides for reduced motion', () => {
    const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    const motion = rules[ruleIndex([...items.map(item => `.panel ${item}`), ...items.map(item => `.panel[data-sidebar-right-open] ${item}`)])]
    expect(reduce).toContain(motion!.selectors[0])
    expect(motion?.declarations.get('transition')).toBe('none')
  })

  it('overrides the open slide with the closed style while an item settles', () => {
    const open = ruleIndex(items.map(item => `.panel[data-sidebar-right-open] ${item}`))
    const settling = ruleIndex(['.panel[data-sidebar-right-open] :global([data-sidebar-right-settling])'])
    // Both selectors have the same specificity, so the later rule wins.
    expect(settling).toBeGreaterThan(open)
    expect(Object.fromEntries(rules[settling]!.declarations)).toEqual({
      transform: 'translateX(var(--dsh-sidebar-width))',
      visibility: 'hidden',
      transition: 'none',
    })
  })
})

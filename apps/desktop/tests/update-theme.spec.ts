import { readFileSync } from 'node:fs'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'

it.each([false, true])('applies the initial app palette before the card and follows changes (dark=%s)', (dark) => {
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' })
  const palette = Object.assign(new dom.window.EventTarget(), { matches: dark, media: '(prefers-color-scheme: dark)',
    onchange: null, addListener: vi.fn(), removeListener: vi.fn() })
  const remove = vi.spyOn(palette, 'removeEventListener')
  dom.window.matchMedia = vi.fn(() => palette)
  try {
    runInContext(readFileSync(new URL('../renderer/update-theme.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
    expect(dom.window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
    expect(dom.window.document.body.hasAttribute('data-ds-dark-theme')).toBe(dark)
    palette.matches = !dark
    palette.dispatchEvent(new dom.window.Event('change'))
    expect(dom.window.document.body.hasAttribute('data-ds-dark-theme')).toBe(!dark)
    dom.window.dispatchEvent(new dom.window.Event('pagehide'))
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function))
    palette.matches = dark
    palette.dispatchEvent(new dom.window.Event('change'))
    expect(dom.window.document.body.hasAttribute('data-ds-dark-theme')).toBe(!dark)
  } finally { dom.window.close() }
})

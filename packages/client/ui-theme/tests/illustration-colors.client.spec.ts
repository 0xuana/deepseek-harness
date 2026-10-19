// @vitest-environment jsdom
/** Decorative artwork keeps separate foreground, backing, and detail colors. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'

const stylesheet = readFileSync(resolve(import.meta.dirname, '../src/styles/design-platform.css'), 'utf8')
let style: HTMLStyleElement

beforeEach(() => {
  style = document.createElement('style')
  style.textContent = stylesheet
  document.head.append(style)
})

afterEach(() => {
  style.remove()
  document.body.removeAttribute('data-ds-dark-theme')
})

it('preserves the light illustration palette and paper-colored clock face', () => {
  const colors = getComputedStyle(document.body)
  expect(colors.getPropertyValue('--dsw-alias-illustration-background').trim()).toBe('rgb(245,247,250)')
  expect(colors.getPropertyValue('--dsw-alias-illustration-surface').trim()).toBe('rgb(237,240,244)')
  expect(colors.getPropertyValue('--dsw-alias-illustration-backing').trim()).toBe('rgb(202,210,219)')
  expect(colors.getPropertyValue('--dsw-alias-illustration-detail').trim()).toBe('rgb(202,210,219)')
  expect(colors.getPropertyValue('--dsw-alias-illustration-clock-face').trim()).toBe('var(--dsw-alias-illustration-surface)')
})

it('separates dark paper layers from details and uses the middle tone for the clock face', () => {
  document.body.setAttribute('data-ds-dark-theme', '')
  const colors = getComputedStyle(document.body)
  expect(colors.getPropertyValue('--dsw-alias-illustration-surface').trim()).toBe('var(--dsw-static-neutral-bluish-700)')
  expect(colors.getPropertyValue('--dsw-alias-illustration-backing').trim()).toBe('var(--dsw-static-neutral-bluish-750)')
  expect(colors.getPropertyValue('--dsw-alias-illustration-background').trim()).toBe('var(--dsw-static-neutral-bluish-850)')
  expect(colors.getPropertyValue('--dsw-alias-illustration-detail').trim()).toBe('var(--dsw-static-neutral-bluish-600)')
  expect(colors.getPropertyValue('--dsw-alias-illustration-shadow').trim()).toBe('var(--dsw-static-neutral-bluish-750)')
  expect(colors.getPropertyValue('--dsw-alias-illustration-clock-face').trim()).toBe('var(--dsw-alias-illustration-backing)')
})

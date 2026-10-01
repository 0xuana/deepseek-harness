import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(
  fileURLToPath(new URL('../src/client/QuestionComposer.module.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, ' ')

function declarations(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rule = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^{}]*)\\}`).exec(stylesheet)
  if (rule === null) throw new Error(`QuestionComposer.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('QuestionComposer compact long-copy layout', () => {
  it('keeps fitting descriptions in the original option-line typography', () => {
    expect(declarations('.descriptionInline')).toEqual(expect.arrayContaining([
      'font-size: 14px',
      'line-height: 24px',
      'font-weight: 400',
    ]))
  })

  it('keeps the option description to one ellipsized line', () => {
    expect(declarations('.description')).toEqual(expect.arrayContaining([
      'display: block',
      'min-width: 0',
      'overflow: hidden',
      'font-size: 13px',
      'line-height: 20px',
      'text-overflow: ellipsis',
      'white-space: nowrap',
    ]))
  })

  it('keeps the question and choices in the card scrollport', () => {
    expect(declarations('.body')).toEqual(expect.arrayContaining([
      'min-height: 0',
      'overflow-y: auto',
    ]))
    expect(declarations('.title')).toContain('flex-shrink: 0')
  })
})

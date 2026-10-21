/** First-party display translations cannot silently omit a language or bypass their locale owner. */
import { expect, it } from 'vitest'
import { localizedTextProblems } from './verify-localized-text.ts'
import { gatesForMode } from './run-gates.ts'

it.each(['en', 'zh', 'ja'])('rejects a missing %s translation', (missing) => {
  const fields = ['en', 'zh', 'ja'].filter(language => language !== missing).map(language => `${language}: 'text'`).join(',')
  expect(localizedTextProblems('packages/demo/plugin/src/locales.ts', `const display = { ${fields} }`).join('\n'))
    .toContain(`missing ${missing}`)
})

it('accepts complete locale-owned prose and dictionary references in registration code', () => {
  expect(localizedTextProblems('packages/demo/plugin/src/locales.ts', "const text = { en: 'Text', zh: '文本', ja: '文' }")).toEqual([])
  expect(localizedTextProblems('packages/demo/plugin/src/index.ts', 'register(NS, { en, zh, ja })')).toEqual([])
})

it('rejects inline display copy, including generated-looking files', () => {
  const source = "const text = { en: 'Text', zh: '文本', ja: '文' }"
  for (const file of ['index.ts', 'copy.generated.ts']) {
    expect(localizedTextProblems(`packages/demo/plugin/src/${file}`, source).join('\n')).toContain('owning locales file')
  }
})

it('admits only the runtime baseline definition and still checks other maps in the same file', () => {
  const file = 'packages/client/locale/src/client/index.ts'
  expect(localizedTextProblems(file, 'const BUILT_IN_LOCALE_METADATA = { en: {}, zh: {} } as const satisfies Metadata')).toEqual([])
  expect(localizedTextProblems(file, 'const other = { en: dictionary, zh: dictionary }').join('\n')).toContain('missing ja')
})

it('checks dynamic display text maps', () => {
  expect(localizedTextProblems('packages/demo/plugin/src/locales.ts', 'const display = { en: format(reason), zh: format(reason) }')
    .join('\n')).toContain('missing ja')
})

it('keeps completeness checks in local and CI aggregates', () => {
  for (const mode of ['i18n', 'check-all', 'ci-static', 'hygiene'] as const) {
    const ids = gatesForMode(mode).map(gate => gate.id)
    expect(ids).toEqual(expect.arrayContaining(['locale-metadata', 'localized-text', 'locale-dictionaries']))
  }
})

it('rejects English-only display maps instead of allowing an implicit fallback', () => {
  expect(localizedTextProblems('packages/demo/plugin/src/locales.ts', "const display = { en: 'Text' }").join('\n'))
    .toContain('missing ja')
})

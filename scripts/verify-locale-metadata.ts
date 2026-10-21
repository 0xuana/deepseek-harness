/** Check Japanese coverage of package metadata and plugin templates without loading plugins. */
import { existsSync, globSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { collectConfigCatalog } from './gen-config-catalog.ts'

/** Flatten metadata strings and reject values that cannot be translated. */
function strings(value: unknown, key = ''): Record<string, string> {
  if (typeof value === 'string' && value.trim() !== '') return { [key]: value }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${key}: expected non-empty text`)
  return Object.fromEntries(Object.entries(value).flatMap(([name, child]) => Object.entries(strings(child, key ? `${key}.${name}` : name))))
}

/**
 * Compare Japanese metadata with every field supplied by English or Chinese.
 * @param root - repository or fixture root.
 * @returns actionable missing-file, field, placeholder and resource diagnostics.
 */
export function localeMetadataProblems(root: string): string[] {
  const directories = new Set(globSync('packages/**/locale/*.json', {
    cwd: root, exclude: ['packages/**/node_modules/**', 'packages/**/lib/**', 'packages/**/tests/**'],
  }).filter(file => ['en.json', 'zh.json', 'ja.json'].includes(basename(file))).map(dirname))
  const loadable = new Set<string>()
  for (const entry of collectConfigCatalog(root)) {
    // Test-support providers are fixtures, outside the product plugin inventory.
    if (entry.dir.startsWith('packages/test-support/')) continue
    if (entry.kind !== 'config' && entry.kind !== 'no-config') continue
    const directory = join(entry.dir, 'locale')
    loadable.add(directory)
    directories.add(directory)
  }
  const problems: string[] = []
  if (directories.size === 0) return ['no package locale metadata found']
  for (const directory of [...directories].sort()) {
    try {
      const read = (language: string): Record<string, string> => {
        const file = join(root, directory, `${language}.json`)
        const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
        return strings(value)
      }
      const en = read('en')
      const zh = loadable.has(directory) || existsSync(join(root, directory, 'zh.json')) ? read('zh') : {}
      const ja = read('ja')
      const expected = { ...zh, ...en }
      for (const key of new Set([...Object.keys(expected), ...Object.keys(ja)])) {
        if (ja[key] === undefined) problems.push(`${directory}/ja.json: missing ${key}`)
        else if (expected[key] === undefined) problems.push(`${directory}/ja.json: unexpected ${key}`)
        else {
          const placeholders = (text: string): string => (text.match(/\{\w+\}/gu) ?? []).sort().join(',')
          if (placeholders(ja[key]) !== placeholders(expected[key])) problems.push(`${directory}/ja.json: ${key} changes placeholders`)
          if (key === 'meta.detail' && !existsSync(resolve(root, directory, '..', ja[key]))) {
            problems.push(`${directory}/ja.json: missing detail resource ${ja[key]}`)
          }
        }
      }
    } catch (error) {
      problems.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return problems
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) {
  const problems = localeMetadataProblems(process.cwd())
  for (const problem of problems) console.error(problem)
  if (problems.length > 0) process.exitCode = 1
  else console.log('verify-locale-metadata: all package and template metadata has complete Japanese translations.')
}

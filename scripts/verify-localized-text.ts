/** Keep first-party localized-text maps complete and their prose in locale-owned files. */
import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

/**
 * Inspect source translation maps, including maps outside Client namespace dictionaries.
 * @param file - repository-relative source file.
 * @param text - TypeScript or TSX source.
 * @returns incomplete-map and misplaced-copy diagnostics.
 */
export function localizedTextProblems(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true)
  const problems: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const fields = new Map<string, ts.Expression>()
      for (const prop of node.properties) {
        if (ts.isShorthandPropertyAssignment(prop)) fields.set(prop.name.text, prop.name)
        else if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) {
          fields.set(prop.name.text, prop.initializer)
        }
      }
      const languages = ['en', 'zh', 'ja'].filter(language => fields.has(language))
      const literal = [...fields].some(([language, value]) =>
        languages.includes(language) && (ts.isStringLiteralLike(value) || ts.isTemplateExpression(value)))
      if (languages.length >= 2 || literal) {
        // Runtime baseline definitions are extended by addLanguage; these are not translations.
        let declaration = node.parent
        while (ts.isAsExpression(declaration) || ts.isSatisfiesExpression(declaration)) declaration = declaration.parent
        const baseline = file === 'packages/client/locale/src/client/index.ts'
          && ts.isVariableDeclaration(declaration) && declaration.name.getText(source) === 'BUILT_IN_LOCALE_METADATA'
        if (!baseline) {
          const site = `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`
          for (const language of ['en', 'zh', 'ja']) {
            if (!fields.has(language)) problems.push(`${site}: localized text is missing ${language}`)
          }
          const prose = [...fields.values()].some(value => ts.isStringLiteralLike(value) || ts.isTemplateExpression(value))
          const owner = /(?:^|\/)locales(?:\.tsx?$|\/)/u.test(file)
          // This generated file derives from JSON metadata covered by verify-locale-metadata.
          const metadata = file === 'packages/boot/app-boot/src/official-bundles.generated.ts'
          if (prose && !owner && !metadata) problems.push(`${site}: move translated prose into an owning locales file`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return problems
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) {
  const files = globSync('packages/*/*/src/**/*.{ts,tsx}').filter(file => !file.endsWith('.d.ts'))
  if (files.length === 0) throw new Error('verify-localized-text: no package sources found')
  const problems = files.flatMap(file => localizedTextProblems(file.replaceAll('\\', '/'), readFileSync(file, 'utf8')))
  for (const problem of problems) console.error(problem)
  if (problems.length > 0) process.exitCode = 1
  else console.log(`verify-localized-text: ${files.length} sources have complete, locale-owned translation maps.`)
}

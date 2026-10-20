/** Admit only a newly named bundle whose patch adds its own rows. */
import { lstat, readdir, readFile, readlink, realpath } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { z } from 'zod'
import { parseDocument } from 'yaml'
import { exports as resolveExports } from 'resolve.exports'

/** Validate model-written files before profile installation.
 * @param directory - Host-reserved output directory.
 * @param name - Host-reserved package name.
 * @returns after package identity, insert-only rows, built entries and portable links have been checked; does not execute code.
 */
export async function validateGeneratedBundle(directory: string, name: string): Promise<void> {
  const manifestPath = await containedFile(directory, 'package.json')
  const manifest = z.looseObject({
    name: z.literal(name), version: z.string().min(1),
    main: z.string().optional(), exports: z.unknown().optional(),
    dsh: z.object({ bundle: z.object({ patch: z.literal('./cordis.patch.yml') }) }),
  }).parse(JSON.parse(await readFile(manifestPath, 'utf8')))
  const patchPath = await containedFile(directory, manifest.dsh.bundle.patch)
  const document = parseDocument(await readFile(patchPath, 'utf8'), { schema: 'core', customTags: [] })
  if (document.errors.length || document.warnings.length) throw new Error('Generated patches must use plain YAML without custom tags or includes.')
  const patch = z.array(z.object({
    insert: z.array(z.looseObject({ id: z.string().min(1), name: z.string().min(1), group: z.literal(false).optional() })).min(1),
  }).strict()).min(1).parse(document.toJS({ maxAliasCount: 0 }))
  const ids = new Set<string>()
  for (const operation of patch) for (const row of operation.insert) {
    if (!row.id.startsWith(name + ':') || ids.has(row.id)
      || row.name !== name && !row.name.startsWith(name + '/')) {
      throw new Error('Generated bundles must add uniquely named rows from their own package.')
    }
    ids.add(row.id)
    const target = manifest.exports === undefined
      ? row.name === name ? manifest.main ?? './index.js' : './' + row.name.slice(name.length + 1)
      : resolveExports(manifest, row.name)?.[0]
    if (target === undefined || !['.js', '.mjs', '.cjs'].includes(extname(target))) {
      throw new Error(`Build and export the runtime entry for ${row.name} before installation.`)
    }
    const entry = await containedFile(directory, target)
    if (!(await lstat(entry)).isFile()) throw new Error(`The runtime entry for ${row.name} must be a built file.`)
  }
  await validateLinks(await realpath(directory), directory)
}

/** Relative links must continue to work when the bundle is copied out of the workspace. */
async function validateLinks(root: string, directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      const link = await readlink(path)
      if (isAbsolute(link)) throw new Error('Generated bundle links must be relative and stay inside the bundle.')
      await containedFile(root, resolve(dirname(path), link))
    } else if (entry.isDirectory()) await validateLinks(root, path)
  }
}

async function containedFile(directory: string, file: string): Promise<string> {
  const root = await realpath(directory)
  const path = await realpath(resolve(directory, file))
  if (!path.startsWith(root + sep)) throw new Error('Generated bundle files must remain inside their reserved directory.')
  return path
}

/** Comment-preserving profile plugin enablement edits and the entry flattening they compare against. */
import { readFile } from 'node:fs/promises'
import { isMap, isNode, isScalar, isSeq, parseDocument, Scalar, visit } from 'yaml'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { isJsExpr, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { composeEntries, loadOptionalPatches, loadProfileDirectory, readBundlePatches, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** Flatten only the groups addressable by the profile's patch composer.
 * @param rows Composed top-level entries.
 * @returns Entries in depth-first order.
 */
export function flatten(rows: EntryOptions[]): EntryOptions[] {
  return rows.flatMap(row => [row, ...(row.group && Array.isArray(row.config) ? flatten(row.config as EntryOptions[]) : [])])
}

/** Read the shared profile patch dialect while retaining comments and expression tags. */
async function readPatchDocument(filename: string) {
  let text: string
  try {
    text = await readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    text = '[]\n'
  }
  const document = parseDocument(text, {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
  })
  const error = document.errors[0]
  if (error !== undefined) throw error
  if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
  return { document, sequence: document.contents }
}

/**
 * Prepare persistent settings for explicit bundle enablement.
 * @param profile Profile whose existing entries receive top-level field overrides.
 * @param input Untrusted bundle manifest declaration, keyed by profile entry id.
 * @returns Complete profile patch text, or undefined when the requested settings already match.
 * @throws Invalid declarations, missing or ambiguous entries, whole-config expressions, and higher-layer overrides.
 */
export async function prepareBundleConfiguration(
  profile: ProfileContext, input: unknown,
): Promise<string | undefined> {
  const configuration = z.record(z.string().min(1), z.record(z.string(), z.json())).parse(input)
  const loaded = loadProfileDirectory('dsh', profile.dir, profile.installAnchor)
  const rows = flatten(composeEntries([...loaded.layers.map(layer => layer.patches), loaded.patches]))
  const patches = Object.entries(configuration).map(([id, fields]) => {
    const matches = rows.filter(row => row.id === id)
    const entry = matches[0]
    const current: unknown = entry?.config
    if (isJsExpr(current)) {
      throw new Error(`Bundle enablement cannot edit the whole-config expression for "${id}"; use a literal config mapping`)
    }
    if (matches.length !== 1 || entry === undefined || entry.group
      || (current !== undefined && (current === null || typeof current !== 'object' || Array.isArray(current)))) {
      throw new Error(`Bundle enablement requires one configurable profile entry "${id}"`)
    }
    const config = { ...current, ...fields }
    return { id, name: entry.name, config }
  })
  const effective = flatten(composeEntries([readProfilePatches('dsh', profile, {
    ...loaded, patches: [...loaded.patches, ...patches],
  })]))
  for (const [id, fields] of Object.entries(configuration)) {
    const config: unknown = effective.find(row => row.id === id)?.config
    if (config === null || typeof config !== 'object' || Array.isArray(config)
      || Object.entries(fields).some(([key, value]) => !isDeepStrictEqual((config as Record<string, unknown>)[key], value))) {
      throw new Error(`Bundle enablement configuration for "${id}" is overridden by a home patch or command-line overlay`)
    }
  }
  if (patches.every(patch => isDeepStrictEqual(rows.find(row => row.id === patch.id)?.config, patch.config))) return undefined
  const { document, sequence } = await readPatchDocument(profile.patchPath)
  sequence.flow = false
  for (const { id, name, config } of patches) {
    const index = sequence.items.findLastIndex((item, index) => isMap(item)
      && document.getIn([index, 'id']) === id && !item.has('insert')
      && (!item.has('name') || document.getIn([index, 'name']) === name))
    const previous = sequence.items[index]
    const anchors: string[] = []
    if (isNode(previous)) visit(previous, { Node(_key, node) {
      if ('anchor' in node && node.anchor) {
        anchors.push(node.anchor)
        return visit.BREAK
      }
    } })
    if (index < 0 || anchors.length > 0) document.add(document.createNode({ id, name, config }))
    else document.setIn([index, 'config'], document.createNode(config))
  }
  visit(document, { Map(_key, node) {
    if (node.items.length !== 1 || typeof node.get('__jsExpr') !== 'string') return
    const expression = new Scalar(node.get('__jsExpr'))
    expression.tag = 'tag:yaml.org,2002:js'
    return expression
  } })
  return String(document)
}

/** Replace the last matching override or append one after existing insertions. An override that holds only `id` and
 * `disabled`, without anchors, is removed, or not appended, when the bundle layers and the remaining profile patches
 * already give the entry the requested literal `disabled` value; home patches and launch overlays are not consulted.
 * @param profile Profile whose patch file is edited and whose selected bundles supply the compared composition.
 * @param id Unique composition entry id.
 * @param name Module name used to match name-qualified overrides.
 * @param enabled Desired entry enablement.
 * @returns Whether the file changed.
 */
export async function writePluginEnabled(profile: ProfileContext, id: string, name: string, enabled: boolean): Promise<boolean> {
  const filename = profile.patchPath
  const { document, sequence } = await readPatchDocument(filename)
  const patches = loadOptionalPatches('dsh', filename) ?? []
  const bundlePatches = readBundlePatches('dsh', profile)
  const items = sequence.items
  const target = items.findLast((item, index) => {
    if (!isMap(item) || document.getIn([index, 'id']) !== id || item.has('insert')) return false
    const expectedName = document.getIn([index, 'name'])
    return !expectedName || expectedName === name
  })
  // Compares the entry's own literal `disabled`; a `!!js` value never matches, so its override is kept.
  const implied = (index: number): boolean => {
    const row = flatten(composeEntries([[...bundlePatches, ...patches.toSpliced(index, 1)]])).findLast(entry => entry.id === id)
    return row !== undefined && (row.disabled ?? false) === !enabled
  }
  if (isMap(target)) {
    const index = items.indexOf(target)
    // A removed anchor would leave later aliases unresolved.
    const onlySwitch = target.anchor === undefined && target.items.every(pair => isScalar(pair.key) && isScalar(pair.value)
      && pair.key.anchor === undefined && pair.value.anchor === undefined && (pair.key.value === 'id' || pair.key.value === 'disabled'))
    if (onlySwitch && implied(index)) {
      document.deleteIn([index])
      // The comment above the removed override can be the file header, so it moves to the following item, above an
      // emptied sequence, or after the remaining items.
      const comment = target.commentBefore
      const next = items[index]
      if (comment && isNode(next)) next.commentBefore = next.commentBefore ? `${comment}\n${next.commentBefore}` : comment
      else if (comment && items.length === 0) sequence.commentBefore = comment
      else if (comment) document.comment = document.comment ? `${comment}\n${document.comment}` : comment
    } else if (document.getIn([index, 'disabled']) === !enabled) {
      return false
    } else {
      document.setIn([index, 'disabled'], !enabled)
    }
  } else {
    if (implied(items.length)) return false
    document.add({ id, disabled: !enabled })
  }
  await writeFileAtomic(filename, String(document), { mode: 0o600 })
  return true
}

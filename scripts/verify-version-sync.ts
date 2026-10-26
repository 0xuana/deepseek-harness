/**
 * Check that every released manifest carries the root version. A release
 * synchronization bumps them together, so a mismatch means a merge combined two
 * version lines: a pull request that bumps versions merged onto a master that
 * added a package, for instance.
 *
 * The check reads manifests only, so it needs no installed dependency.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

/** One manifest's version, with `undefined` when the file does not declare one. */
export interface ManifestVersion {
  /** Repository-relative path of the manifest. */
  readonly path: string
  readonly version: string | undefined
}

/** The root version and every released manifest's version. */
export interface VersionReport {
  readonly rootVersion: string | undefined
  readonly manifests: ManifestVersion[]
}

/** Directories that hold released manifests below the repository root. */
const MANIFEST_DIRECTORIES = ['packages', 'apps'] as const

/**
 * Describe an error for a reader.
 * @param error - Caught value.
 * @returns Its message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read the version one `package.json` declares.
 * @param path - Absolute path of the manifest.
 * @returns The declared version, or `undefined` when it declares none.
 */
function versionOf(path: string): string | undefined {
  const manifest: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof manifest !== 'object' || manifest === null) return undefined
  const version: unknown = (manifest as { version?: unknown }).version
  return typeof version === 'string' ? version : undefined
}

/**
 * Collect the manifests that must carry the root version: `packages/<group>/<package>` and
 * `apps/<application>`. A directory that cannot be read, and a walk that finds nothing, are
 * errors rather than a clean tree, so a narrowed corpus cannot pass the check.
 * @param root - Repository root.
 * @returns Manifest paths relative to the root, sorted.
 */
export function releasedManifests(root: string): string[] {
  const paths: string[] = []
  for (const directory of MANIFEST_DIRECTORIES) {
    let groups: string[]
    try {
      groups = readdirSync(join(root, directory))
    } catch (error) {
      throw new Error(`cannot read ${directory}/: ${messageOf(error)}`)
    }
    for (const group of groups) {
      const groupDirectory = join(root, directory, group)
      let isDirectory: boolean
      try {
        isDirectory = statSync(groupDirectory).isDirectory()
      } catch (error) {
        throw new Error(`cannot read ${directory}/${group}: ${messageOf(error)}`)
      }
      if (!isDirectory) continue
      const manifest = join(groupDirectory, 'package.json')
      try {
        if (statSync(manifest).isFile()) paths.push(`${directory}/${group}/package.json`)
      } catch {
        // A directory without a manifest is not a package.
      }
      for (const entry of readdirSync(groupDirectory)) {
        const nested = `${directory}/${group}/${entry}/package.json`
        try {
          if (statSync(join(root, nested)).isFile()) paths.push(nested)
        } catch {
          // Not a package directory.
        }
      }
    }
  }
  if (paths.length === 0) throw new Error(`no released manifest was found under ${MANIFEST_DIRECTORIES.map(directory => `${directory}/`).join(' or ')}`)
  return paths.sort()
}

/**
 * Compare every released manifest with the root version.
 * @param rootVersion - Version of the root `package.json`.
 * @param manifests - Each manifest's path and version.
 * @returns The manifests that carry another version or none, in path order.
 */
export function mismatchedVersions(rootVersion: string, manifests: readonly ManifestVersion[]): ManifestVersion[] {
  return manifests.filter(manifest => manifest.version !== rootVersion).sort((left, right) => left.path.localeCompare(right.path))
}

/**
 * Read the root version and the released manifests of a repository.
 * @param root - Repository root.
 * @returns Root version and manifests.
 */
export function readVersions(root: string): VersionReport {
  const rootVersion = versionOf(join(root, 'package.json'))
  const manifests = releasedManifests(root).map(path => ({ path, version: versionOf(join(root, path)) }))
  return { rootVersion, manifests }
}

/**
 * Report whether every released manifest carries the root version.
 * @param report - Root version and manifests.
 * @returns Whether the tree is synchronized; a tree without a root version or without manifests is not.
 */
export function versionsSynchronized(report: VersionReport): boolean {
  const { rootVersion, manifests } = report
  return rootVersion !== undefined && manifests.length > 0 && mismatchedVersions(rootVersion, manifests).length === 0
}

/**
 * Describe a version mismatch for a reader.
 * @param report - Root version and manifests.
 * @returns One line when the tree is consistent, otherwise a header and one line per mismatched manifest.
 */
export function describeVersions(report: VersionReport): string[] {
  const { rootVersion, manifests } = report
  if (rootVersion === undefined) return ['the root package.json declares no version']
  const mismatched = mismatchedVersions(rootVersion, manifests)
  if (mismatched.length === 0) return [`${manifests.length} released manifest(s) carry ${rootVersion}`]
  return [
    `${mismatched.length} of ${manifests.length} released manifest(s) do not carry the root version ${rootVersion}:`,
    ...mismatched.map(manifest => `  ${manifest.path}: ${manifest.version ?? 'no version'}`),
  ]
}

const invokedPath = process.argv[1]
const isMain = invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href
if (isMain) {
  try {
    const report = readVersions(resolve(import.meta.dirname, '..'))
    const synchronized = versionsSynchronized(report)
    for (const line of describeVersions(report)) (synchronized ? console.log : console.error)(`verify-version-sync: ${line}`)
    if (!synchronized) process.exitCode = 1
  } catch (error) {
    console.error(`verify-version-sync: ${messageOf(error)}`)
    process.exitCode = 1
  }
}

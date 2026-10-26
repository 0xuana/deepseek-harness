import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeVersions, mismatchedVersions, readVersions, releasedManifests } from './verify-version-sync.ts'

/**
 * Build a repository holding the given manifests.
 * @param files - Manifest path to version, or to `null` for a manifest without one.
 * @returns The temporary root.
 */
function repository(files: Record<string, string | null>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-version-sync-'))
  for (const [path, version] of Object.entries(files)) {
    const absolute = join(root, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, JSON.stringify(version === null ? { name: 'x' } : { name: 'x', version }))
  }
  return root
}

describe('released manifests', () => {
  it('collects the packages and applications of the root version and skips other version lines', () => {
    const root = repository({
      'package.json': '1.0.0',
      'packages/core/session/package.json': '1.0.0',
      'packages/AGENTS.md': null,
      'apps/cli/package.json': '1.0.0',
      'vendor/cordis/package.json': '4.0.5',
      'native/system/package.json': '0.1.2',
    })
    try {
      expect(releasedManifests(root)).toEqual(['apps/cli/package.json', 'packages/core/session/package.json'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('version synchronization', () => {
  it('names a manifest left on another version or without one', () => {
    const root = repository({
      'package.json': '2.0.0',
      'packages/core/session/package.json': '2.0.0',
      'packages/core/agent/package.json': '1.0.0',
      'apps/cli/package.json': null,
    })
    try {
      expect(describeVersions(readVersions(root))).toEqual([
        '2 of 3 released manifest(s) do not carry the root version 2.0.0:',
        '  apps/cli/package.json: no version',
        '  packages/core/agent/package.json: 1.0.0',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('accepts a tree whose released manifests all carry the root version', () => {
    const root = repository({
      'package.json': '3.0.0',
      'packages/core/session/package.json': '3.0.0',
      'apps/web/package.json': '3.0.0',
      'vendor/cordis/package.json': '4.0.5',
    })
    try {
      const report = readVersions(root)
      expect(mismatchedVersions(report.rootVersion ?? '', report.manifests)).toEqual([])
      expect(describeVersions(report)).toEqual(['2 released manifest(s) carry 3.0.0'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

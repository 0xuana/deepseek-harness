import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSteps, preMergeCheck, type PreMergePlan } from './pre-merge-check.ts'

/**
 * Build a repository holding the given manifests.
 * @param files - Manifest path to version.
 * @returns The temporary root.
 */
function repository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pre-merge-'))
  for (const [path, version] of Object.entries(files)) {
    const absolute = join(root, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, JSON.stringify({ name: 'x', version }))
  }
  return root
}

/**
 * A plan whose commands exit with the given codes, so the check runs without pnpm.
 * @param codes - Exit code of the install and of each build.
 * @returns The plan.
 */
function plan(codes: readonly number[]): PreMergePlan {
  const step = (name: string, code: number) => ({ name, command: process.execPath, args: ['-e', `process.exit(${code})`] })
  const [install, ...builds] = codes
  return { install: step('install', install ?? 0), steps: builds.map((code, index) => step(`build-${index}`, code)) }
}

describe('pre-merge check', () => {
  it('passes an install, a version check, and the builds that all succeed', async () => {
    const root = repository({ 'package.json': '1.0.0', 'packages/core/session/package.json': '1.0.0' })
    try {
      const lines: string[] = []
      expect(await preMergeCheck(root, { plan: plan([0, 0, 0]), report: line => void lines.push(line) })).toEqual({ ok: true })
      expect(lines[0]).toBe('verify-version-sync: 1 released manifest(s) carry 1.0.0')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports a failed install without running the builds', async () => {
    const root = repository({ 'package.json': '1.0.0', 'packages/core/session/package.json': '1.0.0' })
    try {
      const lines: string[] = []
      const outcome = await preMergeCheck(root, { plan: plan([2, 0]), report: line => void lines.push(line) })
      expect(outcome).toEqual({ ok: false, reason: 'the install failed' })
      expect(lines.some(line => line.startsWith('pre-merge-check: building'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails a tree whose released manifests carry another version', async () => {
    const root = repository({ 'package.json': '2.0.0', 'packages/core/session/package.json': '1.0.0' })
    try {
      const outcome = await preMergeCheck(root, { plan: plan([0, 0, 0]), report: () => {} })
      expect(outcome).toEqual({ ok: false, reason: 'the released manifests do not carry the root version' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('builds the host contracts before the client', () => {
    expect(buildSteps().map(step => step.name)).toEqual(['host contracts', 'client'])
  })
})

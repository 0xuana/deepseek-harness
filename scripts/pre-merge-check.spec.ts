import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkMode, failureDecision, preMergeCheck, preMergeSteps, type PreMergeOutcome, type PreMergeStep } from './pre-merge-check.ts'

/**
 * Build a repository holding the given manifests.
 * @param files - Manifest path to version.
 * @param directories - Extra directories to create.
 * @returns The temporary root.
 */
function repository(files: Record<string, string>, directories: readonly string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pre-merge-'))
  for (const directory of directories) mkdirSync(join(root, directory), { recursive: true })
  for (const [path, version] of Object.entries(files)) {
    const absolute = join(root, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, JSON.stringify({ name: 'x', version }))
  }
  return root
}

/**
 * Steps that exit with the given codes, so the check runs without pnpm.
 * @param codes - Exit code of each step, in order.
 * @returns The steps.
 */
function steps(codes: readonly number[]): PreMergeStep[] {
  return codes.map((code, index) => ({ name: `step-${index}`, command: process.execPath, args: ['-e', `process.exit(${code})`] }))
}

/** What one run reported. */
interface CheckRun {
  readonly outcome: PreMergeOutcome
  readonly lines: string[]
}

/**
 * Run the check on a repository and collect its lines.
 * @param root - Repository root.
 * @param codes - Exit code of each step.
 * @returns Outcome and reported lines.
 */
async function check(root: string, codes: readonly number[]): Promise<CheckRun> {
  const lines: string[] = []
  const outcome = await preMergeCheck(root, { steps: steps(codes), report: line => void lines.push(line) })
  return { outcome, lines }
}

describe('pre-merge check', () => {
  it('passes the steps and the version check when they all succeed', async () => {
    const root = repository({ 'package.json': '1.0.0', 'packages/core/session/package.json': '1.0.0', 'apps/web/package.json': '1.0.0' })
    try {
      const { outcome, lines } = await check(root, [0, 0, 0])
      expect(outcome).toEqual({ ok: true })
      expect(lines[0]).toBe('verify-version-sync: 2 released manifest(s) carry 1.0.0')
      expect(lines.slice(1)).toEqual(['pre-merge-check: running step-0', 'pre-merge-check: running step-1', 'pre-merge-check: running step-2'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('stops at the first step that fails', async () => {
    const root = repository({ 'package.json': '1.0.0', 'packages/core/session/package.json': '1.0.0', 'apps/web/package.json': '1.0.0' })
    try {
      const { outcome, lines } = await check(root, [1, 0])
      expect(outcome).toEqual({ ok: false, reason: 'the step-0 step failed' })
      expect(lines).not.toContain('pre-merge-check: running step-1')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports a command that cannot start', async () => {
    const root = repository({ 'package.json': '1.0.0', 'packages/core/session/package.json': '1.0.0', 'apps/web/package.json': '1.0.0' })
    try {
      const outcome = await preMergeCheck(root, {
        steps: [{ name: 'missing', command: join(root, 'no-such-command'), args: [] }],
        report: () => {},
      })
      expect(outcome.ok).toBe(false)
      expect(outcome.reason).toContain('cannot run')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails a tree whose released manifests carry another version', async () => {
    const root = repository({ 'package.json': '2.0.0', 'packages/core/session/package.json': '1.0.0', 'apps/web/package.json': '2.0.0' })
    try {
      const { outcome } = await check(root, [0, 0])
      expect(outcome).toEqual({ ok: false, reason: 'the released manifests do not carry the root version' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails when a manifest directory cannot be read', async () => {
    const root = repository({ 'package.json': '1.0.0', 'packages/core/session/package.json': '1.0.0' })
    try {
      const { outcome, lines } = await check(root, [0])
      expect(outcome.ok).toBe(false)
      expect(outcome.reason).toContain('cannot read the released manifests')
      expect(lines[0]).toContain('cannot read the released manifests')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('annotates a failure as a warning and passes in report mode', () => {
    expect(checkMode('report')).toBe('report')
    expect(checkMode('block')).toBe('block')
    expect(checkMode('off')).toBe('off')
    expect(checkMode('nonsense')).toBe('report')
    expect(checkMode(undefined)).toBe('report')
    expect(failureDecision('report', 'the install step failed')).toEqual({
      line: '::warning title=Pre-Merge Check::the merged tree fails its pre-merge check: the install step failed',
      exitCode: 0,
    })
    expect(failureDecision('block', 'the install step failed')).toEqual({
      line: '::error title=Pre-Merge Check::the merged tree fails its pre-merge check: the install step failed',
      exitCode: 1,
    })
    expect(failureDecision('off', 'the client step failed').exitCode).toBe(0)
  })

  it('installs before it builds the host contracts and the client', () => {
    expect(preMergeSteps().map(step => step.name)).toEqual(['install', 'host contracts', 'client'])
  })
})

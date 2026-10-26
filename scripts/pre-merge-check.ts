/**
 * Validate the tree a pull request produces once merged with its base branch: the install,
 * the version synchronization of the released manifests, and the Host and Client builds.
 *
 * The pull-request check runs this through `pnpm run pre-merge-check` and knows only that
 * script's name, so what the merged tree needs changes here without touching the check. The
 * script itself runs under plain Node: it spawns pnpm, so no dependency is installed first.
 */

import { spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { describeVersions, readVersions } from './verify-version-sync.ts'

/** One command of the check. */
export interface PreMergeStep {
  /** Short name for the log. */
  readonly name: string
  readonly command: string
  readonly args: readonly string[]
}

/** What the check runs: the install every other step depends on, then the builds in order. */
export interface PreMergePlan {
  readonly install: PreMergeStep
  readonly steps: readonly PreMergeStep[]
}

/**
 * The commands that build the merged tree, in order.
 * @returns Steps after the install.
 */
export function buildSteps(): PreMergeStep[] {
  return [
    { name: 'host contracts', command: 'pnpm', args: ['exec', 'tsx', 'scripts/compile-referenced-projects.ts', 'host-contracts'] },
    { name: 'client', command: 'pnpm', args: ['exec', 'tsx', 'scripts/compile-referenced-projects.ts', 'client'] },
  ]
}

/** The install every other step depends on. */
export const INSTALL_STEP: PreMergeStep = { name: 'install', command: 'pnpm', args: ['install', '--frozen-lockfile'] }

/** The plan the repository uses. */
export const DEFAULT_PLAN: PreMergePlan = { install: INSTALL_STEP, steps: buildSteps() }

/** Options of the check. */
export interface PreMergeOptions {
  /** Sink for the check's own lines. */
  readonly report?: (line: string) => void
  /** Plan to run; the repository's own plan when absent. */
  readonly plan?: PreMergePlan
}

/** What the check decided. */
export interface PreMergeOutcome {
  readonly ok: boolean
  /** Why the tree failed, when it did. */
  readonly reason?: string
}

/**
 * Run one step to completion with the caller's terminal, so its output lands in the job log.
 * @param step - Step to run.
 * @param root - Working directory.
 * @returns Its exit code, or 1 when a signal ended it.
 */
function run(step: PreMergeStep, root: string): number {
  const result = spawnSync(step.command, [...step.args], { cwd: root, stdio: 'inherit' })
  return result.status ?? 1
}

/**
 * Check the merged tree, reporting why it failed.
 * @param root - Repository root.
 * @param options - Sink for the check's own lines, and the plan to run.
 * @returns Whether the tree passed, with the reason when it did not.
 */
export async function preMergeCheck(root: string, options: PreMergeOptions = {}): Promise<PreMergeOutcome> {
  const report = options.report ?? ((line: string): void => {
    process.stdout.write(`${line}\n`)
  })
  const plan = options.plan ?? DEFAULT_PLAN
  // The manifests are read while the install runs: the version check needs no installed dependency.
  const install = spawn(plan.install.command, [...plan.install.args], { cwd: root, stdio: 'inherit' })
  const versions = readVersions(root)
  const lines = describeVersions(versions)
  const installCode = await new Promise<number>((settle) => {
    install.once('close', (code) => {
      settle(code ?? 1)
    })
    install.once('error', () => {
      settle(1)
    })
  })
  const versionsOk = versions.rootVersion !== undefined && lines.length === 1
  for (const line of lines) report(`verify-version-sync: ${line}`)
  if (installCode !== 0) return { ok: false, reason: 'the install failed' }
  for (const step of plan.steps) {
    report(`pre-merge-check: building ${step.name}`)
    if (run(step, root) !== 0) return { ok: false, reason: `the ${step.name} build failed` }
  }
  if (!versionsOk) return { ok: false, reason: 'the released manifests do not carry the root version' }
  return { ok: true }
}

const invokedPath = process.argv[1]
const isMain = invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href
if (isMain) {
  const outcome = await preMergeCheck(resolve(import.meta.dirname, '..'))
  if (outcome.ok) {
    process.stdout.write('pre-merge-check: passed\n')
  } else {
    process.stderr.write(`pre-merge-check: failed: ${outcome.reason ?? 'unknown reason'}\n`)
    process.exitCode = 1
  }
}

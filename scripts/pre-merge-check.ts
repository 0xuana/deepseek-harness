/**
 * Validate the tree a pull request produces once merged with its base branch: the install,
 * the version synchronization of the released manifests, and the Host and Client builds.
 *
 * The `Policy / Pre-Merge Check` job runs this file with `node`, and knows nothing else about the
 * merged tree, so what that tree needs changes here without touching the check. The file runs under
 * plain Node and spawns pnpm itself, so no dependency is installed before it starts.
 */

import { spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { describeVersions, readVersions, versionsSynchronized, type VersionReport } from './verify-version-sync.ts'

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

/** How the install ended. */
interface InstallOutcome {
  readonly code: number
  /** Why the install could not even start, when it could not. */
  readonly error?: string
}

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
 * @param report - Sink for the check's own lines.
 * @returns Why the step failed, or `undefined` when it succeeded.
 */
function run(step: PreMergeStep, root: string, report: (line: string) => void): string | undefined {
  const result = spawnSync(step.command, [...step.args], { cwd: root, stdio: 'inherit' })
  if (result.error !== undefined) {
    const reason = `cannot run ${step.command}: ${result.error.message}`
    report(`pre-merge-check: ${reason}`)
    return reason
  }
  return result.status === 0 ? undefined : `the ${step.name} build failed`
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
  const install = spawn(plan.install.command, [...plan.install.args], { cwd: root, stdio: 'inherit' })
  // Listen before anything else can throw: a pnpm that cannot start must not leave the check hanging.
  const installed = await new Promise<InstallOutcome>((settle) => {
    install.once('close', (code) => {
      settle({ code: code ?? 1 })
    })
    install.once('error', (error: Error) => {
      settle({ code: 1, error: error.message })
    })
  }).catch((error: unknown) => ({ code: 1, error: error instanceof Error ? error.message : String(error) }))
  let versions: VersionReport | undefined
  let versionsError: string | undefined
  try {
    versions = readVersions(root)
  } catch (error) {
    versionsError = error instanceof Error ? error.message : String(error)
  }
  // The install runs while the manifests are read, so the version lines appear beside its output.
  if (versions !== undefined) for (const line of describeVersions(versions)) report(`verify-version-sync: ${line}`)
  if (installed.error !== undefined) return { ok: false, reason: `cannot run ${plan.install.command}: ${installed.error}` }
  if (installed.code !== 0) return { ok: false, reason: 'the install failed' }
  for (const step of plan.steps) {
    report(`pre-merge-check: building ${step.name}`)
    const failure = run(step, root, report)
    if (failure !== undefined) return { ok: false, reason: failure }
  }
  if (versions === undefined) return { ok: false, reason: `cannot read the released manifests: ${versionsError ?? 'unknown error'}` }
  if (!versionsSynchronized(versions)) return { ok: false, reason: 'the released manifests do not carry the root version' }
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

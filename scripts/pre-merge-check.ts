/**
 * Validate the tree a pull request produces once merged with its base branch: the install, the
 * version synchronization of the released manifests, and the Host and Client builds.
 *
 * The `Policy / Pre-Merge Check` job runs this file with `node`, and knows nothing else about the
 * merged tree, so what that tree needs changes here without touching the check. The file runs under
 * plain Node and spawns pnpm itself, so no dependency is installed before it starts.
 */

import { spawn } from 'node:child_process'
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

/** No step can run before the others without the install, so it opens the list. */
export function preMergeSteps(): PreMergeStep[] {
  return [
    { name: 'install', command: 'pnpm', args: ['install', '--frozen-lockfile'] },
    { name: 'host contracts', command: 'pnpm', args: ['exec', 'tsx', 'scripts/compile-referenced-projects.ts', 'host-contracts'] },
    { name: 'client', command: 'pnpm', args: ['exec', 'tsx', 'scripts/compile-referenced-projects.ts', 'client'] },
  ]
}

/** Options of the check. */
export interface PreMergeOptions {
  /** Sink for the check's own lines. */
  readonly report?: (line: string) => void
  /** Steps to run; the repository's own steps when absent. */
  readonly steps?: readonly PreMergeStep[]
}

/** How the job that runs this file reacts to a failure. */
export type CheckMode = 'off' | 'report' | 'block'

/** What a failure prints and the exit code it leaves. */
export interface FailureDecision {
  readonly line: string
  readonly exitCode: number
}

/**
 * Read the job's mode. The check owns its own mode handling, so the workflow only calls it.
 * @param value - The `CHECK_MODE` value, when the environment provides one.
 * @returns The mode; a missing or unknown value reports instead of blocking.
 */
export function checkMode(value: string | undefined = process.env.CHECK_MODE): CheckMode {
  return value === 'off' || value === 'block' ? value : 'report'
}

/**
 * Decide how a failed tree is reported, so `report` annotates and passes while `block` fails the job.
 * @param mode - Mode of the job.
 * @param reason - Why the tree failed.
 * @returns The annotation and exit code for that mode.
 */
export function failureDecision(mode: CheckMode, reason: string): FailureDecision {
  const summary = `the merged tree fails its pre-merge check: ${reason}`
  if (mode === 'block') return { line: `::error title=Pre-Merge Check::${summary}`, exitCode: 1 }
  if (mode === 'report') return { line: `::warning title=Pre-Merge Check::${summary}`, exitCode: 0 }
  return { line: `pre-merge-check: ${summary}`, exitCode: 0 }
}

/** What the check decided. */
export interface PreMergeOutcome {
  readonly ok: boolean
  /** Why the tree failed, when it did. */
  readonly reason?: string
}

/**
 * Run one step with the caller's terminal, so its output reaches the job log as it arrives.
 * @param step - Step to run.
 * @param root - Working directory.
 * @returns Why the step failed, or `undefined` when it succeeded.
 */
function run(step: PreMergeStep, root: string): Promise<string | undefined> {
  return new Promise((settle) => {
    const child = spawn(step.command, [...step.args], { cwd: root, stdio: 'inherit' })
    child.once('error', (error: Error) => {
      settle(`cannot run ${step.command}: ${error.message}`)
    })
    child.once('close', (code) => {
      settle(code === 0 ? undefined : `the ${step.name} step failed`)
    })
  })
}

/**
 * Check the merged tree, reporting why it failed.
 * @param root - Repository root.
 * @param options - Sink for the check's own lines, and the steps to run.
 * @returns Whether the tree passed, with the reason when it did not.
 */
export async function preMergeCheck(root: string, options: PreMergeOptions = {}): Promise<PreMergeOutcome> {
  const report = options.report ?? ((line: string): void => {
    process.stdout.write(`${line}\n`)
  })
  // The manifests are read before the steps, so the version check needs no installed dependency.
  let versions: VersionReport | undefined
  let versionsError = 'unknown error'
  try {
    versions = readVersions(root)
    for (const line of describeVersions(versions)) report(`verify-version-sync: ${line}`)
  } catch (error) {
    versionsError = error instanceof Error ? error.message : String(error)
    report(`verify-version-sync: cannot read the released manifests: ${versionsError}`)
  }
  for (const step of options.steps ?? preMergeSteps()) {
    report(`pre-merge-check: running ${step.name}`)
    const failure = await run(step, root)
    if (failure !== undefined) return { ok: false, reason: failure }
  }
  if (versions === undefined) return { ok: false, reason: `cannot read the released manifests: ${versionsError}` }
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
    const decision = failureDecision(checkMode(), outcome.reason ?? 'unknown reason')
    ;(decision.exitCode === 0 ? process.stdout : process.stderr).write(`${decision.line}\n`)
    process.exitCode = decision.exitCode
  }
}

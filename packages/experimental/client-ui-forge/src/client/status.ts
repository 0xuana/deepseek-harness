/** Status derivations shared by the header entry and the change request cards. */

import type { ChangeRequestCheck, ChangeRequestSnapshot, ChecksRollup } from '@deepseek-ai/dsh-experimental-forge/types'
import type { ForgePanelChangeRequest } from '../types.ts'

/** Glyph tone of a change request: its lifecycle state, or `unknown` before the first snapshot. */
export type ChangeRequestTone = 'open' | 'draft' | 'merged' | 'closed' | 'unknown'

/** Combined check outcome shown on a collapsed card. */
export type CiSummary =
  | { readonly kind: 'none' }
  | { readonly kind: 'running' }
  | { readonly kind: 'passed' }
  /** `count` is the number of failed checks the host listed, which can be zero when the list is truncated. */
  | { readonly kind: 'failed'; readonly count: number }

/** Checks grouped by outcome; `other` holds neutral, skipped, and cancelled checks. */
export interface CheckCounts {
  readonly failed: number
  readonly running: number
  readonly passed: number
  readonly other: number
}

const SETTLED: Record<Exclude<ChecksRollup, 'failure'>, Exclude<CiSummary['kind'], 'failed'>> = {
  none: 'none',
  pending: 'running',
  success: 'passed',
}

/** The most urgent fact of an open change request that the collapsed card names. */
export type ChangeRequestFlag = 'changesRequested' | 'conflicting' | 'draft'

/**
 * Pick the glyph tone of a change request.
 * @param snapshot - latest snapshot, or null before the first one.
 * @returns the tone.
 */
export function toneOf(snapshot: ChangeRequestSnapshot | null): ChangeRequestTone {
  if (snapshot === null) return 'unknown'
  if (snapshot.state === 'open') return snapshot.draft ? 'draft' : 'open'
  return snapshot.state
}

/**
 * Count the listed checks by outcome.
 * @param checks - checks of the head commit.
 * @returns the counts.
 */
export function checkCounts(checks: readonly ChangeRequestCheck[]): CheckCounts {
  let failed = 0
  let running = 0
  let passed = 0
  for (const check of checks) {
    if (check.state === 'failure') failed++
    else if (check.state === 'pending') running++
    else if (check.state === 'success') passed++
  }
  return { failed, running, passed, other: checks.length - failed - running - passed }
}

/**
 * Summarize the checks of a change request from the host's combined outcome.
 * @param snapshot - change request status.
 * @returns the combined outcome with the failed count.
 */
export function ciSummary(snapshot: ChangeRequestSnapshot): CiSummary {
  if (snapshot.checksRollup === 'failure') return { kind: 'failed', count: checkCounts(snapshot.checks).failed }
  return { kind: SETTLED[snapshot.checksRollup] }
}

/**
 * Pick the flag a collapsed card names: requested changes before merge
 * conflicts before draft state; only open change requests carry one.
 * @param snapshot - change request status.
 * @returns the flag, or undefined when none applies.
 */
export function flagOf(snapshot: ChangeRequestSnapshot): ChangeRequestFlag | undefined {
  if (snapshot.state !== 'open') return undefined
  if (snapshot.reviewDecision === 'changes-requested') return 'changesRequested'
  if (snapshot.mergeability === 'conflicting') return 'conflicting'
  return snapshot.draft ? 'draft' : undefined
}

/**
 * Whether an open change request needs the user: failed checks, requested changes, or merge conflicts.
 * @param entry - bound change request.
 * @returns whether the header marks it.
 */
export function needsAttention(entry: ForgePanelChangeRequest): boolean {
  const snapshot = entry.snapshot
  if (snapshot === null || snapshot.state !== 'open') return false
  return snapshot.checksRollup === 'failure' || snapshot.reviewDecision === 'changes-requested' || snapshot.mergeability === 'conflicting'
}

/**
 * Read the change request number: the provider's reference, else the number at the end of the URL path.
 * @param entry - bound change request.
 * @returns the number, or null when neither names one.
 */
export function numberOf(entry: Pick<ForgePanelChangeRequest, 'ref' | 'url'>): number | null {
  if (entry.ref !== null) return entry.ref.number
  const [, digits = ''] = /\/(\d+)\/?(?:[?#].*)?$/s.exec(entry.url) ?? []
  const number = Number(digits)
  return digits.length > 0 && Number.isSafeInteger(number) ? number : null
}

/**
 * Measure how long a completed check ran.
 * @param check - one check.
 * @returns elapsed milliseconds, or undefined when either time is unknown or they are out of order.
 */
export function checkDuration(check: ChangeRequestCheck): number | undefined {
  if (check.startedAt === null || check.completedAt === null) return undefined
  const elapsed = Date.parse(check.completedAt) - Date.parse(check.startedAt)
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : undefined
}

/**
 * Time vocabulary shared by the boundaries that accept a caller's zone or a
 * wall-clock selector.
 *
 * Validation, canonicalization, and strict parsing only: this library formats
 * no model-facing text and owns no failure vocabulary — every entry answers a
 * discriminated result, and each boundary maps a reason onto its own domain
 * code and diagnostic.
 * @module @deepseek-ai/dsh-util-time
 */

import { canonicalizeTimeZone } from './instant.ts'

export * from './instant.ts'

/**
 * Validate and canonicalize one caller-supplied IANA zone at a wire boundary.
 *
 * The canonical name is what a later reader needs: a zone identity is stored on
 * durable records and resolved again by another process, so an alias accepted
 * here would not compare equal to the zone a reader derives.
 * @param value - the caller's reported zone name.
 * @returns the canonical zone, or `undefined` when the name is unusable.
 */
export function canonicalClientTimeZone(value: string): string | undefined {
  const resolved = canonicalizeTimeZone(value)
  return resolved.kind === 'accepted' ? resolved.timeZone : undefined
}

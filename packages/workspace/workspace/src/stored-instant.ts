/**
 * Durable workspace timestamps in the instant profile every harness boundary accepts.
 * @module @deepseek-ai/dsh-workspace/stored-instant
 */
import { formatFourDigitYearInstant } from '@deepseek-ai/dsh-util-time'

/**
 * Format one epoch as the canonical instant a workspace record stores.
 *
 * The shared four-digit-year profile is the one every other durable boundary in
 * the harness reads, so a timestamp written here stays readable by them. The
 * platform's `toISOString` would instead write an extended year for an epoch
 * past 9999 and truncate a fractional epoch, so this rejects both rather than
 * storing a value the rest of the system refuses.
 * @param epoch - Epoch milliseconds of a workspace record timestamp.
 * @returns The canonical four-digit-year instant.
 * @throws RangeError when the epoch is not an integer inside the four-digit-year range.
 */
export function storedInstant(epoch: number): string {
  const formatted = formatFourDigitYearInstant(epoch)
  if (formatted === undefined) {
    throw new RangeError(`workspace timestamp is not a four-digit-year integral epoch: ${String(epoch)}`)
  }
  return formatted
}

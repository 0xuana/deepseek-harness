/**
 * The host's current UTC offset, for the metadata a client reports about itself.
 * @module @deepseek-ai/dsh-util-time
 */

const SECONDS_PER_MINUTE = 60

/**
 * The host zone's offset from UTC at one instant, in seconds east of UTC.
 *
 * `Date.getTimezoneOffset` reports minutes west of UTC, so the sign and the unit
 * both change here; a caller that reports an offset to another process needs the
 * east-positive second count, and two callers had each written that conversion.
 * @param at - Epoch milliseconds whose offset to read, because an offset depends
 * on the instant for a zone that observes daylight saving.
 * @returns Whole seconds east of UTC, from -43,200 (UTC-12) through 50,400 (UTC+14).
 */
export function localUtcOffsetSeconds(at: number): number {
  return -new Date(at).getTimezoneOffset() * SECONDS_PER_MINUTE
}

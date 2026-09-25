/**
 * One span of time, held as a count of milliseconds.
 *
 * A class rather than a branded number: arithmetic on two branded numbers
 * answers an unbranded `number`, so a brand cannot stop seconds and
 * milliseconds from being added, while an instance can. No coercion hook is
 * overridden, so no reader receives a bare count whose unit it has to remember;
 * a caller states the unit by reading `milliseconds` or by converting through
 * one of the `to*` entries.
 * @module @deepseek-ai/dsh-util-time
 */

const MS_PER_SECOND = 1_000
const MS_PER_MINUTE = 60 * MS_PER_SECOND
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR
const SECONDS_PER_DAY = 86_400
const SECONDS_PER_HOUR = 3_600
const SECONDS_PER_MINUTE = 60

/** Whole parts of one non-negative span, in the units a reading is written in. */
export interface DurationParts {
  /** Whole days. */
  readonly days: number
  /** Whole hours left after the days, from 0 through 23. */
  readonly hours: number
  /** Whole minutes left after the hours, from 0 through 59. */
  readonly minutes: number
  /** Whole seconds left after the minutes, from 0 through 59. */
  readonly seconds: number
  /** Fractional milliseconds left after the seconds, from 0 up to (but excluding) 1000. */
  readonly milliseconds: number
}

/**
 * Largest millisecond count a span holds.
 *
 * Every integer up to this bound is exactly representable, which is what makes
 * the whole-part split exact; beyond it the parts a reader gets back would not
 * add up to the span.
 */
const MAX_SPAN_MS = Number.MAX_SAFE_INTEGER

/**
 * One span of time in milliseconds.
 *
 * Instances are frozen, so a span cannot drift after it is built. A span is
 * bounded by the exactly representable millisecond range, which is wider than
 * any interval this harness schedules, and it carries no calendar meaning: a
 * month is not a fixed count of milliseconds, so no entry here converts to or
 * from calendar units.
 */
export class Duration {
  /** The additive identity. */
  static readonly zero: Duration = new Duration(0)

  private readonly span: number

  private constructor(milliseconds: number) {
    this.span = milliseconds
    Object.freeze(this)
  }

  /**
   * Build one span from a millisecond count.
   * @param milliseconds - Count within the exactly representable range (about 285,000 years); fractions are kept.
   * @returns The span.
   * @throws TypeError when the count is not finite, or exceeds the exactly representable millisecond range.
   */
  static fromMilliseconds(milliseconds: number): Duration {
    if (!Number.isFinite(milliseconds)) {
      throw new TypeError(`duration milliseconds must be finite, got ${String(milliseconds)}`)
    }
    if (Math.abs(milliseconds) > MAX_SPAN_MS) {
      throw new TypeError(
        `duration milliseconds must not exceed ${MAX_SPAN_MS} so its parts stay exact, got ${String(milliseconds)}`,
      )
    }
    return new Duration(milliseconds)
  }

  /**
   * Build one span from a second count, for a boundary whose unit is seconds.
   * @param seconds - Finite second count; a fractional count is kept as given.
   * @returns The span.
   * @throws TypeError when the count is not finite, or its millisecond equivalent is not finite or leaves the exactly representable range.
   */
  static fromSeconds(seconds: number): Duration {
    if (!Number.isFinite(seconds)) {
      throw new TypeError(`duration seconds must be finite, got ${String(seconds)}`)
    }
    return Duration.fromMilliseconds(seconds * MS_PER_SECOND)
  }

  /** The span as a millisecond count; the unit is part of the name. */
  get milliseconds(): number {
    return this.span
  }

  /**
   * Add one span to this span.
   * @param other - Span to add; both operands already share the millisecond unit.
   * @returns The sum.
   * @throws TypeError when the sum leaves the exactly representable millisecond range.
   */
  plus(other: Duration): Duration {
    return Duration.fromMilliseconds(this.span + other.span)
  }

  /**
   * Subtract one span from this span.
   * @param other - Span to subtract.
   * @returns The difference, which is negative when `other` is longer.
   * @throws TypeError when the difference leaves the exactly representable millisecond range.
   */
  minus(other: Duration): Duration {
    return Duration.fromMilliseconds(this.span - other.span)
  }

  /**
   * Order two spans.
   * @param other - Span to compare with.
   * @returns `-1` when this span is shorter, `0` when equal, `1` when longer.
   */
  compare(other: Duration): -1 | 0 | 1 {
    if (this.span < other.span) return -1
    return this.span > other.span ? 1 : 0
  }

  /**
   * Whether the span is a negative interval, which every sign-sensitive reader
   * must decide how to handle.
   * @returns Whether the millisecond count is below zero.
   */
  isNegative(): boolean {
    return this.span < 0
  }

  /**
   * The span in seconds.
   * @returns The span as a fractional seconds count: one division, so the answer is the double nearest the exact ratio.
   */
  toSeconds(): number {
    return this.span / MS_PER_SECOND
  }

  /**
   * The span in minutes.
   * @returns The span as a fractional minutes count: one division, so the answer is the double nearest the exact ratio.
   */
  toMinutes(): number {
    return this.span / MS_PER_MINUTE
  }

  /**
   * The span in hours.
   * @returns The span as a fractional hours count: one division, so the answer is the double nearest the exact ratio.
   */
  toHours(): number {
    return this.span / MS_PER_HOUR
  }

  /**
   * The span in days.
   *
   * A day here is exactly 24 hours. A wall-clock reading that crosses a
   * daylight-saving transition is not a whole number of days, so a caller that
   * needs local calendar days derives them from the zone instead.
   * @returns The span as a fractional days count: one division, so the answer is the double nearest the exact ratio.
   */
  toDays(): number {
    return this.span / MS_PER_DAY
  }

  /**
   * Split the span into whole days, hours, minutes, seconds, and the remaining
   * fraction of a second. Days, hours, minutes, and seconds are floored; the
   * millisecond part keeps the fraction below one second. Every span this class
   * accepts is inside the exactly representable millisecond range, so the parts
   * add back up to the span.
   * @returns The frozen whole parts.
   * @throws RangeError when the span is negative, because a negative interval
   * has no single whole-part decomposition: the caller owns that policy.
   */
  decompose(): DurationParts {
    if (this.span < 0) {
      throw new RangeError('a negative duration has no whole-part decomposition')
    }
    let seconds = Math.floor(this.span / MS_PER_SECOND)
    const days = Math.floor(seconds / SECONDS_PER_DAY)
    seconds %= SECONDS_PER_DAY
    const hours = Math.floor(seconds / SECONDS_PER_HOUR)
    seconds %= SECONDS_PER_HOUR
    const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
    seconds %= SECONDS_PER_MINUTE
    return Object.freeze({
      days,
      hours,
      minutes,
      seconds,
      milliseconds: this.span - Math.floor(this.span / MS_PER_SECOND) * MS_PER_SECOND,
    })
  }
}

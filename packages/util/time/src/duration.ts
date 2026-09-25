/**
 * One span of time, held as a count of milliseconds.
 *
 * A class rather than a branded number: arithmetic on two branded numbers
 * answers an unbranded `number`, so a brand cannot stop seconds and
 * milliseconds from being added, while an instance can. There is no `valueOf`
 * and no `toString`, so no reader ever receives a bare count whose unit it has
 * to remember; a caller states the unit by reading `milliseconds` or by
 * converting through one of the `to*` entries.
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
 * One span of time in milliseconds.
 *
 * Instances are frozen, so a span cannot drift after it is built, and they carry
 * no calendar meaning: a month is not a fixed count of milliseconds, so no entry
 * here converts to or from calendar units.
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
   * @param milliseconds - Finite millisecond count; a fractional count is kept as given.
   * @returns The span.
   * @throws TypeError when the count is not a finite number.
   */
  static fromMilliseconds(milliseconds: number): Duration {
    if (!Number.isFinite(milliseconds)) {
      throw new TypeError(`duration milliseconds must be finite, got ${String(milliseconds)}`)
    }
    return new Duration(milliseconds)
  }

  /**
   * Build one span from a second count, for a boundary whose unit is seconds.
   * @param seconds - Finite second count; a fractional count is kept as given.
   * @returns The span.
   * @throws TypeError when the count is not finite, or its millisecond equivalent is not.
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
   */
  plus(other: Duration): Duration {
    return new Duration(this.span + other.span)
  }

  /**
   * Subtract one span from this span.
   * @param other - Span to subtract.
   * @returns The difference, which is negative when `other` is longer.
   */
  minus(other: Duration): Duration {
    return new Duration(this.span - other.span)
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
   * @returns The span as a fractional second count, lossless in both directions.
   */
  toSeconds(): number {
    return this.span / MS_PER_SECOND
  }

  /**
   * The span in minutes.
   * @returns The span as a fractional minute count, lossless in both directions.
   */
  toMinutes(): number {
    return this.span / MS_PER_MINUTE
  }

  /**
   * The span in hours.
   * @returns The span as a fractional hour count, lossless in both directions.
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
   * @returns The span as a fractional day count, lossless in both directions.
   */
  toDays(): number {
    return this.span / MS_PER_DAY
  }

  /**
   * Split the span into whole days, hours, minutes, seconds, and the remaining
   * fraction of a second. Each part is floored, so the parts never exceed the
   * span.
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

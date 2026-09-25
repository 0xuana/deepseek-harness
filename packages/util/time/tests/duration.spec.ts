import { describe, expect, it } from 'vitest'
import { Duration } from '@deepseek-ai/dsh-util-time'

describe('Duration construction', () => {
  it('holds the millisecond count it was built from, fraction included', () => {
    expect(Duration.fromMilliseconds(1_500).milliseconds).toBe(1_500)
    expect(Duration.fromMilliseconds(0.5).milliseconds).toBe(0.5)
    expect(Duration.zero.milliseconds).toBe(0)
  })

  it('converts a second count at the boundary that carries seconds', () => {
    expect(Duration.fromSeconds(300).milliseconds).toBe(300_000)
    expect(Duration.fromSeconds(0.25).milliseconds).toBe(250)
    expect(Duration.fromSeconds(-60).milliseconds).toBe(-60_000)
  })

  it('refuses a count that is not a finite number', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => Duration.fromMilliseconds(value)).toThrow(TypeError)
      expect(() => Duration.fromSeconds(value)).toThrow(TypeError)
    }
  })

  it('refuses a finite second count whose millisecond equivalent leaves the finite range', () => {
    expect(() => Duration.fromSeconds(1e306)).toThrow(TypeError)
  })

  it('refuses a count above the exactly representable millisecond range', () => {
    expect(() => Duration.fromMilliseconds(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError)
    expect(Duration.fromMilliseconds(Number.MAX_SAFE_INTEGER).milliseconds).toBe(Number.MAX_SAFE_INTEGER)
    // The bound is what keeps the whole-part identity exact, so it is asserted, not assumed.
    const parts = Duration.fromMilliseconds(Number.MAX_SAFE_INTEGER).decompose()
    const summed = parts.days * 86_400_000 + parts.hours * 3_600_000
      + parts.minutes * 60_000 + parts.seconds * 1_000 + parts.milliseconds
    expect(summed).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('is frozen, and overrides no implicit conversion', () => {
    const span = Duration.fromMilliseconds(1)
    expect(Object.isFrozen(span)).toBe(true)
    expect(Reflect.set(span, 'span', 2)).toBe(false)
    expect(span.milliseconds).toBe(1)
    // No coercion hook is overridden, so no caller obtains the count by coercion.
    expect(Object.hasOwn(Duration.prototype, 'valueOf')).toBe(false)
    expect(Object.hasOwn(Duration.prototype, 'toString')).toBe(false)
    expect(Object.hasOwn(Duration.prototype, Symbol.toPrimitive)).toBe(false)
  })
})

describe('Duration arithmetic', () => {
  it('adds and subtracts in the one shared unit', () => {
    expect(Duration.fromSeconds(2).plus(Duration.fromMilliseconds(500)).milliseconds).toBe(2_500)
    expect(Duration.fromSeconds(2).minus(Duration.fromMilliseconds(500)).milliseconds).toBe(1_500)
    expect(Duration.fromMilliseconds(1).minus(Duration.fromSeconds(1)).isNegative()).toBe(true)
    expect(Duration.zero.plus(Duration.zero).milliseconds).toBe(0)
  })

  it('orders spans without surrendering the unit', () => {
    const minute = Duration.fromSeconds(60)
    const hour = Duration.fromSeconds(3_600)
    expect(minute.compare(hour)).toBe(-1)
    expect(hour.compare(minute)).toBe(1)
    expect(minute.compare(Duration.fromMilliseconds(60_000))).toBe(0)
    expect(minute.isNegative()).toBe(false)
    expect(Duration.fromMilliseconds(-1).isNegative()).toBe(true)
  })
})

describe('Duration conversion', () => {
  it('converts to larger units fractionally, by one division each', () => {
    const span = Duration.fromMilliseconds(90_061_500)
    expect(span.toSeconds()).toBe(90_061.5)
    expect(span.toMinutes()).toBe(1_501.025)
    expect(span.toHours()).toBe(25.017_083_333_333_332)
    expect(span.toDays()).toBe(1.042_378_472_222_222_2)
    expect(Duration.fromSeconds(span.toSeconds()).milliseconds).toBe(span.milliseconds)
    // A conversion is a single division, so a round trip returns the nearest
    // double rather than the original count: 1001 ms is 1.001 s, and 1.001 s is
    // not exactly 1001 ms.
    expect(Duration.fromMilliseconds(1_001).toSeconds()).toBe(1.001)
    expect(Duration.fromSeconds(1.001).milliseconds).toBe(1_000.999_999_999_999_9)
  })

  it('covers a day as exactly twenty-four hours', () => {
    expect(Duration.fromMilliseconds(86_400_000).toDays()).toBe(1)
    expect(Duration.fromMilliseconds(-86_400_000).toDays()).toBe(-1)
  })
})

describe('Duration decompose', () => {
  it('splits a span into floored whole parts and the fractional remainder', () => {
    expect(Duration.fromMilliseconds(0).decompose())
      .toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0, milliseconds: 0 })
    expect(Duration.fromMilliseconds(999).decompose())
      .toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0, milliseconds: 999 })
    expect(Duration.fromMilliseconds(1_000).decompose())
      .toEqual({ days: 0, hours: 0, minutes: 0, seconds: 1, milliseconds: 0 })
    expect(Duration.fromMilliseconds(90_061_500).decompose())
      .toEqual({ days: 1, hours: 1, minutes: 1, seconds: 1, milliseconds: 500 })
    expect(Duration.fromMilliseconds(86_400_000).decompose())
      .toEqual({ days: 1, hours: 0, minutes: 0, seconds: 0, milliseconds: 0 })
    expect(Duration.fromMilliseconds(90_061_500.75).decompose())
      .toEqual({ days: 1, hours: 1, minutes: 1, seconds: 1, milliseconds: 500.75 })
  })

  it('answers frozen parts whose sum never exceeds the span', () => {
    const parts = Duration.fromMilliseconds(3_661_999).decompose()
    expect(Object.isFrozen(parts)).toBe(true)
    const summed = parts.days * 86_400_000 + parts.hours * 3_600_000
      + parts.minutes * 60_000 + parts.seconds * 1_000 + parts.milliseconds
    expect(summed).toBe(3_661_999)
  })

  it('keeps the whole-part identity across the accepted range', () => {
    const sum = (parts: { days: number; hours: number; minutes: number; seconds: number; milliseconds: number }): number =>
      parts.days * 86_400_000 + parts.hours * 3_600_000
      + parts.minutes * 60_000 + parts.seconds * 1_000 + parts.milliseconds
    for (let span = 0; span <= 120_000; span += 1) {
      expect(sum(Duration.fromMilliseconds(span).decompose())).toBe(span)
    }
    for (let i = 0; i < 2_000; i += 1) {
      const span = Math.random() * Number.MAX_SAFE_INTEGER
      const parts = Duration.fromMilliseconds(span).decompose()
      expect(sum(parts)).toBe(span)
      expect(parts.milliseconds).toBeGreaterThanOrEqual(0)
      expect(parts.milliseconds).toBeLessThan(1_000)
    }
  })

  it('refuses a negative span instead of inventing a sign policy', () => {
    expect(() => Duration.fromMilliseconds(-1).decompose()).toThrow(RangeError)
  })
})

import { describe, expect, it } from 'vitest'
import { storedInstant } from '../src/stored-instant.ts'

describe('storedInstant', () => {
  it('formats an integral epoch in the canonical profile', () => {
    expect(storedInstant(0)).toBe('1970-01-01T00:00:00.000Z')
    expect(storedInstant(Date.UTC(2026, 6, 24, 12, 34, 56, 789)))
      .toBe('2026-07-24T12:34:56.789Z')
    expect(storedInstant(Date.UTC(9999, 11, 31, 23, 59, 59, 999)))
      .toBe('9999-12-31T23:59:59.999Z')
  })

  it('refuses a fractional epoch instead of truncating it', () => {
    expect(() => storedInstant(1_500.5)).toThrow(RangeError)
  })

  it('refuses an epoch outside the four-digit-year range instead of writing an extended year', () => {
    expect(() => storedInstant(Date.UTC(10_000, 0, 1))).toThrow(RangeError)
    expect(() => storedInstant(-62_167_219_200_001)).toThrow(RangeError)
  })

  it('refuses an epoch that is not a number at all', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => storedInstant(value)).toThrow(RangeError)
    }
  })
})

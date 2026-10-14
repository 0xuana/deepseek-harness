import { afterEach, describe, expect, it, vi } from 'vitest'
import { localUtcOffsetSeconds } from '@deepseek-ai/dsh-util-time'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('localUtcOffsetSeconds', () => {
  it('answers seconds east of UTC for a zone west of it', () => {
    // The platform reports minutes west of UTC, so a western zone is a positive
    // minute count that must come back negative.
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(480)
    expect(localUtcOffsetSeconds(0)).toBe(-28_800)
  })

  it('answers seconds east of UTC for a zone east of it', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-480)
    expect(localUtcOffsetSeconds(0)).toBe(28_800)
  })

  it('keeps the half-hour zones exact', () => {
    // Asia/Kolkata is UTC+05:30; the 30 minutes must survive as 1,800 seconds.
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-330)
    expect(localUtcOffsetSeconds(1_700_000_000_000)).toBe(19_800)
  })

  it('reads the offset for the instant it is given, not for the current clock', () => {
    const seen: number[] = []
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockImplementation(function (this: Date): number {
      seen.push(this.getTime())
      return -60
    })
    localUtcOffsetSeconds(1_700_000_000_000)
    expect(seen).toEqual([1_700_000_000_000])
  })

  it('stays inside the offsets real zones use', () => {
    const offset = localUtcOffsetSeconds(Date.now())
    expect(Number.isInteger(offset)).toBe(true)
    expect(offset).toBeGreaterThanOrEqual(-43_200)
    expect(offset).toBeLessThanOrEqual(50_400)
  })
})

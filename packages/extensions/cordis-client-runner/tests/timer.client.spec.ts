/** @vitest-environment jsdom */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { ClientTimerService } from '../src/client/timer.ts'

describe('client Timer', () => {
  let ctx: Context

  beforeEach(async () => {
    vi.useFakeTimers()
    ctx = new Context()
    await ctx.plugin(ClientTimerService)
  })

  afterEach(async () => {
    try {
      await ctx.fiber.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('delivers concurrent reads in order and rejects the remaining reads on teardown', async () => {
    const ticks = ctx.interval(20)
    const outcomes: string[] = []
    for (let index = 0; index < 3; index++) {
      void ticks.next().then(() => outcomes.push(`tick ${index}`), () => outcomes.push(`disposed ${index}`))
    }
    await vi.advanceTimersByTimeAsync(20)
    expect(outcomes).toEqual(['tick 0'])
    await ctx.fiber.dispose()
    expect(outcomes).toEqual(['tick 0', 'disposed 1', 'disposed 2'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps wrapper calls void and inert after disposal', async () => {
    const work = vi.fn((value: string) => value.length)
    const throttle = ctx.throttle(work, 20)
    const debounce = ctx.debounce(work, 20)
    expectTypeOf(throttle).returns.toBeVoid()
    expectTypeOf(debounce).returns.toBeVoid()
    throttle('leading')
    throttle('trailing')
    debounce('delayed')
    throttle.dispose()
    debounce.dispose()
    await vi.advanceTimersByTimeAsync(40)
    throttle('disposed')
    debounce('disposed')
    expect(work).toHaveBeenCalledExactlyOnceWith('leading')
    expect(vi.getTimerCount()).toBe(0)
  })
})

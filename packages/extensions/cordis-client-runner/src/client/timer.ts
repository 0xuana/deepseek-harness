/** Browser implementation of the Cordis timer Service. */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'

/*
 * The browser Service preserves the vendored Host TimerService's erased callback tuples and arbitrary
 * async-iterator return and rejection values, so narrowing these positions would change the public API.
 */
/* oxlint-disable typescript/no-explicit-any -- Exact Host TimerService API compatibility; see above. */
/* oxlint-disable typescript/no-unsafe-argument -- The erased callback tuples pass through unchanged. */
/* oxlint-disable typescript/no-unsafe-assignment -- The erased callback tuples pass through unchanged. */
/* oxlint-disable typescript/no-unsafe-member-access -- The returned wrapper retains its dispose property. */
/* oxlint-disable typescript/no-unsafe-return -- The erased generic return values pass through unchanged. */
/* oxlint-disable typescript/prefer-promise-reject-errors -- Async iterators preserve arbitrary throw reasons. */

declare module '@deepseek-ai/cordis' {
  interface Context extends Pick<ClientTimerService, 'interval' | 'timeout' | 'throttle' | 'debounce' | 'setTimeout' | 'setInterval'> {
    /** Browser timer Service used by the mixed-in Context helpers. */
    timer: ClientTimerService
  }
}

type Scheduled<F extends (...args: any[]) => any> = ((...args: Parameters<F>) => void) & { dispose: () => void }

// These `any` positions mirror the Host TimerService's overload erasure: generic callback tuples and async-iterator
// return/rejection values must pass through without narrowing them to one caller's invocation.

/** Browser timer Service with the same public API as the Host Cordis TimerService. */
export class ClientTimerService extends Service {
  /** Register the Service and mix its lifecycle-safe helpers onto Context. */
  constructor(ctx: Context) {
    super(ctx, 'timer')
    ctx.mixin('timer', ['timeout', 'interval', 'throttle', 'debounce', 'setTimeout', 'setInterval'])
  }

  /**
   * Run a callback once through {@link timeout}.
   * @param callback - Work to run after the delay.
   * @param delay - Delay in milliseconds.
   * @returns Disposer that cancels the pending callback early.
   * @deprecated Use `ctx.timeout()` instead.
   */
  setTimeout(callback: () => void, delay: number): () => void {
    return this.timeout(callback, delay)
  }

  /**
   * Run a callback repeatedly through {@link interval}.
   * @param callback - Work to run on each tick.
   * @param delay - Interval in milliseconds.
   * @returns Disposer that stops the interval early.
   * @deprecated Use `ctx.interval()` instead.
   */
  setInterval(callback: () => void, delay: number): () => void {
    return this.interval(callback, delay)
  }

  /**
   * Run a callback once after a delay.
   * @param callback - work to run.
   * @param delay - delay in milliseconds.
   * @returns disposer that cancels the callback.
   */
  timeout(callback: () => void, delay: number): () => void
  /**
   * Wait for a delay.
   * @param delay - delay in milliseconds.
   * @returns promise resolved after the delay.
   */
  timeout(delay: number): Promise<void>
  timeout(...args: any[]): any {
    const callback = typeof args[0] === 'function' ? args.shift() as () => void : undefined
    const delay = args[0] as number
    if (callback !== undefined) {
      const dispose = this.ctx.effect(() => {
        const timer = globalThis.setTimeout(() => {
          void dispose()
          callback()
        }, delay)
        return () => { globalThis.clearTimeout(timer) }
      }, 'ctx.timeout()')
      return dispose
    }

    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const dispose = this.ctx.effect(() => {
      const timer = globalThis.setTimeout(resolve, delay)
      return () => {
        globalThis.clearTimeout(timer)
        reject(new Error('Context has been disposed'))
      }
    }, 'ctx.timeout()')
    return promise.finally(() => { void dispose() })
  }

  /**
   * Run a callback repeatedly.
   * @param callback - work to run on each tick.
   * @param delay - interval in milliseconds.
   * @returns disposer that stops the interval.
   */
  interval(callback: () => void, delay: number): () => void
  /**
   * Iterate over timer ticks.
   * @param delay - interval in milliseconds.
   * @returns Iterator completing concurrent reads in order, one per tick; disposal rejects all pending reads.
   */
  interval<R = any>(delay: number): AsyncIterableIterator<void, R, void>
  interval(...args: any[]): any {
    const callback = typeof args[0] === 'function' ? args.shift() as () => void : undefined
    const delay = args[0] as number
    if (callback !== undefined) {
      return this.ctx.effect(() => {
        const timer = globalThis.setInterval(callback, delay)
        return () => { globalThis.clearInterval(timer) }
      }, 'ctx.interval()')
    }

    let done: { kind: 'return'; value: any } | { kind: 'throw'; reason: any } | undefined
    const nextTasks: PromiseWithResolvers<IteratorResult<void>>[] = []
    const dispose = this.ctx.effect(() => {
      const timer = globalThis.setInterval(() => {
        nextTasks.shift()?.resolve({ done: false, value: undefined })
      }, delay)
      return () => {
        globalThis.clearInterval(timer)
        if (done !== undefined) return
        done = { kind: 'throw', reason: new Error('Context has been disposed') }
        for (const task of nextTasks.splice(0)) task.reject(done.reason)
      }
    }, 'ctx.interval()')
    return {
      next: () => {
        if (done === undefined) {
          const task = Promise.withResolvers<IteratorResult<void>>()
          nextTasks.push(task)
          return task.promise
        }
        if (done.kind === 'return') return Promise.resolve({ done: true, value: done.value })
        return Promise.reject(done.reason)
      },
      return: (value: any) => {
        if (done === undefined) done = { kind: 'return', value }
        for (const task of nextTasks.splice(0)) task.resolve({ done: true, value })
        void dispose()
        return Promise.resolve({ done: true, value })
      },
      throw: (reason: any) => {
        if (done === undefined) done = { kind: 'throw', reason }
        for (const task of nextTasks.splice(0)) task.reject(reason)
        void dispose()
        return Promise.resolve({ done: true, value: undefined })
      },
      [Symbol.asyncIterator]() {
        return this
      },
    } satisfies AsyncIterableIterator<void>
  }

  /** Build a delayed wrapper whose pending callback belongs to the calling Fiber. */
  private schedule(label: string, trigger: (args: any[]) => number | undefined): any {
    let timer: number | undefined
    let disposed = false
    const dispose = this.ctx.effect(() => () => {
      disposed = true
      globalThis.clearTimeout(timer)
      timer = undefined
    }, label)
    const wrapper: any = (...args: any[]): void => {
      if (disposed) return
      globalThis.clearTimeout(timer)
      timer = trigger(args)
    }
    wrapper.dispose = dispose
    return wrapper
  }

  /**
   * Return a throttled function whose timer is disposed with the calling Fiber.
   * @param callback - Function to throttle.
   * @param delay - Minimum interval between calls in milliseconds.
   * @param noTrailing - Whether to suppress a delayed trailing call.
   * @returns Void-returning wrapper; disposal cancels pending work and makes later calls inert.
   */
  throttle<F extends (...args: any[]) => any>(callback: F, delay: number, noTrailing?: boolean): Scheduled<F> {
    let lastCall = -Infinity
    const execute = (...args: Parameters<F>): void => {
      lastCall = Date.now()
      callback(...args)
    }
    return this.schedule('ctx.throttle()', (args) => {
      const remaining = delay - Date.now() + lastCall
      if (remaining <= 0) {
        execute(...args as Parameters<F>)
      } else if (!noTrailing) {
        return globalThis.setTimeout(execute, remaining, ...args)
      }
    })
  }

  /**
   * Return a debounced function whose timer is disposed with the calling Fiber.
   * @param callback - Function to debounce.
   * @param delay - Quiet period in milliseconds.
   * @returns Void-returning wrapper; disposal cancels pending work and makes later calls inert.
   */
  debounce<F extends (...args: any[]) => any>(callback: F, delay: number): Scheduled<F> {
    return this.schedule('ctx.debounce()', (args) => {
      return globalThis.setTimeout(callback, delay, ...args)
    })
  }
}

/**
 * Install the browser timer Service on one Client composition.
 * @param ctx - Client context that owns the Service and mixed-in helpers.
 * @returns Nothing after registering the Service.
 */
export function provideClientTimer(ctx: Context): void {
  new ClientTimerService(ctx)
}

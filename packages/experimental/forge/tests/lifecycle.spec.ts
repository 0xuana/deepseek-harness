import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ChangeRequestUpdate, ForgeProvider } from '../src/types.ts'
import ForgeService, { changeRequestKey } from '../src/index.ts'
import { demo, FakeProvider, forgeContext, provide, ref, snapshot } from './fake-provider.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  vi.useRealTimers()
})

it('cancels and drains a provider fetch before its fiber finishes unloading', async () => {
  vi.useFakeTimers()
  ctx = await forgeContext()
  const provider = new FakeProvider()
  const result = Promise.withResolvers<Awaited<ReturnType<ForgeProvider['fetch']>>>()
  const aborted = Promise.withResolvers<undefined>()
  provider.fetchImpl = (_refs, signal) => {
    signal.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
    return result.promise
  }
  const fiber = await provide(ctx, provider)
  const updates: ChangeRequestUpdate[] = []
  ctx.forge.watch(ref(1), (update) => { updates.push(update) })
  let disposed = false
  try {
    await vi.advanceTimersByTimeAsync(0)
    const disposal = fiber.dispose().then(() => { disposed = true })
    await aborted.promise
    expect(disposed).toBe(false)
    expect(provider.signals[0]?.aborted).toBe(true)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ failure: { code: 'unavailable' } })

    result.resolve(new Map([[changeRequestKey(ref(1)), snapshot(ref(1), { state: 'closed' })]]))
    await disposal
    await vi.advanceTimersByTimeAsync(0)
    expect(updates).toHaveLength(1)
    expect(ctx.forge.latest(ref(1))).toMatchObject({ failure: { code: 'unavailable' } })
  } finally {
    result.resolve(new Map())
  }
})

it.each(['provider', 'service'] as const)('cancels and drains head lookups when the %s stops', async (owner) => {
  ctx = await forgeContext()
  const provider: ForgeProvider = new FakeProvider()
  const result = Promise.withResolvers<Awaited<ReturnType<ForgeProvider['findByHead']>>>()
  const aborted = Promise.withResolvers<undefined>()
  vi.spyOn(provider, 'findByHead').mockImplementation((_repository, _branch, signal) => {
    signal.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
    return result.promise
  })
  const fiber = await provide(ctx, provider)
  const lookup = ctx.forge.findByHead(demo, 'topic', new AbortController().signal)
  const rejected = expect(lookup).rejects.toThrow(owner === 'provider' ? 'was unregistered' : /disposed|unregistered/)
  let disposed = false
  try {
    const disposal = (owner === 'provider' ? fiber : ctx.fiber).dispose().then(() => { disposed = true })
    await aborted.promise
    expect(disposed).toBe(false)
    result.resolve([ref(3)])
    await rejected
    await disposal
    expect(disposed).toBe(true)
  } finally {
    result.resolve([])
    await rejected
  }
})

it('does not invoke a provider for an already cancelled lookup', async () => {
  ctx = await forgeContext()
  const provider = new FakeProvider()
  const lookup = vi.spyOn(provider, 'findByHead')
  await provide(ctx, provider)
  await expect(ctx.forge.findByHead(demo, 'topic', AbortSignal.abort(new Error('caller stopped')))).rejects.toThrow('caller stopped')
  expect(lookup).not.toHaveBeenCalled()
})

it('contains failed registry observers and still notifies other observers', async () => {
  ctx = await forgeContext()
  const warning = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  const notified = Promise.withResolvers<string>()
  ctx.on('forge/providers-changed', () => { throw new Error('observer failed') })
  ctx.on('forge/providers-changed', (forge) => { notified.resolve(forge) })
  await provide(ctx, new FakeProvider())
  expect(await notified.promise).toBe('fake')
  await vi.waitFor(() => { expect(warning).toHaveBeenCalledWith(expect.stringContaining('provider change listener failed')) })
})

it('immediately polls existing watches only for the provider being registered', async () => {
  vi.useFakeTimers()
  ctx = await forgeContext()
  const updates: ChangeRequestUpdate[] = []
  ctx.forge.watch(ref(1), (update) => { updates.push(update) })
  ctx.forge.watch(ref(2, { ...demo, forge: 'other' }), () => {})
  await vi.advanceTimersByTimeAsync(0)
  expect(updates.at(-1)).toMatchObject({ failure: { code: 'unavailable' } })
  const provider = new FakeProvider()
  provider.results.set(changeRequestKey(ref(1)), snapshot(ref(1)))
  await provide(ctx, provider)
  await vi.advanceTimersByTimeAsync(0)
  expect(provider.fetches).toEqual([[ref(1)]])
  expect(updates.at(-1)).toMatchObject({ snapshot: snapshot(ref(1)) })
})

it('does not announce provider withdrawal after its registry has stopped', async () => {
  ctx = new Context()
  const service = ctx.plugin(ForgeService)
  await service
  const observer = vi.fn()
  ctx.on('forge/providers-changed', observer)
  const unregister = ctx.forge.register(new FakeProvider())
  await service.dispose()
  await unregister()
  expect(observer).toHaveBeenCalledTimes(1)
})

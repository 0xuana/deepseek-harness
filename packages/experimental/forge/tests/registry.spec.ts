import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import ForgeService, { changeRequestKey } from '../src/index.ts'
import { demo, FakeProvider, forgeContext, provide, ref } from './fake-provider.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

describe('forge registry', () => {
  it('resolves remotes and change request URLs through the first provider that serves them', async () => {
    ctx = await forgeContext()
    await provide(ctx, new FakeProvider('fake'))
    await provide(ctx, new FakeProvider('other'))

    expect(ctx.forge.repositoryFromRemote('fake://fake.test/Octo/Demo')).toEqual({ forge: 'fake', host: 'fake.test', owner: 'Octo', name: 'Demo' })
    expect(ctx.forge.changeRequestFromUrl('https://fake.test/Octo/Demo/change/7')).toEqual(ref(7))
    expect(ctx.forge.repositoryFromRemote('https://unknown.test/a/b')).toBeUndefined()
    expect(ctx.forge.changeRequestFromUrl('https://unknown.test/a/b/pull/1')).toBeUndefined()
  })

  it('delegates repository operations to the provider of their forge', async () => {
    ctx = await forgeContext()
    const provider = new FakeProvider()
    provider.heads.set('Octo/Demo:topic', [ref(3)])
    await provide(ctx, provider)
    const signal = new AbortController().signal

    expect(ctx.forge.changeRequestUrl(ref(3))).toBe('https://fake.test/Octo/Demo/change/3')
    await expect(ctx.forge.findByHead(demo, 'topic', signal)).resolves.toEqual([ref(3)])
  })

  it('rejects operations for a forge without a provider', async () => {
    ctx = await forgeContext()
    const elsewhere = { ...demo, forge: 'missing' }
    const signal = new AbortController().signal

    expect(() => ctx!.forge.changeRequestUrl(ref(1, elsewhere))).toThrow('forge: no provider is registered for "missing"')
    await expect(ctx.forge.findByHead(elsewhere, 'topic', signal)).rejects.toThrow('forge: no provider is registered for "missing"')
  })

  it('refuses a second provider for the same forge', async () => {
    ctx = await forgeContext()
    await provide(ctx, new FakeProvider())

    await expect(provide(ctx, new FakeProvider())).rejects.toThrow('forge: a provider for "fake" is already registered')
  })

  it('removes a provider when its contributing fiber is disposed', async () => {
    ctx = await forgeContext()
    const fiber = await provide(ctx, new FakeProvider())
    expect(ctx.forge.changeRequestFromUrl('https://fake.test/Octo/Demo/change/1')).toBeDefined()

    await fiber.dispose()

    expect(ctx.forge.changeRequestFromUrl('https://fake.test/Octo/Demo/change/1')).toBeUndefined()
    expect(ctx.forge.repositoryFromRemote('fake://fake.test/Octo/Demo')).toBeUndefined()
  })

  it('removes a provider through the disposer that register returns', async () => {
    ctx = await forgeContext()
    const unregister = ctx.forge.register(new FakeProvider())
    expect(ctx.forge.repositoryFromRemote('fake://fake.test/Octo/Demo')).toBeDefined()

    unregister()

    expect(ctx.forge.repositoryFromRemote('fake://fake.test/Octo/Demo')).toBeUndefined()
  })

  it('builds case-insensitive keys from forge, host, owner, name, and number', () => {
    const upper = changeRequestKey(ref(9, { forge: 'fake', host: 'FAKE.test', owner: 'OCTO', name: 'DEMO' }))

    expect(upper).toBe('fake:fake.test/octo/demo#9')
    expect(changeRequestKey(ref(9))).toBe(upper)
  })

  it.each([
    ['activeIntervalMs', 0],
    ['idleIntervalMs', -1],
    ['maxBackoffMs', 1.5],
    ['fetchTimeoutMs', 2_147_483_648],
  ])('rejects %s = %s at load', async (key, value) => {
    ctx = new Context()

    await expect(ctx.plugin(ForgeService, { [key]: value })).rejects.toThrow(`forge: ${key} must be a positive integer no greater than 2147483647`)
  })
})

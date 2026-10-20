import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ForgeService from '@deepseek-ai/dsh-experimental-forge'
import SessionStore, { pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import ForgeSessionService from '../src/index.ts'
import type { Config, SessionChangeRequest, SessionChangeRequestsListener } from '../src/index.ts'
import { bench, demo, pull, pullUrl, pushOutput, shellTurn, snapshot } from './fixtures.ts'
import type { Bench } from './fixtures.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function open(config: Config = {}): Promise<Bench> {
  const opened = await bench(config)
  contexts.push(opened.ctx)
  return opened
}

function records(session: Session): unknown[] {
  return session.snapshotEvents().flatMap((event) => {
    const record = pluginRecordOf(event)
    return record === undefined ? [] : [record.data]
  })
}

function create(session: Session, callId: string, url: string): void {
  shellTurn(session, [{ callId, command: 'gh pr create --fill', output: `${url}\n` }])
}

function push(session: Session, callId: string, branch: string, remote?: string): void {
  shellTurn(session, [{ callId, command: `git push -u origin ${branch}`, output: pushOutput(branch, remote) }])
}

async function settle(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve))
}

describe('forgeSession bindings', () => {
  it('lists created bindings with their reference and no polling result', async () => {
    const { ctx, session } = await open()
    create(session, 'create', pullUrl(1))

    expect(ctx.forgeSession.changeRequests(session)).toEqual([{ url: pullUrl(1), origin: 'created', ref: pull(1), update: null }])
  })

  it('lists a URL that no provider serves without a reference', async () => {
    const { ctx, session } = await open()
    create(session, 'create', 'https://github.com/octo/demo/pull/5')

    expect(ctx.forgeSession.changeRequests(session)).toEqual([{ url: 'https://github.com/octo/demo/pull/5', origin: 'created', ref: null, update: null }])
  })

  it('keeps bindings per Session', async () => {
    const { ctx, session } = await open()
    const other = ctx.sessions.create()
    create(session, 'create', pullUrl(1))

    expect(ctx.forgeSession.changeRequests(other)).toEqual([])
  })
})

describe('forgeSession discovery', () => {
  it('records change requests found for a pushed branch', async () => {
    const { ctx, provider, session } = await open()
    provider.heads.set('feat', [pull(7)])
    push(session, 'push', 'feat')

    await vi.waitFor(() => { expect(records(session)).toEqual([{ action: 'discover', url: pullUrl(7) }]) })
    expect(provider.lookups.map(lookup => [lookup.repository, lookup.branch])).toEqual([[demo, 'feat']])
    expect(ctx.forgeSession.changeRequests(session)).toEqual([{ url: pullUrl(7), origin: 'discovered', ref: pull(7), update: null }])
  })

  it('skips remotes that no provider serves and change requests that are already bound', async () => {
    const { provider, session } = await open()
    provider.heads.set('feat', [pull(7)])
    push(session, 'elsewhere', 'feat', 'github.com:octo/demo.git')
    await settle()
    expect(provider.lookups).toEqual([])

    shellTurn(session, [{ callId: 'both', command: 'git push -u origin feat && gh pr create --fill', output: `${pushOutput('feat')}\n${pullUrl(7)}` }])
    await vi.waitFor(() => { expect(provider.lookups).toHaveLength(1) })
    await settle()
    expect(records(session)).toEqual([])
  })

  it('looks up again on every push of a branch', async () => {
    const { provider, session } = await open()
    push(session, 'first', 'feat')
    await vi.waitFor(() => { expect(provider.lookups).toHaveLength(1) })
    provider.heads.set('feat', [pull(8)])
    push(session, 'second', 'feat')

    await vi.waitFor(() => { expect(records(session)).toEqual([{ action: 'discover', url: pullUrl(8) }]) })
  })

  it('never restores a dismissed binding', async () => {
    const { ctx, provider, session } = await open()
    create(session, 'create', pullUrl(7))
    ctx.forgeSession.dismiss(session, pullUrl(7))
    provider.heads.set('feat', [pull(7)])
    push(session, 'push', 'feat')
    await vi.waitFor(() => { expect(provider.lookups).toHaveLength(1) })
    await settle()

    expect(records(session)).toEqual([{ action: 'dismiss', url: pullUrl(7) }])
    expect(ctx.forgeSession.changeRequests(session)).toEqual([])
  })

  it.each([
    [new Error('gh is not signed in'), 'gh is not signed in'],
    ['plain failure', 'plain failure'],
  ])('logs a failed lookup (%s)', async (error, message) => {
    const { ctx, provider, session } = await open()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- covers providers that reject with a non-Error reason.
    provider.findImpl = () => Promise.reject(error)
    push(session, 'push', 'feat')

    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(`forge-session: change request lookup for feat failed: ${message}`) })
    expect(records(session)).toEqual([])
  })

  it('times out a lookup', async () => {
    const { ctx, provider, session } = await open({ discoveryTimeoutMs: 20 })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    provider.findImpl = (_branch, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(signal.reason as Error) })
    })
    push(session, 'push', 'feat')

    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('forge-session: change request lookup for feat failed: FORGE_DISCOVERY_TIMEOUT after 20ms') })
  })

  it.each(['resolves', 'rejects'])('drops a lookup that %s after the service stops', async (outcome) => {
    const { ctx, provider, session, service } = await open()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    provider.findImpl = (_branch, signal) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        if (outcome === 'resolves') resolve([pull(7)])
        else reject(signal.reason as Error)
      })
    })
    push(session, 'push', 'feat')
    await vi.waitFor(() => { expect(provider.lookups).toHaveLength(1) })

    await service.dispose()

    expect(provider.lookups[0]?.signal.aborted).toBe(true)
    expect(records(session)).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('forgeSession track and dismiss', () => {
  it('tracks a URL once under its canonical form', async () => {
    const { ctx, session } = await open()
    ctx.forgeSession.track(session, 'http://FAKE.test/octo/demo/pull/3/files')
    ctx.forgeSession.track(session, pullUrl(3))

    expect(records(session)).toEqual([{ action: 'track', url: pullUrl(3) }])
    expect(ctx.forgeSession.changeRequests(session)).toEqual([{ url: pullUrl(3), origin: 'tracked', ref: pull(3), update: null }])
  })

  it('rejects a URL that no provider recognizes', async () => {
    const { ctx, session } = await open()

    expect(() => { ctx.forgeSession.track(session, 'https://github.com/octo/demo/pull/1') }).toThrow('forge-session: no forge provider recognizes "https://github.com/octo/demo/pull/1"')
    expect(records(session)).toEqual([])
  })

  it('dismisses a visible binding once and restores it through track', async () => {
    const { ctx, session } = await open()
    create(session, 'create', pullUrl(1))
    ctx.forgeSession.dismiss(session, `${pullUrl(1)}?tab=checks`)
    ctx.forgeSession.dismiss(session, pullUrl(1))
    ctx.forgeSession.dismiss(session, pullUrl(9))
    expect(ctx.forgeSession.changeRequests(session)).toEqual([])

    ctx.forgeSession.track(session, pullUrl(1))

    expect(records(session)).toEqual([{ action: 'dismiss', url: pullUrl(1) }, { action: 'track', url: pullUrl(1) }])
    expect(ctx.forgeSession.changeRequests(session)).toEqual([{ url: pullUrl(1), origin: 'created', ref: pull(1), update: null }])
  })
})

describe('forgeSession watch', () => {
  function lastList(listener: Mock<SessionChangeRequestsListener>): readonly SessionChangeRequest[] {
    return listener.mock.lastCall?.[0] ?? []
  }

  it('polls visible change requests and notifies after results and binding changes', async () => {
    const { ctx, provider, session } = await open()
    create(session, 'create', pullUrl(1))
    create(session, 'unserved', 'https://github.com/octo/demo/pull/5')
    const listener = vi.fn<SessionChangeRequestsListener>()
    ctx.forgeSession.watch(session, listener)

    await vi.waitFor(() => { expect(lastList(listener)[0]?.update).toMatchObject({ snapshot: snapshot(pull(1)) }) })
    expect(lastList(listener)[1]).toEqual({ url: 'https://github.com/octo/demo/pull/5', origin: 'created', ref: null, update: null })
    expect(provider.fetches).toEqual([[1]])

    create(session, 'second', pullUrl(2))
    expect(lastList(listener).map(entry => [entry.url, entry.update])).toEqual([
      [pullUrl(1), expect.objectContaining({ snapshot: snapshot(pull(1)) })],
      ['https://github.com/octo/demo/pull/5', null],
      [pullUrl(2), null],
    ])
    await vi.waitFor(() => { expect(lastList(listener)[2]?.update).toMatchObject({ snapshot: snapshot(pull(2)) }) })

    ctx.forgeSession.dismiss(session, pullUrl(1))
    expect(lastList(listener).map(entry => entry.url)).toEqual(['https://github.com/octo/demo/pull/5', pullUrl(2)])
    expect(ctx.forge.latest(pull(1))).toBeUndefined()
    expect(ctx.forge.latest(pull(2))).toBeDefined()
    expect(ctx.forgeSession.changeRequests(session)).toEqual(lastList(listener))
  })

  it('does not notify for events that leave the bindings unchanged', async () => {
    const { ctx, session } = await open()
    create(session, 'create', pullUrl(1))
    const listener = vi.fn<SessionChangeRequestsListener>()
    ctx.forgeSession.watch(session, listener)
    await vi.waitFor(() => { expect(listener).toHaveBeenCalledTimes(1) })

    shellTurn(session, [{ callId: 'list', command: 'ls', output: 'README.md' }])
    ctx.forgeSession.track(session, pullUrl(1))

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stops polling when the last watcher leaves, including through fiber disposal', async () => {
    const { ctx, session } = await open()
    create(session, 'create', pullUrl(1))
    const stop = ctx.forgeSession.watch(session, () => {})
    const fiber = ctx.plugin({
      inject: ['forgeSession'],
      apply(child: Context) {
        child.forgeSession.watch(session, () => {})
      },
    })
    await fiber
    await vi.waitFor(() => { expect(ctx.forge.latest(pull(1))).toBeDefined() })

    stop()
    expect(ctx.forge.latest(pull(1))).toBeDefined()
    await fiber.dispose()
    expect(ctx.forge.latest(pull(1))).toBeUndefined()

    create(session, 'second', pullUrl(2))
    await settle()
    expect(ctx.forge.latest(pull(2))).toBeUndefined()
  })

  it('logs a listener failure and still notifies the others', async () => {
    const { ctx, session } = await open()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const listener = vi.fn<SessionChangeRequestsListener>()
    ctx.forgeSession.watch(session, () => {
      throw new Error('boom')
    })
    ctx.forgeSession.watch(session, listener)

    create(session, 'create', pullUrl(1))

    expect(warn).toHaveBeenCalledWith('forge-session: change request listener failed: Error: boom')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('forgeSession lifecycle', () => {
  it('unregisters its projection and stops discovery when the service fiber is disposed', async () => {
    const { ctx, provider, session, service } = await open()
    create(session, 'create', pullUrl(1))
    expect(ctx.sessionProjections.checkpoint(session).forgeChangeRequests?.val).toMatchObject({ bindings: [{ url: pullUrl(1) }] })

    await service.dispose()
    push(session, 'push', 'feat')
    await settle()

    expect(ctx.sessionProjections.checkpoint(session)).not.toHaveProperty('forgeChangeRequests')
    expect(provider.lookups).toEqual([])
  })

  it.each([0, 1.5, 2_147_483_648])('rejects discoveryTimeoutMs %s at load', async (discoveryTimeoutMs) => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(ForgeService, {})

    await expect(ctx.plugin(ForgeSessionService, { discoveryTimeoutMs })).rejects.toThrow('forge-session: discoveryTimeoutMs must be a positive integer no greater than 2147483647')
  })
})

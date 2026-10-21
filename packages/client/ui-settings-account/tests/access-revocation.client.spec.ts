// @vitest-environment jsdom
/** Account surfaces follow `account/watch` access: a revocation withdraws them and a later grant restores them. */
import { afterEach, expect, it, vi } from 'vitest'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import { apply } from '../src/client/index.ts'

afterEach(() => { vi.unstubAllEnvs() })

type AccessEffect = (() => void) | Iterable<() => void>

/** One `whenAccess` controller: its callback and the disposers of its current installation. */
interface Guard {
  readonly action: string
  readonly install: () => AccessEffect
  installed: (() => void)[] | undefined
}

it('withdraws every account surface and the account stream on revocation, and restores them on the next grant', async () => {
  vi.stubEnv('DSH_CLIENT_VERSION', '0.0.0-test')
  const links = { usageUrl: 'https://example.test/usage', topUpUrl: 'https://example.test/top_up' }
  const signedIn: AccountView = { status: 'credential-stored', links, attempt: null }
  const guards: Guard[] = []
  const grant = (): void => {
    for (const guard of guards) {
      const effect = guard.install()
      guard.installed = typeof effect === 'function' ? [effect] : [...effect]
    }
  }
  const revoke = (): void => {
    for (const guard of [...guards].reverse()) {
      for (const dispose of (guard.installed ?? []).reverse()) dispose()
      guard.installed = undefined
    }
  }
  const registered = new Map<string, number>()
  const streams: { readonly signal: AbortSignal; readonly accepted: Promise<undefined> }[] = []
  const lifetime: (() => void)[] = []
  const ctx = {
    effect: (install: () => (() => void) | undefined) => { const dispose = install(); if (dispose) lifetime.push(dispose) },
    locale: { register: () => () => {}, bind: () => (key: string) => key, getSnapshot: () => ({ active: 'en' }) },
    configForms: {
      get: () => ({ subscribe: () => () => {}, getSnapshot: () => ({ status: 'loading', value: undefined }) }),
      describe: () => ({ subscribe: () => () => {}, getSnapshot: () => ({ error: null }) }),
    },
    slots: {
      inject: (_name: string, install: () => (() => void) | undefined) => {
        const dispose = install()
        return () => { dispose?.() }
      },
      register: (entry: { readonly name: string }) => {
        registered.set(entry.name, (registered.get(entry.name) ?? 0) + 1)
        return () => { registered.set(entry.name, registered.get(entry.name)! - 1) }
      },
    },
    remoteAccess: {
      whenAccess: (action: string, install: () => AccessEffect) => {
        guards.push({ action, install, installed: undefined })
        return () => {}
      },
    },
    remote: {
      $on: () => () => {},
      session: { initializeDefaultModel: async () => ({ ok: true, value: undefined }) },
      account: { getProfile: async () => ({ ok: true, value: null }), getBalance: async () => ({ ok: true, value: null }) },
      $stream: () => {
        const abort = new AbortController()
        const accepted = Promise.withResolvers<undefined>()
        streams.push({ signal: abort.signal, accepted: accepted.promise })
        return {
          signal: abort.signal,
          dispose: () => { abort.abort() },
          async *[Symbol.asyncIterator]() {
            yield { value: signedIn, accept: () => { accepted.resolve(undefined) } }
            await new Promise((resolve) => { abort.signal.addEventListener('abort', resolve) })
          },
        }
      },
    },
  }
  const surfaces = (): Record<string, number | undefined> => Object.fromEntries(
    ['settings.launcher', 'shell.quota-notice', 'settings.models.sign-in', 'settings.section'].map(name => [name, registered.get(name)]),
  )
  try {
    apply(ctx as never)
    expect(new Set(guards.map(guard => guard.action))).toEqual(new Set(['account/watch']))
    grant()
    await streams[0]!.accepted
    expect(surfaces()).toEqual({ 'settings.launcher': 1, 'shell.quota-notice': 1, 'settings.models.sign-in': 1, 'settings.section': 1 })

    revoke()
    expect(streams[0]!.signal.aborted).toBe(true)
    expect(surfaces()).toEqual({ 'settings.launcher': 0, 'shell.quota-notice': 0, 'settings.models.sign-in': 0, 'settings.section': 0 })

    grant()
    await streams[1]!.accepted
    expect(surfaces()).toEqual({ 'settings.launcher': 1, 'shell.quota-notice': 1, 'settings.models.sign-in': 1, 'settings.section': 1 })
  } finally {
    revoke()
    for (const dispose of lifetime.reverse()) dispose()
  }
})

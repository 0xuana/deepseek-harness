/**
 * The official chat route's endpoint decides where its API key may go. These cases boot a real Loader
 * composition so the providers read the endpoint from the `dsh-llm-deepseek-api-key` row they would find
 * in a deployment, rather than from a value the test hands them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FiberState } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as Official from '@deepseek-ai/dsh-llm-deepseek-api-key'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as webApiPlugin from '@deepseek-ai/dsh-web-deepseek-api'

const GATEWAY = 'https://gateway.test/anthropic'

type Operation = 'search' | 'fetch'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

interface Composition {
  /** Config of the official chat route's row; omitted keeps the official endpoint and key reference. */
  chat?: Record<string, unknown>
  /** web-deepseek-api row config. */
  api?: Record<string, unknown>
}

/**
 * Boot the official chat route, the web seam with both APIs selected, and this plugin from one
 * cordis.yml. Keys come from the launch environment, the credential plane of a composition without
 * the credentials service.
 * @param composition - chat route and API config.
 * @returns the booted Host context.
 */
async function compose(composition: Composition): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-api-chat-endpoint-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  cleanups.push(() => {
    if (previousHome === undefined) Reflect.deleteProperty(process.env, 'DSH_HOME')
    else process.env.DSH_HOME = previousHome
    return Promise.resolve()
  })
  const rows = [
    { id: 'llm', name: '@deepseek-ai/dsh-llm' },
    { id: 'session', name: '@deepseek-ai/dsh-session' },
    { id: 'session-projection', name: '@deepseek-ai/dsh-session-projection' },
    { id: 'agents', name: '@deepseek-ai/dsh-agent' },
    { id: 'llm-deepseek', name: '@deepseek-ai/dsh-llm-deepseek-api-key', config: composition.chat ?? {} },
    { id: 'web', name: '@deepseek-ai/dsh-web', config: { searchProvider: 'deepseek-search-api', fetchProvider: 'deepseek-fetch-api' } },
    { id: 'web-deepseek-api', name: '@deepseek-ai/dsh-web-deepseek-api', config: composition.api ?? {} },
  ]
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify(rows))
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime], ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-agent', AgentRegistry], ['@deepseek-ai/dsh-llm-deepseek-api-key', Official],
    ['@deepseek-ai/dsh-web', WebRuntime], ['@deepseek-ai/dsh-web-deepseek-api', webApiPlugin],
  ])
  const ctx = await boot('web-api-chat-endpoint', configPath, [], (host) => {
    const sourceModules: ModuleLoaderV2 = {
      version: 'v2', loadCache: new Map(),
      import(specifier) {
        if (!modules.has(specifier)) return Promise.reject(new Error(`Unexpected fixture module ${specifier}`))
        return Promise.resolve(modules.get(specifier))
      },
      register(): never { throw new Error('Unexpected module hook registration') },
      getOrCreateModuleJob(): never { throw new Error('Unexpected module job creation') },
      resolveSync(): never { throw new Error('Unexpected synchronous module resolution') },
      load(): never { throw new Error('Unexpected module load') },
    }
    host.loader.internal = sourceModules
    host.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{
      source: 'process', values: { DEEPSEEK_API_KEY: 'chat-key', GATEWAY_KEY: 'gateway-key', DSH_WEB_API_KEY: 'api-key' },
    }]))
  })
  cleanups.push(() => ctx.fiber.dispose())
  return ctx
}

/** Ask the seam whether `operation` is ready for a model request on the official route. */
function officialRouteReady(ctx: Context, operation: Operation): Promise<boolean> {
  return operation === 'search' ? ctx.web.searchReady('deepseek-official') : ctx.web.fetchReady('deepseek-official')
}

describe.each<Operation>(['search', 'fetch'])('%s with the official chat route loaded', (operation) => {
  it('is ready when the official route chats through the official endpoint', async () => {
    const ctx = await compose({})
    expect(await officialRouteReady(ctx, operation)).toBe(true)
  })

  it('is not ready when the official route chats through a gateway', async () => {
    const ctx = await compose({ chat: { baseURL: GATEWAY } })
    expect(await officialRouteReady(ctx, operation)).toBe(false)
  })

  it('refuses the operation instead of sending the gateway key to DeepSeek', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}')))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await compose({ chat: { baseURL: GATEWAY } })
    const session = ctx.sessions.create(SessionId(`web-api-gateway-${operation}`))
    session.append('turn/start', { turn: 1 })
    session.append('request/context', { provider: 'deepseek-official', model: 'deepseek-flash' })
    const pending = ctx.agents.withInitiator({ session } as Agent, () => operation === 'search'
      ? ctx.web.search({ query: 'q' })
      : ctx.web.fetch({ url: 'https://example.test/' }))
    await expect(pending).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ENDPOINT_MISMATCH',
      message: 'DeepSeek web access is not enabled: DEEPSEEK_API_KEY is the key for the DeepSeek chat endpoint '
        + 'https://gateway.test, so it is not sent to the Search and Fetch API endpoint https://api.deepseek.com. Only '
        + 'the user can enable web access, by configuring web-deepseek-api.apiKeyEnv, web-deepseek-api.apiKey, or '
        + 'web-deepseek-api.baseURL.',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('pairs nothing once the official route holds a config its own requests reject', async () => {
    const ctx = await compose({ chat: { baseURL: GATEWAY } })
    const entry = [...ctx.loader.entries()].find(row => row.options.id === 'llm-deepseek')
    if (entry === undefined) throw new Error('Missing official route row')
    // A volatile-only update keeps the route active with a base URL it can no longer resolve.
    await entry.update({ config: { baseURL: 'not a url' } })
    await ctx.loader.await()
    expect(entry.fiber?.state).toBe(FiberState.ACTIVE)
    expect(await officialRouteReady(ctx, operation)).toBe(true)
  })

  it.each<[string, Composition]>([
    ['the APIs have their own key reference', { chat: { baseURL: GATEWAY }, api: { apiKeyEnv: 'DSH_WEB_API_KEY' } }],
    ['the APIs have their own API base', { chat: { baseURL: GATEWAY }, api: { baseURL: 'https://gateway.test/v1/tools' } }],
    ['the chat route reads another key reference', { chat: { baseURL: GATEWAY, apiKeyEnv: 'GATEWAY_KEY' } }],
  ])('is ready behind a gateway when %s', async (_label, composition) => {
    const ctx = await compose(composition)
    expect(await officialRouteReady(ctx, operation)).toBe(true)
  })
})

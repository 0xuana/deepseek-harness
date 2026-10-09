/**
 * The official chat route's endpoint decides where its API key may go. These cases boot a real Loader
 * composition so the provider reads the endpoint from the `dsh-llm-deepseek-api-key` row it would find
 * in a deployment, rather than from a value the test hands it.
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
import WebRuntime from '@deepseek-ai/dsh-web'
import * as deepseekPlugin from '@deepseek-ai/dsh-web-search-deepseek'

const GATEWAY = 'https://gateway.test/anthropic'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

interface Composition {
  /** `baseURL` of the official chat route's row; omitted keeps the official endpoint. */
  chatBaseURL?: string
  /** web-search-deepseek row config. */
  search?: Record<string, unknown>
}

/**
 * Boot the official chat route, the web seam, and this provider from one cordis.yml. Both keys come
 * from the launch environment, the credential plane of a composition without the credentials service.
 * @param composition - chat endpoint and search config.
 * @returns the booted Host context.
 */
async function compose(composition: Composition): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-search-chat-endpoint-'))
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
    { id: 'agents', name: '@deepseek-ai/dsh-agent' },
    {
      id: 'llm-deepseek', name: '@deepseek-ai/dsh-llm-deepseek-api-key',
      config: composition.chatBaseURL === undefined ? {} : { baseURL: composition.chatBaseURL },
    },
    { id: 'web', name: '@deepseek-ai/dsh-web', config: { searchProvider: deepseekPlugin.DEEPSEEK_PROVIDER_ID } },
    { id: 'web-search-deepseek', name: '@deepseek-ai/dsh-web-search-deepseek', config: composition.search ?? {} },
  ]
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify(rows))
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime], ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-agent', AgentRegistry], ['@deepseek-ai/dsh-llm-deepseek-api-key', Official],
    ['@deepseek-ai/dsh-web', WebRuntime], ['@deepseek-ai/dsh-web-search-deepseek', deepseekPlugin],
  ])
  const ctx = await boot('web-search-chat-endpoint', configPath, [], (host) => {
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
      source: 'process', values: { DEEPSEEK_API_KEY: 'chat-key', DEEPSEEK_SEARCH_KEY: 'search-key' },
    }]))
  })
  cleanups.push(() => ctx.fiber.dispose())
  return ctx
}

describe('web-search-deepseek with the official chat route loaded', () => {
  it('is ready when the official route chats through the official endpoint', async () => {
    const ctx = await compose({})
    expect(await ctx.web.searchReady('deepseek-official')).toBe(true)
  })

  it('is not ready when the official route chats through a gateway', async () => {
    const ctx = await compose({ chatBaseURL: GATEWAY })
    expect(await ctx.web.searchReady('deepseek-official')).toBe(false)
  })

  it('refuses the search instead of sending the gateway key to DeepSeek', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}')))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await compose({ chatBaseURL: GATEWAY })
    const session = ctx.sessions.create(SessionId('web-search-gateway'))
    session.append('turn/start', { turn: 1 })
    session.append('request/context', { provider: 'deepseek-official', model: 'deepseek-flash' })
    const search = ctx.agents.withInitiator({ session } as Agent, () => ctx.web.search({ query: 'q' }))
    const error = await search.then(() => undefined, (rejection: unknown) => rejection)
    expect(error).toMatchObject({
      code: 'WEB_PROVIDER_ENDPOINT_MISMATCH',
      message: 'DeepSeek web search is not enabled: DEEPSEEK_API_KEY is the key for the DeepSeek chat endpoint '
        + 'https://gateway.test, so it is not sent to the search endpoint https://api.deepseek.com. Only the user can '
        + 'enable search, by configuring web-search-deepseek.apiKeyEnv, web-search-deepseek.apiKey, or '
        + 'web-search-deepseek.baseURL.',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('pairs nothing once the official route holds a config its own requests reject', async () => {
    const ctx = await compose({ chatBaseURL: GATEWAY })
    const entry = [...ctx.loader.entries()].find(row => row.options.id === 'llm-deepseek')
    if (entry === undefined) throw new Error('Missing official route row')
    // A volatile-only update keeps the route active with a base URL it can no longer resolve.
    await entry.update({ config: { baseURL: 'not a url' } })
    await ctx.loader.await()
    expect(entry.fiber?.state).toBe(FiberState.ACTIVE)
    expect(await ctx.web.searchReady('deepseek-official')).toBe(true)
  })

  it.each<[string, Composition]>([
    ['its own key reference', { chatBaseURL: GATEWAY, search: { apiKeyEnv: 'DEEPSEEK_SEARCH_KEY' } }],
    ['a search endpoint on the gateway origin', { chatBaseURL: GATEWAY, search: { baseURL: `${GATEWAY}/v1` } }],
    ['a search endpoint on another origin', { chatBaseURL: GATEWAY, search: { baseURL: 'https://search.example.test/anthropic/v1' } }],
  ])('is ready behind a gateway when web search has %s', async (_label, composition) => {
    const ctx = await compose(composition)
    expect(await ctx.web.searchReady('deepseek-official')).toBe(true)
  })
})

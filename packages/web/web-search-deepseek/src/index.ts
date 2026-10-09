/**
 * Register a DeepSeek-backed provider in `ctx.web`. It calls the Anthropic-compatible Messages API
 * with native `web_search_20250305`. A search initiated by a Session on the DeepSeek account route
 * authenticates with the account token when the account service allows the search endpoint;
 * every other search reuses `DEEPSEEK_API_KEY`. The provider does not reuse `DEEPSEEK_BASE_URL`;
 * auxiliary search has its own endpoint configuration. The API key is sent only for model requests on
 * the DeepSeek routes or the routes a deployment lists, and the official chat route's own key only to a
 * search endpoint on that route's chat origin. The provider reports itself not ready for a model request
 * whose search would have no credential it may send.
 * @module @deepseek-ai/dsh-web-search-deepseek
 */
import type { Volatile } from '@deepseek-ai/cordis'

import { FiberState } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { plainOptions, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek-api-key'
import type { Config as OfficialRouteConfig, ResolvedDeepSeekOptions } from '@deepseek-ai/dsh-llm-deepseek-api-key'
import type {} from '@deepseek-ai/dsh-session'
import { WebError } from '@deepseek-ai/dsh-web'
import {
  DeepSeekSearchProvider,
  DEEPSEEK_DEFAULT_API_VERSION,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MAX_USES,
  DEEPSEEK_DEFAULT_MODEL,
} from './provider.ts'
import type { DeepSeekSearchProviderOptions } from './provider.ts'

export {
  DeepSeekSearchProvider,
  DEEPSEEK_DEFAULT_API_VERSION,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MAX_USES,
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_PROVIDER_ID,
} from './provider.ts'
export type { DeepSeekSearchLlmRequest, DeepSeekSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-deepseek'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal DeepSeek API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey: Volatile<string | undefined>
  /** Credential reference resolved for each search; defaults to `DEEPSEEK_API_KEY`. */
  apiKeyEnv: Volatile<string>
  /** Anthropic-compatible endpoint base; `/messages` is appended. */
  baseURL: Volatile<string | undefined>
  /** Anthropic-format model name. Defaults to `deepseek-v4-flash`. */
  model: Volatile<string>
  /** `anthropic-version` header value. Defaults to `2023-06-01`. */
  apiVersion: Volatile<string>
  /** Upper bound on generated tokens for the Messages request. Defaults to 4096. */
  maxTokens: Volatile<number>
  /** Maximum `web_search` server-tool uses per request. Defaults to 5. */
  maxUses: Volatile<number>
  /**
   * Chat routes besides `deepseek-account` and `deepseek-official` whose model requests may search; each
   * such search is billed to the DeepSeek API key. Defaults to none.
   */
  routes: Volatile<string[]>
}

export const Config = z.object({
  apiKey: z.string().role('secret').volatile(),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  baseURL: z.string().volatile(),
  model: z.string().default(DEEPSEEK_DEFAULT_MODEL).volatile(),
  apiVersion: z.string().default(DEEPSEEK_DEFAULT_API_VERSION).volatile(),
  maxTokens: z.number().step(1).min(1).default(DEEPSEEK_DEFAULT_MAX_TOKENS).volatile(),
  maxUses: z.number().step(1).min(1).default(DEEPSEEK_DEFAULT_MAX_USES).volatile(),
  routes: z.array(z.string()).default([]).volatile(),
})

/**
 * Auxiliary-search endpoint, independent of the conversation adapter's
 * `$DEEPSEEK_BASE_URL` and selected protocol.
 */
const SEARCH_BASE_URL_ENV = 'DEEPSEEK_SEARCH_BASE_URL'

/** Provider route id `dsh-llm-deepseek-account` registers; `request/context` events record it per Session. */
const ACCOUNT_PROVIDER = 'deepseek-account'

/** Provider route id `dsh-llm-deepseek-api-key` registers. */
const OFFICIAL_PROVIDER = 'deepseek-official'

/** Package whose Loader row owns the official route's endpoint and key reference. */
const OFFICIAL_ROUTE_PACKAGE = '@deepseek-ai/dsh-llm-deepseek-api-key'

/** Chat routes whose model requests may search without being listed in `routes`. */
const DEEPSEEK_ROUTES: ReadonlySet<string> = new Set([ACCOUNT_PROVIDER, OFFICIAL_PROVIDER])

/** Settings namespace carrying this provider's endpoint, model, and key reference. */
export const WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE = 'web-search-deepseek'

/** Options for one search, with the facts the API-key checks read. */
type SearchOptions = DeepSeekSearchProviderOptions & {
  readonly apiKeyEnv: CredentialRef
  /** Literal key from config, released only after the API-key checks pass. */
  readonly literalApiKey?: string
  /** Chat routes listed besides the DeepSeek routes. */
  readonly routes: readonly string[]
}

/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(
  ctx: Context, config: { [K in keyof Config]: ReturnType<Config[K]['get']> },
): SearchOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  const options: SearchOptions = {
    ...literalApiKey === undefined ? {} : { literalApiKey },
    resolveAccountToken: async (endpoint) => {
      // The latest request context names the route that served the model
      // request which called this search, as account sign-out reads it.
      if (initiatingRoute(ctx) !== ACCOUNT_PROVIDER) return undefined
      return await ctx.get('deepseekAccount')?.resolveToken(endpoint)
    },
    resolveApiKey: async () => {
      // The key leaves only through this resolver, so a refusal here keeps it from every endpoint.
      const refusal = apiKeyRefusal(ctx, options, initiatingRoute(ctx))
      if (refusal !== undefined) throw refusal
      if (literalApiKey !== undefined) return literalApiKey
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    routes: config.routes,
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get(SEARCH_BASE_URL_ENV)?.value
      ?? DEEPSEEK_DEFAULT_BASE_URL,
    model: config.model,
    apiVersion: config.apiVersion,
    maxTokens: config.maxTokens,
    maxUses: config.maxUses,
    recordRequest: (request) => {
      ctx.get('agents')?.currentInitiator()?.session.append(
        'web/deepseek-search-llm-request',
        request,
      )
    },
  }
  return options
}

/**
 * The provider route of the model request that is making the current search: the latest request
 * context of the initiating Session.
 * @param ctx - plugin context supplying the agent registry.
 * @returns the route, or undefined for a search outside a model request.
 */
function initiatingRoute(ctx: Context): string | undefined {
  return ctx.get('agents')?.currentInitiator()?.session.requestContext()?.provider
}

/**
 * The official chat route's endpoint and key reference, resolved by its owner's resolver, or undefined
 * when no active `dsh-llm-deepseek-api-key` row serves the route, as in a replay composition.
 * @param ctx - plugin context supplying the Loader rows.
 * @returns the route's base URL and key reference.
 */
function officialChatRoute(ctx: Context): ResolvedDeepSeekOptions | undefined {
  const entry = [...ctx.get('loader')?.entries() ?? []]
    .find(row => row.options.name === OFFICIAL_ROUTE_PACKAGE && row.fiber?.state === FiberState.ACTIVE)
  if (entry?.fiber === undefined) return undefined
  const config = entry.fiber.config as OfficialRouteConfig
  try { return resolveAdapterOptions(plainOptions(config), launchEnvironmentOf(entry.fiber.ctx)) }
  catch (_invalidRouteConfig) { return undefined /* The route rejects this config for its own requests too. */ }
}

/**
 * Why a search for a model request on `route` must not send the API key, or undefined when it may. A
 * route other than the DeepSeek routes and `routes` would bill DeepSeek for another provider's
 * conversation. The official chat route's own key reference goes only to a search endpoint on that
 * route's chat origin, because a key for a gateway is not a DeepSeek key.
 * @param ctx - plugin context supplying the Loader rows.
 * @param options - options the search would use.
 * @param route - provider route of the model request; undefined for a search outside one.
 * @returns the structured refusal, or undefined.
 */
function apiKeyRefusal(ctx: Context, options: SearchOptions, route: string | undefined): WebError | undefined {
  if (route !== undefined && !DEEPSEEK_ROUTES.has(route) && !options.routes.includes(route)) {
    return new WebError(
      `DeepSeek web search is not enabled for conversations on the ${JSON.stringify(route)} model route: each search `
      + 'is billed to the DeepSeek API key. Only the user can enable it, by listing the route in '
      + 'web-search-deepseek.routes.',
      'WEB_PROVIDER_ROUTE_DISABLED',
    )
  }
  if (options.literalApiKey !== undefined) return undefined
  const chat = officialChatRoute(ctx)
  if (chat === undefined || chat.apiKeyEnv !== options.apiKeyEnv) return undefined
  const chatOrigin = new URL(chat.baseURL).origin
  const searchOrigin = new URL(options.baseURL).origin
  if (chatOrigin === searchOrigin) return undefined
  return new WebError(
    `DeepSeek web search is not enabled: ${options.apiKeyEnv} is the key for the DeepSeek chat endpoint ${chatOrigin}, `
    + `so it is not sent to the search endpoint ${searchOrigin}. Only the user can enable search, by configuring `
    + 'web-search-deepseek.apiKeyEnv with a key for the search endpoint, or web-search-deepseek.baseURL with an '
    + 'endpoint on the chat origin that serves native web search.',
    'WEB_PROVIDER_ENDPOINT_MISMATCH',
  )
}

/**
 * Whether the search a model request on `route` would make has a credential it may send, checked in
 * the order the search resolves them: the account token first on the account route, then the API
 * key, which must also pass the route and endpoint checks of {@link apiKeyRefusal}. A failed read
 * answers false, because the search fails on that read instead of trying the next credential. Only
 * presence is checked: the API key's value is not read and the endpoint is not contacted, so a wrong
 * key or an endpoint without native search still counts as configured.
 * @param ctx - plugin context supplying the account, credential, and environment planes.
 * @param options - options the next search would use.
 * @param route - provider route of the model request being assembled.
 * @returns whether the account token or an API key is available to that search.
 */
async function searchConfigured(
  ctx: Context, options: SearchOptions, route: string | undefined,
): Promise<boolean> {
  const account = ctx.get('deepseekAccount')
  if (route === ACCOUNT_PROVIDER && account !== undefined) {
    let token: string | undefined
    try { token = await account.resolveToken(`${options.baseURL}/messages`) }
    catch (_unreadableGrant) { return false /* The search fails on this read before it tries the API key. */ }
    if (token !== undefined && token.length > 0) return true
  }
  if (apiKeyRefusal(ctx, options, route) !== undefined) return false
  if (options.literalApiKey !== undefined) return true
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    const ambient = launchEnvironmentOf(ctx).get(options.apiKeyEnv)
    return ambient !== undefined && ambient.value.length > 0
  }
  try { return (await credentials.describe(options.apiKeyEnv)).configured }
  catch (_unreadableStore) { return false /* A store that cannot be read supplies no key to the search either. */ }
}

/**
 * Register the DeepSeek search provider with `ctx.web`. Its `ready()` answers whether a
 * search for a model request on the given route would have a credential to send.
 */
export function apply(ctx: Context, config: Config): void {
  const options = () => resolveOptions(ctx, {
    apiKey: config.apiKey.get(), apiKeyEnv: config.apiKeyEnv.get(), baseURL: config.baseURL.get(), model: config.model.get(),
    apiVersion: config.apiVersion.get(), maxTokens: config.maxTokens.get(), maxUses: config.maxUses.get(),
    routes: config.routes.get(),
  })
  const provider = new DeepSeekSearchProvider(options)
  ctx.web.registerSearchProvider({
    id: provider.id,
    available: () => provider.available(),
    ready: llmProvider => searchConfigured(ctx, options(), llmProvider),
    search: (request, signal) => provider.search(request, signal),
  })
}

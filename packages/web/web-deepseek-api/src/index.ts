/**
 * Register the DeepSeek Search and Fetch APIs in `ctx.web` as `deepseek-search-api`
 * and `deepseek-fetch-api`. Each operation is one direct API request without an
 * auxiliary model request; both providers read this section's credential and API
 * base. `web.searchProvider` and `web.fetchProvider` select them. A Session on the
 * DeepSeek account route authenticates with the account token when the account
 * service allows the endpoint; every other request uses the configured key. A key
 * or API base configured for these APIs serves every model route; without one, the
 * DeepSeek chat key serves only the DeepSeek routes and only an API base on the
 * official chat route's origin. Both providers report themselves not ready for a
 * model request whose operation would have no credential it may send.
 * @module @deepseek-ai/dsh-web-deepseek-api
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-web'
import { DeepSeekFetchApiProvider } from './fetch.ts'
import { DEEPSEEK_DEFAULT_COUNT, DEEPSEEK_WEB_API_BASE_URL, DeepSeekSearchApiProvider } from './search.ts'
import { deepSeekWebAuth, deepSeekWebCredentialReady, type DeepSeekWebCredentialSettings } from './transport.ts'

export { DEEPSEEK_FETCH_API_PROVIDER_ID, DeepSeekFetchApiProvider } from './fetch.ts'
export type { DeepSeekFetchApiOptions } from './fetch.ts'
export {
  DEEPSEEK_DEFAULT_COUNT, DEEPSEEK_SEARCH_API_PROVIDER_ID, DEEPSEEK_WEB_API_BASE_URL,
  DeepSeekSearchApiProvider, mapSearchResponse,
} from './search.ts'
export type { DeepSeekSearchApiOptions } from './search.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-deepseek-api'

/** The web seam both providers register into. */
export const inject = ['web']

/** Credential reference both APIs resolve by default; the official chat route reads the same one. */
const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** Settings read by the next search or fetch without re-registering either provider. */
export interface Config {
  /** Literal DeepSeek API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey: Volatile<string | undefined>
  /** Credential reference resolved for each operation; defaults to `DEEPSEEK_API_KEY`. */
  apiKeyEnv: Volatile<string>
  /** API base including its path prefix; `/search` and `/fetch` are appended. */
  baseURL: Volatile<string>
  /** Search API results per search, from 1 through 50; a smaller request bound wins. Defaults to 10. */
  count: Volatile<number>
  /** Send the triggering user question, bounded to 128 characters, as `ori_question`. Defaults to true. */
  sendOriginalQuestion: Volatile<boolean>
}

export const Config = z.object({
  apiKey: z.string().role('secret').volatile(),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
  baseURL: z.string().default(DEEPSEEK_WEB_API_BASE_URL).volatile(),
  count: z.number().step(1).min(1).max(50).default(DEEPSEEK_DEFAULT_COUNT).volatile(),
  sendOriginalQuestion: z.boolean().default(true).volatile(),
})

/**
 * Read the text of the latest human prompt, the question that triggered the
 * current turn. Injected user-role context carries another source kind.
 * @param session - the initiating Session, when the search runs inside one.
 * @returns the prompt's joined text blocks, or undefined without a prompt.
 */
function latestUserQuestion(session: Session | undefined): string | undefined {
  const prompt = session?.deriveMessages().findLast(message => message.role === 'user' && message.source.kind === 'user')
  if (prompt === undefined) return undefined
  return prompt.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

/**
 * Snapshot the credential settings for one operation or readiness answer.
 * @param config - live settings.
 * @returns the key sources and API base, and whether the user configured either for these APIs: a
 *   literal key, a key reference other than `DEEPSEEK_API_KEY`, or a base other than the default.
 */
function credentialSettings(config: Config): DeepSeekWebCredentialSettings {
  const apiKey = config.apiKey.get()
  const apiKeyEnv = config.apiKeyEnv.get()
  const baseURL = config.baseURL.get()
  const literalApiKey = apiKey !== undefined && apiKey.length > 0 ? apiKey : undefined
  return {
    ...literalApiKey === undefined ? {} : { literalApiKey },
    apiKeyEnv: credentialRef(apiKeyEnv),
    baseURL,
    configured: literalApiKey !== undefined || apiKeyEnv !== DEFAULT_API_KEY_ENV || baseURL !== DEEPSEEK_WEB_API_BASE_URL,
  }
}

/**
 * Register the Search API and Fetch API providers over one live settings section. Each provider's
 * `ready()` answers whether an operation for a model request on the given route would have a
 * credential it may send.
 * @param ctx - plugin context owning both registrations.
 * @param config - live settings, read once per operation.
 */
export function apply(ctx: Context, config: Config): void {
  const operation = () => {
    const settings = credentialSettings(config)
    return { ...deepSeekWebAuth(ctx, settings), baseURL: settings.baseURL }
  }
  const ready = (llmProvider: string | undefined) => deepSeekWebCredentialReady(ctx, credentialSettings(config), llmProvider)
  const searchApi = new DeepSeekSearchApiProvider(() => ({
    ...operation(),
    count: config.count.get(),
    ...config.sendOriginalQuestion.get() ? {
      originalQuestion: () => latestUserQuestion(ctx.get('agents')?.currentInitiator()?.session),
    } : {},
  }))
  const fetchApi = new DeepSeekFetchApiProvider(operation)
  ctx.web.registerSearchProvider({
    id: searchApi.id, available: () => searchApi.available(), ready, search: (request, signal) => searchApi.search(request, signal),
  })
  ctx.web.registerFetchProvider({
    id: fetchApi.id, available: () => fetchApi.available(), ready, fetch: (request, signal) => fetchApi.fetch(request, signal),
  })
}

# Agent Note: Offer web_search and web_fetch only while the selected provider is ready

Status: implemented

English | [中文](2026-09-27-web-search-offered-by-provider-readiness.zh.md)

## Problem

`dsh-tool-web` registers `web_search` whenever search is enabled, and the [web capability seam decision](2026-06-24-web-capability-seam.md) keeps it visible while the selected provider cannot run. The shipped search provider, `dsh-web-search-deepseek`, authenticates a search with the DeepSeek account token only for a model request on the `deepseek-account` route; every other route needs a configured API key. A Session on an API-key route without a search key was therefore offered a tool whose every call failed with `WEB_PROVIDER_CREDENTIAL_MISSING`. Sessions in one Host can use different routes, a Session can switch routes between requests, and the Web app registers `web_search` once per agent preset, so no registration decision matches every request. The Search and Fetch APIs of `dsh-web-deepseek-api`, which the Web search settings switch selects together, need that credential for both operations, so the same Session was also offered a `web_fetch` whose every call failed.

## Decision

Each role of the web capability seam owns one part of a per-step check:

- **Service Definition.** `WebSearchProvider` and `WebFetchProvider` have an optional `ready(llmProvider)` that answers whether an operation made for a model request on that chat route has a credential to send. It checks configuration only and makes no network calls. `ctx.web.searchReady(llmProvider?)` and `ctx.web.fetchReady(llmProvider?)` resolve the provider with the same rules as `search()` and `fetch()` and return its answer. A provider without `ready()` counts as ready, and a selection failure answers true because the operation reports that failure as a structured `WebError`.
- **Service Provider.** `dsh-web-search-deepseek` answers true when the route is `deepseek-account` and `ctx.deepseekAccount.resolveToken()` returns a token for the configured search endpoint, when the section carries a literal `apiKey`, or when `ctx.credentials.describe()` reports the `apiKeyEnv` reference configured (without that service, when the launching environment carries it). It checks them in the order `search()` resolves them, and a failed account-token or credential-store read answers false, because `search()` fails on that read instead of trying the next credential. The Search and Fetch API providers of `dsh-web-deepseek-api` share one credential and answer the same way for their API base; their transport repeats these checks, so neither package depends on the other. The providers name no tool or prompt section.
- **Consumer.** `dsh-tool-web` registers `web_search` and `web_fetch` with [step activation conditions](../../../../packages/core/tools/README.md#conditional-tools) that ask `ctx.web.searchReady()` and `ctx.web.fetchReady()` about the route of the step's model selection. The agent loop resolves conditions before it assembles the step, so the declared tools, the `tool:web_search` and `tool:web_fetch` prompt sections, PTC program bindings, and dispatch all read the same admitted set.

Whether the API key counts depends on whether the provider has its own configuration. For Messages search that is a literal `apiKey`, an `apiKeyEnv` other than `DEEPSEEK_API_KEY`, `baseURL`, or `$DEEPSEEK_SEARCH_BASE_URL`; for the Search and Fetch APIs it is a literal `apiKey`, an `apiKeyEnv` other than `DEEPSEEK_API_KEY`, or a `baseURL` other than the default their schema fills in. A user who configures any of them has set the provider up deliberately, so its key and endpoint serve every route. Without such configuration the key is the DeepSeek chat key, and the provider applies two checks, repeating them in its API-key resolver, the only place the key leaves:

- **Route.** A model request on a route other than `deepseek-account` and `deepseek-official` is refused with `WEB_PROVIDER_ROUTE_DISABLED`, because its operation would bill the DeepSeek chat key for another provider's conversation.
- **Endpoint.** When the operation would send the official chat route's own key reference, the search endpoint or API base must share the origin of that route's chat endpoint; otherwise the refusal is `WEB_PROVIDER_ENDPOINT_MISMATCH`, because a key for a gateway is not a DeepSeek key. The provider finds the active `dsh-llm-deepseek-api-key` Loader row and resolves its endpoint with that package's own resolver. A composition without that row has no chat endpoint to compare.

Only presence decides: no API key value is read and no endpoint is contacted, so a wrong key or an endpoint that does not serve the native `web_search_20250305` server tool keeps the tool admitted. A step that does not admit a web tool also refuses calls to it as `UNKNOWN_TOOL`, so a model that repeats an earlier call reaches no provider; an operation made outside a model step still applies the provider's checks when it resolves the key.

The request header records the assembled tools, so the agent loop announces each change through tool-registry updates. A route switch, a stored key, or a removed key changes the next request; DeepSeek routes load a returning tool as a deferred addition, and routes without tool-update support receive the complete tool list.

## Alternatives considered

**Let the DeepSeek provider remove `web_search` in its own assemble listener.** The seam stays unchanged, but the provider then names another package's tool, prompt section, and PTC transport, and it removes the tool even when the deployment selects another search provider, such as Exa, whose searches would succeed.

**Extend `available()`.** It is synchronous and takes no request, while this check reads an asynchronous credential store and depends on the request's route. A route-dependent `available()` would also make provider selection depend on the conversation.

**Read the route from the Session's latest `request/context` event instead of passing it.** That event records the previous request, so a new Session's first request and the first request after a model switch would be decided for the wrong route or for none.

**Register or unregister `web_search` in `dsh-tool-web`.** Registration is shared by every Session of an agent preset, while credentials depend on each request's route. Unregistering would also make `toolOrder` entries and subagent `toolFilter` restrictions that name `web_search` fail.

**Remove `web_search` from the assembled request.** A `system-prompt/assemble` listener could drop the declaration and its section, but the tool would stay executable, so a model that repeats an earlier call would still run it, and PTC programs would still bind it. Prompt assembly also no longer carries tool declarations.

**Offer search only on the DeepSeek account route.** Account tokens are issued only for the official endpoint, so no endpoint check would be needed. But every shipped profile defaults to the `deepseek-official` route, so search would be off by default, including the official API-key case, which is as safe as the account.

**List the routes that may search.** A `routes` setting would let a deployment open other providers' conversations explicitly, but configuring search's own key or endpoint already states that intent, and a second setting is one more thing a user has to find.

**Keep offering search on every route that has a DeepSeek key.** A conversation on another provider's model would bill DeepSeek for each search without the user choosing it, and a gateway's key would be sent to DeepSeek's endpoint.

**Treat selecting the Search and Fetch APIs as configuring them.** Turning on the settings switch changes the protocol but keeps the DeepSeek chat key, so the switch alone would reopen both problems of the previous alternative for search and fetch.

**Expose each route's endpoint through `dsh-llm`.** An optional endpoint field on provider or model information would let any consumer compare endpoints, but `listProviders()` is a Remote method, so the field would reach the browser and model-visible model lists for one provider's check.

**Keep the tool offered and fail at execution.** The model spends a call on a search that cannot authenticate, and the failure repeats on every attempt.

**Probe the key or endpoint before offering the tool.** A network request per model request adds latency and cost; the user controls configuration, not its validity at that moment.

## Consequences

`dsh-web` gains public members: the optional `ready()` of both provider interfaces, `WebRuntime.searchReady()`, and `WebRuntime.fetchReady()`. Each readiness method is the smallest query its one consumer needs, which is how the [observation-surface decision](../../archived/simplification/2026-07-04-drop-unconsumed-web-observation-surface.md) lets a status query return; neither reports availability or selection failures. The Exa, Perplexity, and HTTP fetch providers implement no `ready()`, so their behavior is unchanged, and `web_fetch` stays admitted whenever the switch leaves HTTP fetch selected. A step that does not admit a web tool leaves it out of PTC program bindings too. An endpoint that cannot serve the native server tool keeps the tool admitted and fails each call. Removing a tool on an unchanged route changes the declared tools and misses the prompt cache once; a model switch already invalidates it. Using a DeepSeek web provider from another provider's conversation requires that provider's own key or endpoint, and writing out the default key reference `DEEPSEEK_API_KEY` counts as no configuration, while a written Messages `baseURL` counts even when it names the default endpoint. With the Search and Fetch APIs selected, such a conversation, or one behind a gateway, has neither web tool until the APIs have their own key or base. Reading the official chat endpoint makes both DeepSeek web packages depend on `dsh-llm-deepseek-api-key` and on the Loader's rows; replay compositions disable that row and so skip the endpoint check.

Unit tests pin each role: `packages/web/web/tests/web.spec.ts` covers which provider `searchReady()` and `fetchReady()` ask and their answer on selection failure, `packages/web/web-search-deepseek/tests/deepseek.spec.ts` and `packages/web/web-deepseek-api/tests/readiness.spec.ts` cover each credential and route case of `ready()`, and `packages/web/tool-web/tests/tool-web.spec.ts` resolves step admission of both tools through the real prompt, tool, and executor services, including the `UNKNOWN_TOOL` refusal of a call in a step that withheld the tool. The shipped headless keyless smoke test and the `web-search-unconfigured` recorded-session snapshot pin the withheld search tool in real compositions. Snapshot replays supply a placeholder DeepSeek key, so their tool lists do not depend on the runner's environment. Each DeepSeek web package's `chat-endpoint.spec.ts` boots a real Loader composition with the official chat route to pin the endpoint check, and the `pi-ai-conversation-updates` snapshot pins that a conversation on a pi-ai route is not offered `web_search`.

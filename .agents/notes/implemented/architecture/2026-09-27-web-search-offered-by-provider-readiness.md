# Agent Note: Offer web_search only while the selected search provider is ready

Status: implemented

English | [中文](2026-09-27-web-search-offered-by-provider-readiness.zh.md)

## Problem

`dsh-tool-web` registers `web_search` whenever search is enabled, and the [web capability seam decision](2026-06-24-web-capability-seam.md) keeps it visible while the selected provider cannot run. The shipped search provider, `dsh-web-search-deepseek`, authenticates a search with the DeepSeek account token only for a model request on the `deepseek-account` route; every other route needs a configured API key. A Session on an API-key route without a search key was therefore offered a tool whose every call failed with `WEB_PROVIDER_CREDENTIAL_MISSING`. Sessions in one Host can use different routes, a Session can switch routes between requests, and the Web app registers `web_search` once per agent preset, so no registration decision matches every request.

## Decision

Each role of the web capability seam owns one part of a per-request check:

- **Service Definition.** `WebSearchProvider` has an optional `ready(llmProvider)` that answers whether a search made for a model request on that chat route has a credential to send. It checks configuration only and makes no network calls. `ctx.web.searchReady(llmProvider?)` resolves the provider with the same rules as `search()` and returns its answer. A provider without `ready()` counts as ready, and a selection failure answers true because `search()` reports that failure as a structured `WebError`.
- **Service Provider.** `dsh-web-search-deepseek` answers true when the route is `deepseek-account` and `ctx.deepseekAccount.resolveToken()` returns a token for the configured search endpoint, when the section carries a literal `apiKey`, or when `ctx.credentials.describe()` reports the `apiKeyEnv` reference configured (without that service, when the launching environment carries it). It checks them in the order `search()` resolves them, and a failed account-token or credential-store read answers false, because `search()` fails on that read instead of trying the next credential. The provider names no tool or prompt section.
- **Consumer.** `dsh-tool-web` adds a prepended `system-prompt/assemble` listener. For each assembly that offers `web_search`, it asks `ctx.web.searchReady()` about the route that model selection wrote into the assembly variables and, on false, removes the tool and its `tool:web_search` prompt section. Prepending makes the listener run after model selection. An assembly that contains the PTC `run_code` transport is returned unchanged, because the generated SDK declares `web_search` apart from the tool list.

Whether the API key counts depends on whether search has its own configuration: a literal `apiKey`, an `apiKeyEnv` other than `DEEPSEEK_API_KEY`, `baseURL`, or `$DEEPSEEK_SEARCH_BASE_URL`. A user who configures any of them has set search up deliberately, so the key and endpoint configured for search serve every route. Without such configuration the key is the DeepSeek chat key, and the provider applies two checks, repeating them in the API-key resolver of every search, the only place the key leaves:

- **Route.** A model request on a route other than `deepseek-account` and `deepseek-official` is refused with `WEB_PROVIDER_ROUTE_DISABLED`, because its search would bill the DeepSeek chat key for another provider's conversation.
- **Endpoint.** When the search would send the official chat route's own key reference, the search endpoint must share the origin of that route's chat endpoint; otherwise the refusal is `WEB_PROVIDER_ENDPOINT_MISMATCH`, because a key for a gateway is not a DeepSeek key. The provider finds the active `dsh-llm-deepseek-api-key` Loader row and resolves its endpoint with that package's own resolver. A composition without that row has no chat endpoint to compare.

Only presence decides: no API key value is read and no endpoint is contacted, so a wrong key or an endpoint that does not serve the native `web_search_20250305` server tool keeps the tool offered. Withholding changes only the offered tools: a call that still arrives resolves credentials when it runs and fails with the existing structured error.

The request header records the assembled tools, so the agent loop announces each change through tool-registry updates. A route switch, a stored key, or a removed key changes the next request; DeepSeek routes load a returning tool as a deferred addition, and routes without tool-update support receive the complete tool list.

## Alternatives considered

**Let the DeepSeek provider remove `web_search` in its own assemble listener.** The seam stays unchanged, but the provider then names another package's tool, prompt section, and PTC transport, and it removes the tool even when the deployment selects another search provider, such as Exa, whose searches would succeed.

**Extend `available()`.** It is synchronous and takes no request, while this check reads an asynchronous credential store and depends on the request's route. A route-dependent `available()` would also make provider selection depend on the conversation.

**Read the route from the Session's latest `request/context` event instead of passing it.** That event records the previous request, so a new Session's first request and the first request after a model switch would be decided for the wrong route or for none.

**Register or unregister `web_search` in `dsh-tool-web`.** Registration is shared by every Session of an agent preset, while credentials depend on each request's route. Unregistering would also make `toolOrder` entries and subagent `toolFilter` restrictions that name `web_search` fail.

**Add a per-request visibility predicate to `dsh-tools`.** It would also cover the PTC SDK, but it adds a general tool-availability API to a core package for one tool's need.

**Offer search only on the DeepSeek account route.** Account tokens are issued only for the official endpoint, so no endpoint check would be needed. But every shipped profile defaults to the `deepseek-official` route, so search would be off by default, including the official API-key case, which is as safe as the account.

**List the routes that may search.** A `routes` setting would let a deployment open other providers' conversations explicitly, but configuring search's own key or endpoint already states that intent, and a second setting is one more thing a user has to find.

**Keep offering search on every route that has a DeepSeek key.** A conversation on another provider's model would bill DeepSeek for each search without the user choosing it, and a gateway's key would be sent to DeepSeek's endpoint.

**Expose each route's endpoint through `dsh-llm`.** An optional endpoint field on provider or model information would let any consumer compare endpoints, but `listProviders()` is a Remote method, so the field would reach the browser and model-visible model lists for one provider's check.

**Keep the tool offered and fail at execution.** The model spends a call on a search that cannot authenticate, and the failure repeats on every attempt.

**Probe the key or endpoint before offering the tool.** A network request per model request adds latency and cost; the user controls configuration, not its validity at that moment.

## Consequences

`dsh-web` gains two public members, the optional `WebSearchProvider.ready()` and `WebRuntime.searchReady()`. `searchReady()` is the smallest query its one consumer needs, which is how the [observation-surface decision](../../archived/simplification/2026-07-04-drop-unconsumed-web-observation-surface.md) lets a status query return; it reports neither availability nor selection failures. The Exa and Perplexity providers implement no `ready()`, so their behavior is unchanged. PTC presentations keep offering `web_search` without credentials. An endpoint that cannot serve the native server tool keeps the tool offered and fails each call. Removing the tool on an unchanged route changes the declared tools and misses the prompt cache once; a model switch already invalidates it. Searching from another provider's conversation requires search's own key or endpoint, and writing the shipped default values counts as no configuration. Reading the official chat endpoint makes this provider depend on `dsh-llm-deepseek-api-key` and on the Loader's rows; replay compositions disable that row and so skip the endpoint check.

Unit tests pin each role: `packages/web/web/tests/web.spec.ts` covers which provider `searchReady()` asks and its answer on selection failure, `packages/web/web-search-deepseek/tests/deepseek.spec.ts` covers each credential case of `ready()`, and `packages/web/tool-web/tests/tool-web.spec.ts` assembles through the real prompt, tool, and model-selection services. The shipped headless keyless smoke test and the `web-search-unconfigured` recorded-session snapshot pin the withheld tool in real compositions. Snapshot replays supply a placeholder DeepSeek key, so their tool lists do not depend on the runner's environment. `packages/web/web-search-deepseek/tests/chat-endpoint.spec.ts` boots a real Loader composition with the official chat route to pin the endpoint check, and the `pi-ai-conversation-updates` snapshot pins that a conversation on a pi-ai route is not offered `web_search`.

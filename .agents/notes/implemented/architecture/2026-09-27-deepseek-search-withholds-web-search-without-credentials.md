# Agent Note: DeepSeek search withholds web_search from requests without credentials

Status: implemented

English | [中文](2026-09-27-deepseek-search-withholds-web-search-without-credentials.zh.md)

## Problem

`dsh-tool-web` registers `web_search` whenever search is enabled, and the [web capability seam decision](2026-06-24-web-capability-seam.md) keeps it visible while the selected provider cannot run. The shipped search provider, `dsh-web-search-deepseek`, authenticates a search with the DeepSeek account token only for a model request on the `deepseek-account` route; every other route needs a configured API key. A Session on an API-key route without a search key was therefore offered a tool whose every call failed with `WEB_PROVIDER_CREDENTIAL_MISSING`. Sessions in one Host can use different routes, a Session can switch routes between requests, and the Web app registers `web_search` once per agent preset, so no registration decision matches every request.

## Decision

`dsh-web-search-deepseek` adds a prepended `system-prompt/assemble` listener. For each assembly that offers `web_search`, it removes the tool and the `tool:web_search` prompt section unless the search that request would make has a credential:

- the request's `provider` variable is `deepseek-account` and `ctx.deepseekAccount.resolveToken()` returns a token for the configured search endpoint;
- the section carries a literal `apiKey`; or
- `ctx.credentials.describe()` reports the `apiKeyEnv` reference configured, or, without that service, the launching environment carries it.

Only presence decides. The listener reads no key value and contacts no endpoint, so a wrong key or an endpoint that does not serve the native `web_search_20250305` server tool keeps the tool offered. A failed account-token or credential-store read counts as no credential.

The listener is prepended so that it runs after model selection has written the route of this request into the assembly variables. An assembly that contains the PTC `run_code` transport is returned unchanged, because the generated SDK declares `web_search` apart from the tool list. Withholding changes only the offered tools: a call that still arrives resolves credentials when it runs and fails with the existing structured error.

The request header records the assembled tools, so the agent loop announces each change through tool-registry updates. A route switch, a stored key, or a removed key changes the next request; DeepSeek routes load a returning tool as a deferred addition, and routes without tool-update support receive the complete tool list.

## Alternatives considered

**Register or unregister `web_search` in `dsh-tool-web`.** Registration is shared by every Session of an agent preset, while credentials depend on each request's route. Unregistering would also make `toolOrder` entries and subagent `toolFilter` restrictions that name `web_search` fail.

**Add a readiness query to `ctx.web` and a per-request visibility predicate to `dsh-tools`.** This keeps the decision with the tool owner and also covers the PTC SDK, but it adds public API to two core packages and a route accessor to `dsh-agent` for one provider's credential rule.

**Keep the tool offered and fail at execution.** The model spends a call on a search that cannot authenticate, and the failure repeats on every attempt.

**Probe the key or endpoint before offering the tool.** A network request per model request adds latency and cost; the user controls configuration, not its validity at that moment.

## Consequences

The provider edits a tool list owned by `dsh-tool-web` and names that package's tool and prompt section. The check assumes DeepSeek serves search: a composition that loads this provider but selects another one still loses `web_search` whenever DeepSeek has no credential. PTC presentations keep offering `web_search` without credentials. An endpoint that cannot serve the native server tool keeps the tool offered and fails each call. Removing the tool on an unchanged route changes the declared tools and misses the prompt cache once; a model switch already invalidates it.

Unit tests in `packages/web/web-search-deepseek/tests/deepseek.spec.ts` assemble through the real prompt, tool, and model-selection services. The shipped headless keyless smoke test and the `web-search-unconfigured` recorded-session snapshot pin the withheld tool in real compositions. Snapshot replays supply a placeholder DeepSeek key, so their tool lists do not depend on the runner's environment.

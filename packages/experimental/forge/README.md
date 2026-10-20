---
description: "Register code host providers and poll change request status through one provider-neutral service."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-forge

English | [中文](README.zh.md)

## Summary

Read pull requests and merge requests without coupling consumers to one code host. A provider maps remote and change request URLs to provider-neutral references, finds change requests by head branch, and reads their status in batches. Watchers of one change request share a single polling loop whose cadence follows check, mergeability, and lifecycle state.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the registry with at least one provider package, such as the GitHub provider.

```yaml
- name: '@deepseek-ai/dsh-experimental-forge'
- name: '@deepseek-ai/dsh-experimental-forge-github'
```

`ctx.forge.register(provider)` is an effect on the calling fiber and returns its disposer. One provider serves one forge family; registering a second provider for the same family throws. `repositoryFromRemote(url)` and `changeRequestFromUrl(url)` ask providers in registration order and return the first match. `changeRequestUrl(ref)` and `findByHead(repository, branch, signal)` delegate to the provider of the reference's forge and throw when none is registered.

`ctx.forge.watch(ref, listener)` is also an effect. The first watcher of a change request polls it at once; `latest(ref)` returns the most recent result. Each forge has at most one fetch in flight, and that fetch includes every due change request of the forge. An open change request is polled every `activeIntervalMs` while checks are pending or mergeability is unknown, and every `idleIntervalMs` otherwise. Closed and merged change requests are not polled again. A failed read repeats after `activeIntervalMs` doubled for each consecutive failure, up to `maxBackoffMs`. A fetch that exceeds `fetchTimeoutMs` settles as an `unavailable` failure whose message names `FORGE_FETCH_TIMEOUT`. Unregistering a provider settles its watched change requests as `unavailable`. Polling stops when the last watcher leaves. The [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-forge) lists the defaults.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One timer covers all watched change requests. When it fires, the service groups due change requests by forge and starts one batched provider fetch per idle forge. A listener that throws is logged and skipped. Disposing the service aborts in-flight fetches and waits for them to settle.

| Source | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | Provider registration, URL mapping, watch lifetime, and batched polling |
| [`src/schedule.ts`](src/schedule.ts) | Delay before the next poll of one change request |
| [`src/keys.ts`](src/keys.ts) | Case-insensitive canonical identity of a change request |
| [`src/types.ts`](src/types.ts) | Repository, change request, status, and provider types |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Forge subsystem](../../../docs/subsystems/forge.md) — provider contract, change request types, and service reference.
- [GitHub provider](../forge-github/README.md) — the provider for GitHub hosts.
- [Session bindings](../forge-session/README.md) — the consumer that binds change requests to Sessions.
- [Binding decision](../../../.agents/notes/implemented/feature/2026-10-09-session-change-request-bindings.md) — why bindings derive from shell results and status stays on the host.

-----

<a id="model-experience"></a>
## Model Experience

None, as providers and watchers exchange code host status without contributing model context.

#### KV Cache effect

None. No model request contains data from this package.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Polling only** — status reaches watchers on the next scheduled poll; there is no webhook intake, manual refresh, or provider readiness probe. Missing credentials appear as an `unauthenticated` failure after a fetch.
- **Process-local results** — latest results live in memory and are lost on restart; the next watcher polls again.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

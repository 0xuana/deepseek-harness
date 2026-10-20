---
description: "Serve the experimental forge registry for GitHub hosts through the GitHub CLI on the host."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-forge-github

English | [中文](README.zh.md)

## Summary

Read GitHub and GitHub Enterprise pull requests for `ctx.forge` with the GitHub CLI that is already signed in on the host. One GraphQL query per host and poll reads state, changed lines, checks, review decision, mergeability, and unresolved review threads for every due pull request.

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

Mount the provider after the forge registry and list every GitHub Enterprise host explicitly.

```yaml
- name: '@deepseek-ai/dsh-experimental-forge'
- name: '@deepseek-ai/dsh-experimental-forge-github'
  config:
    hosts: [github.com, ghe.example.com]
```

The provider runs `gh` as a host process, even when Sessions execute commands in another execution world. Sign in once per host with `gh auth login --hostname <host>`. The child receives the host environment without `DSH_*` variables and without variables whose names contain `KEY`, `PASSWORD`, `SECRET`, or `TOKEN`, so `GH_TOKEN` and `GITHUB_TOKEN` are not forwarded and `gh` uses its own credential store. Prompts, update notices, pagers, and colors are disabled. `ghCommand`, `hosts`, `timeoutMs`, and `maxOutputBytes` are listed in the [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-forge-github).

The provider serves a remote URL in `https`, `http`, `ssh`, or `git` form, or in scp form such as `git@github.com:owner/name.git`, when its host is configured. It serves pull request URLs of the form `https://<host>/<owner>/<name>/pull/<number>` with any trailing path, query, or fragment, and builds that form without the suffix as the canonical URL. A readiness probe runs `gh auth status --hostname <host>`: exit status 0 is `ready`, another exit status is `unauthenticated` with the first diagnostic line, and a `gh` that cannot start is `unavailable`. A head lookup returns up to 20 open pull requests whose head is the branch, newest first, excluding pull requests from forks; a lookup of the default branch returns none.

Check runs map to `pending` until completed, then to `success`, `failure` (failure, timed out, startup failure, or action required), `cancelled`, `skipped`, or `neutral`. Check runs keep their start and completion times. Commit status contexts map `SUCCESS` to `success`, `FAILURE` and `ERROR` to `failure`, and every other state to `pending`, and carry no times. A GraphQL `NOT_FOUND` error becomes a `not-found` failure. When `gh` prints no JSON, a diagnostic that mentions authentication or `gh auth login` becomes `unauthenticated` and any other diagnostic becomes `unavailable`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

A fetch groups references by host and sends one `gh api graphql` query per host. The query inlines validated owner, name, and number values and gives each pull request an alias, so partial GraphQL errors fail only their own aliases. `gh` exits nonzero on partial errors but still prints the complete response, which the provider parses before it inspects the exit code.

| Source | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | Configuration validation and provider registration |
| [`src/provider.ts`](src/provider.ts) | URL mapping, host grouping, and failure classification |
| [`src/graphql.ts`](src/graphql.ts) | Query construction and response validation and mapping |
| [`src/gh.ts`](src/gh.ts) | Host `gh` execution with environment scrubbing and limits |
| [`src/urls.ts`](src/urls.ts) | Remote URL and pull request URL parsing |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Forge registry](../forge/README.md) — provider registration and shared polling.
- [Forge subsystem](../../../docs/subsystems/forge.md) — provider contract and change request types.
- [Subprocess environment](../../subprocess/subprocess/README.md) — the shared environment scrub.

-----

<a id="model-experience"></a>
## Model Experience

None, as the provider reads pull request status for host-side watchers without contributing model context.

#### KV Cache effect

None. Provider output reaches only host-side watchers.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **GitHub CLI on the host** — `gh` must be installed and signed in for each configured host; tokens in environment variables are not forwarded. Hosts missing from `hosts` are never read.
- **First 100 checks and review threads** — `checksTruncated` marks a head commit with more checks; unresolved threads after the first 100 are not counted.
- **No fork discovery** — head lookups exclude pull requests whose head is in another repository.
- **Rate limits** — every poll costs one GraphQL query per host against the signed-in account's rate limit.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

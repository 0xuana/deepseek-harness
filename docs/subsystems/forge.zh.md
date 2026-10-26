# Forges

[English](forge.md) | 中文

实验性的 forge 能力 seam 从代码托管平台读取变更请求（change request，即 pull request 与 merge request）。[`dsh-experimental-forge`](../../packages/experimental/forge/README.zh.md) 是 Service Definition，提供 `ctx.forge`；[`dsh-experimental-forge-github`](../../packages/experimental/forge-github/README.zh.md) 是服务 GitHub 主机的 Service Provider；[`dsh-experimental-forge-session`](../../packages/experimental/forge-session/README.zh.md) 是把变更请求绑定到 Session 的 Consumer，提供 `ctx.forgeSession`。三者都只能通过显式组合加载。

## 提供方与变更请求

一个提供方服务一个 forge 家族，例如 `github`。它把 Git 远端 URL 映射为仓库，把变更请求 URL 映射为引用，构造规范的变更请求 URL，按 head 分支查找打开状态的变更请求，并批量读取状态。`changeRequestKey` 从引用派生一个不区分大小写的键，因此 URL 拼写不同的监听方共享同一个轮询循环。

```ts type-equiv
/** One repository on a code host, identified the way its provider addresses it. */
interface ForgeRepository {
  /** Provider family that serves the repository, such as `github`. */
  readonly forge: string
  /** Lowercase host name, such as `github.com`. */
  readonly host: string
  /** Owner or namespace path as the host spells it. */
  readonly owner: string
  /** Repository name as the host spells it. */
  readonly name: string
}
```

```ts type-equiv
/** One change request (pull request or merge request) in a repository. */
interface ChangeRequestRef {
  /** Repository that holds the change request. */
  readonly repository: ForgeRepository
  /** Host-assigned change request number. */
  readonly number: number
}
```

```ts type-equiv
/** Canonical identity of a change request across providers; built by `changeRequestKey`. */
type ChangeRequestKey = Branded<'ChangeRequestKey'>
```

```ts type-equiv
/**
 * Host-specific access registered with `ctx.forge`. One provider serves one
 * forge family; methods that take a signal must stop work when it aborts.
 */
interface ForgeProvider {
  /** Forge family name stored in every repository this provider returns. */
  readonly forge: string
  /** Map a Git remote URL to its repository, or undefined when this provider does not serve it. */
  repositoryFromRemote(url: string): ForgeRepository | undefined
  /** Map a change request web URL to its reference, or undefined when this provider does not serve it. */
  changeRequestFromUrl(url: string): ChangeRequestRef | undefined
  /** Build the canonical web URL of a change request this provider serves. */
  changeRequestUrl(ref: ChangeRequestRef): string
  /** Read the status of several change requests, returning one result per requested key. */
  fetch(
    refs: readonly ChangeRequestRef[],
    signal: AbortSignal,
  ): Promise<ReadonlyMap<ChangeRequestKey, ChangeRequestSnapshot | ForgeFailure>>
  /** Find open change requests whose head is `branch` in `repository`, excluding the default branch and forks. */
  findByHead(repository: ForgeRepository, branch: string, signal: AbortSignal): Promise<readonly ChangeRequestRef[]>
}
```

## 状态轮询

`ctx.forge.watch` 让同一变更请求的所有监听方共享一个轮询循环，并把每次结果作为更新送达。每个 forge 同时最多只有一次读取在进行。轮询节奏、退避与超时规则见[注册表 README](../../packages/experimental/forge/README.zh.md#use-this-package)。

```ts type-equiv
/** Lifecycle state of a change request. */
type ChangeRequestState = 'open' | 'closed' | 'merged'
```

```ts type-equiv
/** Normalized outcome of one status check. */
type CheckState = 'pending' | 'success' | 'failure' | 'neutral' | 'skipped' | 'cancelled'
```

```ts type-equiv
/** One status check reported for the head commit of a change request. */
interface ChangeRequestCheck {
  /** Check name as the host displays it. */
  readonly name: string
  /** Normalized check outcome. */
  readonly state: CheckState
  /** Web page for the check, or null when the host reports none. */
  readonly url: string | null
  /** Workflow that produced the check, or null when the host reports none. */
  readonly workflow: string | null
}
```

```ts type-equiv
/** Combined outcome of all checks on the head commit. */
type ChecksRollup = 'none' | 'pending' | 'success' | 'failure'
```

```ts type-equiv
/** Whether the change request can merge into its base without conflicts. */
type Mergeability = 'mergeable' | 'conflicting' | 'unknown'
```

```ts type-equiv
/** Aggregate review outcome required by the host's merge rules. */
type ReviewDecision = 'approved' | 'changes-requested' | 'review-required' | 'none'
```

```ts type-equiv
/** Why a provider could not read a change request. */
interface ForgeFailure {
  /** `not-found`: the host does not expose it; `unauthenticated`: credentials are missing or rejected; `unavailable`: any other failure. */
  readonly code: 'not-found' | 'unauthenticated' | 'unavailable'
  /** Human-readable cause. */
  readonly message: string
}
```

```ts type-equiv
/** Status of one change request at the time its provider read it. */
interface ChangeRequestSnapshot {
  /** Change request the snapshot describes. */
  readonly ref: ChangeRequestRef
  /** Web page of the change request. */
  readonly url: string
  /** Title as the author wrote it. */
  readonly title: string
  /** Lifecycle state. */
  readonly state: ChangeRequestState
  /** Whether the author marked the change request as a draft. */
  readonly draft: boolean
  /** Author login, or null when the host hides it. */
  readonly author: string | null
  /** Branch that carries the proposed commits. */
  readonly headBranch: string
  /** Commit object name at the head of the change request. */
  readonly headSha: string
  /** Branch the change request merges into. */
  readonly baseBranch: string
  /** Merge conflict status; `unknown` while the host computes it. */
  readonly mergeability: Mergeability
  /** Aggregate review outcome. */
  readonly reviewDecision: ReviewDecision
  /** Checks on the head commit in host order. */
  readonly checks: readonly ChangeRequestCheck[]
  /** Combined check outcome. */
  readonly checksRollup: ChecksRollup
  /** Whether the host reported more checks than `checks` contains. */
  readonly checksTruncated: boolean
  /** Number of review threads that are not resolved. */
  readonly unresolvedThreads: number
  /** ISO 8601 time of the host's last update to the change request. */
  readonly updatedAt: string
}
```

```ts type-equiv
/** Latest polling result delivered to watchers of one change request. */
type ChangeRequestUpdate = {
  /** Canonical identity of the watched change request. */
  readonly key: ChangeRequestKey
  /** Epoch milliseconds when the result settled. */
  readonly fetchedAt: number
} & ({
  /** Status read from the host. */
  readonly snapshot: ChangeRequestSnapshot
} | {
  /** Reason the status could not be read. */
  readonly failure: ForgeFailure
})
```

```ts type-equiv
/**
 * Receives every polling result for one watched change request.
 * @param update - the settled result.
 */
type ChangeRequestListener = (update: ChangeRequestUpdate) => void
```

## Session 绑定

`ctx.forgeSession` 从每个 Session 自己的日志派生其绑定：`gh pr create` 的结果绑定其输出的 URL，`git push` 的结果通过 `ctx.forge` 触发按 head 分支的发现。track、dismiss 与发现操作都是 `plugin:forge-session/binding` 插件记录，位于模型可见对话之外。识别与发现规则见 [Session 绑定 README](../../packages/experimental/forge-session/README.zh.md#use-this-package)。

```ts type-equiv
/**
 * How a change request became bound to a Session: `created` when a
 * `gh pr create` result printed its URL, `discovered` when a lookup after a
 * `git push` found it for the pushed branch, `tracked` when a caller bound it
 * by URL.
 */
type BindingOrigin = 'created' | 'discovered' | 'tracked'
```

```ts type-equiv
/** Payload of the `plugin:forge-session/binding` record. */
interface BindingRecord {
  /** `track` binds or restores, `dismiss` hides, `discover` binds a change request found for a pushed branch. */
  readonly action: 'track' | 'dismiss' | 'discover'
  /** Web URL of the change request. */
  readonly url: string
}
```

```ts type-equiv
/** One change request bound to a Session and not dismissed, with its latest polling result. */
interface SessionChangeRequest {
  /** Web URL as first recorded. */
  readonly url: string
  /** How the change request became bound. */
  readonly origin: BindingOrigin
  /** Parsed reference, or null when no registered provider serves the URL. */
  readonly ref: ChangeRequestRef | null
  /** Latest polling result, or null before the first poll and without a provider. */
  readonly update: ChangeRequestUpdate | null
}
```

```ts type-equiv
/**
 * Receives the complete visible list after a binding change or a polling result.
 * @param changeRequests - every visible binding of the watched Session, in first-recorded order.
 */
type SessionChangeRequestsListener = (changeRequests: readonly SessionChangeRequest[]) => void
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxforge--forgeservice"></a>

### `ctx.forge` — `ForgeService`

Registry of forge providers. Watchers of one change request share a single polling loop; each forge has at most one fetch in flight, which batches every due change request of that forge.

```ts cordis-catalog
/**
 * Register the provider of one forge family as an effect on the calling
 * fiber. Watches of that forge receive an `unavailable` failure when the
 * registration ends. Unregistering cancels and awaits its in-flight calls;
 * results from the withdrawn registration are discarded.
 * @param provider - provider to serve `provider.forge`.
 * @returns the disposer that unregisters the provider and waits for its calls to finish.
 * @throws when another provider already serves the same forge.
 */
register(provider: ForgeProvider): () => Promise<void>

/**
 * Map a Git remote URL to a repository through the first provider that serves it.
 * @param url - fetch or push URL as Git reports it.
 * @returns the repository, or undefined when no provider serves the URL.
 */
repositoryFromRemote(url: string): ForgeRepository | undefined

/**
 * Map a change request web URL through the first provider that serves it.
 * @param url - web URL of a pull or merge request.
 * @returns the change request, or undefined when no provider serves the URL.
 */
changeRequestFromUrl(url: string): ChangeRequestRef | undefined

/**
 * Build the canonical web URL of a change request.
 * @param ref - change request served by a registered provider.
 * @returns the provider's canonical URL.
 * @throws when no provider serves the change request's forge.
 */
changeRequestUrl(ref: ChangeRequestRef): string

/**
 * Find open change requests whose head is `branch`, excluding the default branch and forks.
 * @param repository - repository served by a registered provider.
 * @param branch - head branch name on the host.
 * @param signal - cancellation for the lookup.
 * @returns matching change requests, newest first as the provider reports them.
 * @throws when no provider serves the repository's forge or the lookup fails.
 */
async findByHead(repository: ForgeRepository, branch: string, signal: AbortSignal): Promise<readonly ChangeRequestRef[]>

/**
 * Watch one change request as an effect on the calling fiber. The first
 * watcher starts polling at once; listeners receive every later result,
 * and `latest` returns the current one. Polling stops when the last watcher
 * leaves. Listeners must not throw; a thrown error is logged and skipped.
 * @param ref - change request to poll.
 * @param listener - receives each polling result.
 * @returns the disposer that stops this watch.
 */
watch(ref: ChangeRequestRef, listener: ChangeRequestListener): () => void

/**
 * Read the latest polling result of a watched change request.
 * @param ref - change request to read.
 * @returns the latest result, or undefined before the first result or without a watch.
 */
latest(ref: ChangeRequestRef): ChangeRequestUpdate | undefined
```

Source: [`packages/experimental/forge/src/index.ts`](../../packages/experimental/forge/src/index.ts)

<a id="ctxforgesession--forgesessionservice"></a>

### `ctx.forgeSession` — `ForgeSessionService`

Session-scoped change request bindings. The `forgeChangeRequests` projection derives them from `gh pr create` and `git push` results and from `plugin:forge-session/binding` records. After each push result the service looks up open change requests whose head is a pushed branch and records the unbound ones as discovered. Watching a Session polls its visible change requests through `ctx.forge`.

```ts cordis-catalog
/**
 * List the change requests bound to a Session and not dismissed.
 * @param session - Session whose bindings are read.
 * @returns visible bindings in first-recorded order, each with its latest polling result.
 */
changeRequests(session: Session): SessionChangeRequest[]

/**
 * Bind a change request to a Session by URL, or restore a dismissed binding.
 * Appends a `track` record with the provider's canonical URL unless the
 * change request is already visible.
 * @param session - Session that receives the binding.
 * @param url - web URL of the change request.
 * @throws when no registered provider recognizes the URL.
 */
track(session: Session, url: string): void

/**
 * Hide a visible binding. Appends a `dismiss` record; a URL that is not
 * visibly bound leaves the log unchanged. Discovery never restores a
 * dismissed binding; `track` does.
 * @param session - Session that owns the binding.
 * @param url - web URL of the change request.
 */
dismiss(session: Session, url: string): void

/**
 * Watch a Session's visible change requests as an effect on the calling
 * fiber. Every visible change request that a provider recognizes is polled
 * through `ctx.forge` while the Session has a watcher. Listeners receive the
 * complete list after each later binding change or polling result; read the
 * current list with {@link changeRequests}. Listeners must not throw; a
 * thrown error is logged and skipped.
 * @param session - Session to watch.
 * @param listener - receives the complete visible list.
 * @returns the disposer that stops this watch.
 */
watch(session: Session, listener: SessionChangeRequestsListener): () => void
```

Types: [Session](session.zh.md)

Source: [`packages/experimental/forge-session/src/index.ts`](../../packages/experimental/forge-session/src/index.ts)
<!-- END GENERATED cordis-surface -->

# Forges

English | [中文](forge.zh.md)

The experimental forge capability seam reads change requests, meaning pull requests and merge requests, from code hosts. [`dsh-experimental-forge`](../../packages/experimental/forge/README.md) is the Service Definition and provides `ctx.forge`; [`dsh-experimental-forge-github`](../../packages/experimental/forge-github/README.md) is the Service Provider for GitHub hosts; [`dsh-experimental-forge-session`](../../packages/experimental/forge-session/README.md) is the Consumer that binds change requests to Sessions and provides `ctx.forgeSession`; [`dsh-experimental-client-ui-forge`](../../packages/experimental/client-ui-forge/README.md) is the GUI Consumer that provides `ctx.forgePanel`. The default-disabled [forge bundle](../../packages/experimental/forge-bundle/README.md) composes all four, with an isolated [worktree service](../../packages/experimental/worktree/README.md) for the panel, from the Plugins page; otherwise they load only through explicit composition.

## Providers and change requests

A provider serves one forge family, such as `github`. It maps Git remote URLs to repositories and change request URLs to references, builds canonical change request URLs, finds open change requests by head branch, and reads status in batches. `changeRequestKey` derives one case-insensitive key from a reference, so watchers of differently spelled URLs share one polling loop.

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
  /** Report whether the provider can reach `host` with current credentials. */
  readiness(host: string, signal: AbortSignal): Promise<ForgeReadiness>
}
```

```ts type-equiv
/** Whether a provider can reach one host with the current credentials. */
interface ForgeReadiness {
  /** `ready`, `unauthenticated` (sign-in needed), or `unavailable` (tool missing or host unreachable). */
  readonly state: 'ready' | 'unauthenticated' | 'unavailable'
  /** Human-readable detail, or null when ready. */
  readonly message: string | null
}
```

## Status polling

`ctx.forge.watch` shares one polling loop among the watchers of a change request and delivers every result as an update. Each forge has at most one fetch in flight. The [registry README](../../packages/experimental/forge/README.md#use-this-package) owns the poll cadence, backoff, and timeout rules.

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
  /** Lines the change request adds. */
  readonly additions: number
  /** Lines the change request deletes. */
  readonly deletions: number
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
  /** ISO 8601 time the change request was merged or closed, or null while it is open. */
  readonly closedAt: string | null
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

## Session bindings

`ctx.forgeSession` derives each Session's bindings from its own log: `gh pr create` results bind the URLs they print, and `git push` results trigger head-branch discovery through `ctx.forge`. Track, dismiss, and discovery actions are `plugin:forge-session/binding` records, which stay outside the model-visible conversation. The `forgeChangeRequests` projection stays on the Host. The [Session binding README](../../packages/experimental/forge-session/README.md#use-this-package) owns the recognition and discovery rules.

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

## Panel

`ctx.forgePanel` is the Host Remote of the [forge panel](../../packages/experimental/client-ui-forge/README.md#use-this-package). Following a Session streams a `ForgePanelState`: a read-only Git inspection of the Session's current directory in its execution world, the code host recognized from the upstream remote or `origin`, the sign-in state of that host, the Session's bindings with their polled status and last snapshot, and its worktree request. Its actions list base branches, bind and hide URLs, refresh, request or withdraw a worktree, stop a running creation, and restore a removed worktree or leave it for the source checkout. A request is a `plugin:client-ui-forge/worktree` record. The panel listens to [Agent admission](../../packages/core/agent/README.md): it holds the first message of a Session with an open request while it creates the worktree through `ctx.worktrees`, refuses messages while the worktree the Session works in is gone, and keeps the last failed creation in the panel state. Each refusal carries a `ForgeAdmissionRefusal` reason, and the panel presents it while it follows the Session. The first step proposal creates the worktree for a message that entered without admission. Requests after the first turn starts are ignored. Changes to a Session's checkout run as maintenance of its Agent, so a message from another client waits for them.

```ts type-equiv
/** Git facts for the checkout that contains the Session's current directory. */
interface ForgeCheckout {
  /** Top-level directory of the checkout. */
  readonly root: string
  /** Checked-out branch, or null when HEAD is detached. */
  readonly branch: string | null
  /** Whether the checkout is a linked worktree of another checkout's repository. */
  readonly linked: boolean
  /** Abbreviated commit HEAD names, or null while the checked-out branch has no commit. */
  readonly commit: string | null
}
```

```ts type-equiv
/** Inspection result for the Session's current directory. */
type ForgeCheckoutState =
  /** The first inspection has not finished. */
  | { readonly state: 'pending' }
  /** The current directory is not inside a Git checkout. */
  | { readonly state: 'none' }
  /** Git could not run or reported an error. */
  | { readonly state: 'failed'; readonly message: string }
  /** The checkout facts. */
  | { readonly state: 'ready'; readonly checkout: ForgeCheckout }
```

```ts type-equiv
/** The worktree the panel created and entered for a Session before its first step. */
interface ForgeSessionWorktree {
  /** Canonical checkout directory. */
  readonly path: string
  /** Branch created for the checkout. */
  readonly branch: string
  /** Requested base branch, or null when the checkout started from HEAD of the source checkout. */
  readonly from: string | null
  /** Commit object name the branch started from. */
  readonly baseCommit: string
  /** Canonical root of the source checkout. */
  readonly repositoryRoot: string
}
```

```ts type-equiv
/** Payload of the `plugin:client-ui-forge/worktree` record. */
type WorktreeRecord =
  /** Create a worktree before the Session's first step, starting from `from`, or from HEAD when it is null. */
  | { readonly action: 'request'; readonly from: string | null }
  /** Withdraw the open request. */
  | { readonly action: 'cancel' }
  /** The requested worktree was created and became the Session's working directory. */
  | { readonly action: 'created'; readonly worktree: ForgeSessionWorktree }
```

```ts type-equiv
/** Why the Session's checkout cannot host a new worktree. */
type ForgeWorktreeBlocker =
  /** The current directory is not inside a Git checkout. */
  | 'not-git'
  /** The Session's sandbox cannot write the checkout or its Git directory, as for a linked worktree outside the writable root. */
  | 'outside-writable-root'
  /** The Session runs read-only. */
  | 'read-only'
```

```ts type-equiv
/** One running worktree creation. */
interface ForgeWorktreeCreation {
  /** Running step: `prepare` validates and creates the branch, then `checkout` writes the files. */
  readonly phase: 'prepare' | 'checkout'
  /** Branch the attempt creates. */
  readonly branch: string
  /** Base branch, or null for HEAD. */
  readonly from: string | null
  /**
   * Whether a message waits for the creation before it enters the Session.
   * Only such a creation can be stopped, which returns the message to its
   * sender; a creation at the first step serves a message the Session already holds.
   */
  readonly held: boolean
}
```

```ts type-equiv
/** The last attempt to create the requested worktree for a message, which failed. */
interface ForgeWorktreeFailure {
  /** Branch the attempt created, or null when it failed before naming one. */
  readonly branch: string | null
  /** Base branch of the attempt, or null for HEAD. */
  readonly from: string | null
  /** Step that failed. */
  readonly phase: 'prepare' | 'checkout'
  /** Failure text. */
  readonly message: string
}
```

```ts type-equiv
/**
 * Why the panel refuses a message at Agent admission; the refusal reason a
 * `session/prompt-rejected` error carries. The panel shows each refusal itself
 * while it follows the Session.
 */
type ForgeAdmissionRefusal =
  /** The requested worktree could not be created; the panel state carries the failure. */
  | 'forge/worktree-creation-failed'
  /** The creation the message waited for was stopped. */
  | 'forge/worktree-creation-stopped'
  /** The worktree the Session works in was removed. */
  | 'forge/worktree-missing'
```

```ts type-equiv
/** The worktree a Session works in, whose directory no longer exists. */
interface ForgeMissingWorktree {
  /** Whether the worktree's branch still exists; restoring creates a missing branch again at its base commit. */
  readonly branchExists: boolean
}
```

```ts type-equiv
/** Worktree facts of one Session in the panel state. */
interface ForgePanelWorktree {
  /**
   * Whether the Session can still request or withdraw a worktree: a worktree
   * service is mounted, no turn has started, and none was created.
   */
  readonly editable: boolean
  /** Why the checkout cannot host a worktree, or null when it can, before the first inspection, and after a failed one. */
  readonly blocker: ForgeWorktreeBlocker | null
  /** Open request, or null without one. */
  readonly request: ForgeWorktreeRequest | null
  /** Created worktree, or null before creation. */
  readonly created: ForgeSessionWorktree | null
  /** Running creation, or null. */
  readonly creation: ForgeWorktreeCreation | null
  /**
   * The failed attempt that returned the last message to its sender, or null.
   * It clears when another attempt starts and when the request changes or is withdrawn.
   */
  readonly failure: ForgeWorktreeFailure | null
  /** The created worktree the Session works in when its directory is gone, or null. */
  readonly missing: ForgeMissingWorktree | null
}
```

```ts type-equiv
/** One bound change request in the panel state. */
interface ForgePanelChangeRequest extends SessionChangeRequest {
  /** Latest snapshot a poll returned, kept while later polls fail, or null before the first successful poll. */
  readonly snapshot: ChangeRequestSnapshot | null
}
```

```ts type-equiv
/** Everything the panel shows for one Session. */
interface ForgePanelState {
  /** Current working directory of the Session. */
  readonly directory: string
  /** Inspection result for `directory`. */
  readonly checkout: ForgeCheckoutState
  /** Code host repository of the checkout's upstream remote or `origin`, or null when no provider serves them. */
  readonly repository: ForgeRepository | null
  /** Sign-in state for the repository's host, or null before the first probe and without a repository. */
  readonly readiness: ForgeReadiness | null
  /** Visible change request bindings with their latest polling results, in first-recorded order. */
  readonly changeRequests: readonly ForgePanelChangeRequest[]
  /** Worktree request and creation state. */
  readonly worktree: ForgePanelWorktree
}
```

```ts type-equiv
/** Local branches offered as the base of a new worktree. */
interface ForgeBranches {
  /** Checked-out branch, or null when HEAD is detached. */
  readonly current: string | null
  /** Local branch names, `current` first and then most recently committed first, at most `maxBranches`. */
  readonly branches: readonly string[]
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxforge--forgeservice"></a>

### `ctx.forge` — `ForgeService`

Registry of forge providers. Watchers of one change request share a single polling loop; each forge has at most one fetch in flight, which batches every due change request of that forge.

```ts cordis-catalog
/**
 * Register the provider of one forge family as an effect on the calling
 * fiber. Watches of that forge receive an `unavailable` failure when the
 * registration ends.
 * @param provider - provider to serve `provider.forge`.
 * @returns the disposer that unregisters the provider.
 * @throws when another provider already serves the same forge.
 */
register(provider: ForgeProvider): () => void

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
 * Report whether the provider can reach the repository's host with current credentials.
 * @param repository - repository served by a registered provider.
 * @param signal - cancellation for the probe.
 * @returns the provider's readiness for the host.
 * @throws when no provider serves the repository's forge.
 */
async readiness(repository: ForgeRepository, signal: AbortSignal): Promise<ForgeReadiness>

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
 * Poll a watched change request at once, including after a terminal state.
 * A fetch already in flight for its forge serves the request; an unwatched
 * change request is unchanged.
 * @param ref - change request to poll.
 */
refresh(ref: ChangeRequestRef): void

/**
 * Read the latest polling result of a watched change request.
 * @param ref - change request to read.
 * @returns the latest result, or undefined before the first result or without a watch.
 */
latest(ref: ChangeRequestRef): ChangeRequestUpdate | undefined
```

Source: [`packages/experimental/forge/src/index.ts`](../../packages/experimental/forge/src/index.ts)

<a id="ctxforgepanel--forgepanelcontroller"></a>

### `ctx.forgePanel` — `ForgePanelController`

Serves the forge panel. Following a Session inspects the checkout of its current directory read-only in the Session's execution world, recognizes the code host of the upstream remote or `origin`, probes sign-in for that host, and polls the Session's bound change requests through `ctx.forge` until the last follower of that Session leaves. A worktree request makes the panel create a branch and checkout through an optional `ctx.worktrees` and enter it: at Agent admission of the Session's first message, which waits for the worktree, or at the first step proposal of a message that entered without admission. A failed or stopped creation returns the message to its sender. Admission also refuses messages while the worktree the Session works in is gone; that worktree can be checked out again or left for the source checkout. Changes to a Session's checkout run as Agent maintenance, so a message that arrives meanwhile waits for them.

```ts cordis-catalog
/**
 * Stream the panel state of a Session: the current state first, then each
 * later state. Intermediate states may be skipped when the reader is slower
 * than the updates. The stream ends when `signal` aborts or the Remote stops.
 * @param session - Session to follow.
 * @param signal - ends the stream.
 * @returns panel states in publication order.
 */
@Remote({ mode: 'stream' }) async *follow(session: Session, signal: AbortSignal): AsyncIterable<ForgePanelState>

/**
 * List the local branches that can start a worktree of the Session's current checkout.
 * @param session - Session whose current directory is listed.
 * @param signal - request cancellation.
 * @returns the checked-out branch and at most `maxBranches` local branches, the checked-out one first.
 * @throws when the current directory is not inside a checkout or Git fails.
 */
@Remote async branches(session: Session, signal: AbortSignal): Promise<ForgeBranches>

/**
 * Bind a change request to a Session by URL, or restore a dismissed binding.
 * @param session - Session that receives the binding.
 * @param url - web URL of the change request.
 * @param signal - request cancellation.
 * @throws `forgePanel/unrecognized-url` when no registered provider serves the URL.
 */
@Remote async track(session: Session, url: string, signal: AbortSignal): Promise<void>

/**
 * Hide a visible binding of a Session; other URLs leave the Session unchanged.
 * @param session - Session that owns the binding.
 * @param url - web URL of the change request.
 * @param signal - request cancellation.
 */
@Remote async dismiss(session: Session, url: string, signal: AbortSignal): Promise<void>

/**
 * Reinspect a followed Session's checkout, probe sign-in again, and poll its
 * change requests at once; an unfollowed Session is unchanged.
 * @param session - Session whose panel refreshes.
 * @param signal - request cancellation.
 */
@Remote async refresh(session: Session, signal: AbortSignal): Promise<void>

/**
 * Ask for a new worktree before the Session's first turn, replacing an open
 * request and forgetting a failed attempt. Admission of the next message, or
 * else the first step proposal, creates a branch from `from`, or from HEAD of
 * the current checkout when it is null, and enters its checkout.
 * @param session - Session without a started turn.
 * @param from - local base branch, or null for HEAD.
 * @param signal - request cancellation.
 * @throws `forgePanel/invalid-branch` when `from` is empty; `forgePanel/worktrees-unavailable`
 * without a worktree service; `forgePanel/session-started` after a turn started or the worktree was
 * created; `forgePanel/session-busy` while the worktree is being created.
 */
@Remote async requestWorktree(session: Session, from: string | null, signal: AbortSignal): Promise<void>

/**
 * Withdraw the open worktree request of a Session with its failed attempt; without a request the Session is unchanged.
 * @param session - Session without a started turn.
 * @param signal - request cancellation.
 * @throws `forgePanel/worktrees-unavailable` without a worktree service; `forgePanel/session-started`
 * after a turn started or the worktree was created; `forgePanel/session-busy` while the worktree is
 * being created.
 */
@Remote async cancelWorktree(session: Session, signal: AbortSignal): Promise<void>

/**
 * Stop the creation that holds a message of the Session at admission; the
 * message goes back to its sender and the request stays open. Without such a
 * creation the Session is unchanged.
 * @param session - Session whose creation stops.
 * @param signal - request cancellation.
 */
@Remote async stopCreation(session: Session, signal: AbortSignal): Promise<void>

/**
 * Check out the created worktree of a Session again at its recorded
 * directory when that directory is gone: its branch when the branch still
 * exists, otherwise a new branch of the same name at the base commit. Changes
 * that were never committed are not recovered. Runs as Agent maintenance;
 * without a missing directory the Session is unchanged.
 * @param session - Session whose worktree directory is gone.
 * @param signal - request cancellation, which aborts the restoration.
 * @throws `forgePanel/no-worktree` without a created worktree; `forgePanel/worktrees-unavailable`
 * without a worktree service; `forgePanel/session-busy` while the Session's Agent is not loaded or
 * has other work; `forgePanel/restore-failed` when Git fails.
 */
@Remote async restoreWorktree(session: Session, signal: AbortSignal): Promise<void>

/**
 * Move a Session from its created worktree to the source checkout the
 * worktree came from; the Session no longer works in the worktree. Runs as
 * Agent maintenance.
 * @param session - Session with a created worktree.
 * @param signal - request cancellation.
 * @throws `forgePanel/no-worktree` without a created worktree; `forgePanel/session-busy` while the
 * Session's Agent is not loaded or has other work; the working-directory service's error when the
 * source checkout no longer exists.
 */
@Remote async continueInProject(session: Session, signal: AbortSignal): Promise<void>
```

Types: [Session](session.md)

Source: [`packages/experimental/client-ui-forge/src/index.ts`](../../packages/experimental/client-ui-forge/src/index.ts)

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

Types: [Session](session.md)

Source: [`packages/experimental/forge-session/src/index.ts`](../../packages/experimental/forge-session/src/index.ts)
<!-- END GENERATED cordis-surface -->

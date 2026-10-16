/** Browser-safe panel state, the worktree request record, Remote error codes, and Host configuration of the forge panel. */

import type {} from '@deepseek-ai/dsh-typert-protocol'
import type { ChangeRequestSnapshot, ForgeReadiness, ForgeRepository } from '@deepseek-ai/dsh-experimental-forge/types'
import type { SessionChangeRequest } from '@deepseek-ai/dsh-experimental-forge-session/types'

/** Git facts for the checkout that contains the Session's current directory. */
export interface ForgeCheckout {
  /** Top-level directory of the checkout. */
  readonly root: string
  /** Checked-out branch, or null when HEAD is detached. */
  readonly branch: string | null
}

/** Inspection result for the Session's current directory. */
export type ForgeCheckoutState =
  /** The first inspection has not finished. */
  | { readonly state: 'pending' }
  /** The current directory is not inside a Git checkout. */
  | { readonly state: 'none' }
  /** Git could not run or reported an error. */
  | { readonly state: 'failed'; readonly message: string }
  /** The checkout facts. */
  | { readonly state: 'ready'; readonly checkout: ForgeCheckout }

/** The worktree the panel created and entered for a Session before its first step. */
export interface ForgeSessionWorktree {
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

/** Payload of the `plugin:client-ui-forge/worktree` record. */
export type WorktreeRecord =
  /** Create a worktree before the Session's first step, starting from `from`, or from HEAD when it is null. */
  | { readonly action: 'request'; readonly from: string | null }
  /** Withdraw the open request. */
  | { readonly action: 'cancel' }
  /** The requested worktree was created and became the Session's working directory. */
  | { readonly action: 'created'; readonly worktree: ForgeSessionWorktree }

/** One open worktree request. */
export interface ForgeWorktreeRequest {
  /** Base branch, or null for HEAD of the source checkout. */
  readonly from: string | null
}

/** Host-only state of the `forgeWorktree` projection. */
export interface ForgeWorktreeState {
  /** Open request, or null without one. */
  readonly request: ForgeWorktreeRequest | null
  /** Created worktree, or null before creation. */
  readonly created: ForgeSessionWorktree | null
  /** Whether a turn has started; requests and withdrawals recorded afterwards are ignored. */
  readonly locked: boolean
  /** Whether a step has started; no worktree is created afterwards. */
  readonly stepped: boolean
}

/** Why the Session's checkout cannot host a new worktree. */
export type ForgeWorktreeBlocker =
  /** The current directory is not inside a Git checkout. */
  | 'not-git'
  /** The Session's sandbox cannot write the checkout or its Git directory, as for a linked worktree outside the writable root. */
  | 'outside-writable-root'
  /** The Session runs read-only. */
  | 'read-only'

/** One running worktree creation. */
export interface ForgeWorktreeCreation {
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

/** The last attempt to create the requested worktree for a message, which failed. */
export interface ForgeWorktreeFailure {
  /** Branch the attempt created, or null when it failed before naming one. */
  readonly branch: string | null
  /** Base branch of the attempt, or null for HEAD. */
  readonly from: string | null
  /** Step that failed. */
  readonly phase: 'prepare' | 'checkout'
  /** Failure text. */
  readonly message: string
}

/**
 * Why the panel refuses a message at Agent admission; the refusal reason a
 * `session/prompt-rejected` error carries. The panel shows each refusal itself
 * while it follows the Session.
 */
export type ForgeAdmissionRefusal =
  /** The requested worktree could not be created; the panel state carries the failure. */
  | 'forge/worktree-creation-failed'
  /** The creation the message waited for was stopped. */
  | 'forge/worktree-creation-stopped'
  /** The worktree the Session works in was removed. */
  | 'forge/worktree-missing'

/** The worktree a Session works in, whose directory no longer exists. */
export interface ForgeMissingWorktree {
  /** Whether the worktree's branch still exists; restoring creates a missing branch again at its base commit. */
  readonly branchExists: boolean
}

/** Worktree facts of one Session in the panel state. */
export interface ForgePanelWorktree {
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

/** One bound change request in the panel state. */
export interface ForgePanelChangeRequest extends SessionChangeRequest {
  /** Latest snapshot a poll returned, kept while later polls fail, or null before the first successful poll. */
  readonly snapshot: ChangeRequestSnapshot | null
}

/** Everything the panel shows for one Session. */
export interface ForgePanelState {
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

/** Local branches offered as the base of a new worktree. */
export interface ForgeBranches {
  /** Checked-out branch, or null when HEAD is detached. */
  readonly current: string | null
  /** Local branch names, `current` first and then most recently committed first, at most `maxBranches`. */
  readonly branches: readonly string[]
}

/** Host settings of the forge panel Remote. */
export interface Config {
  /** Git executable name or absolute path in the Session's execution world. */
  gitCommand?: string
  /** Deadline in milliseconds for one Git command, including confinement. */
  gitTimeoutMs?: number
  /** Termination grace period in milliseconds for each Git process. */
  graceMs?: number
  /** Maximum captured bytes per Git output stream. */
  maxOutputBytes?: number
  /** Deadline in milliseconds for one provider sign-in probe. */
  readinessTimeoutMs?: number
  /** Most local branches listed as worktree bases. */
  maxBranches?: number
  /**
   * Prefix of the branch and checkout directory created for a Session worktree; the first eight
   * hexadecimal digits of the Session id's UUID, a hyphen, and four random hexadecimal digits follow it.
   */
  worktreePrefix?: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No registered provider serves the change request URL. */
    'forgePanel/unrecognized-url': Record<string, never>
    /** A turn of the Session has started, or its worktree was created, so its worktree request can no longer change. */
    'forgePanel/session-started': Record<string, never>
    /** No worktree service is mounted. */
    'forgePanel/worktrees-unavailable': Record<string, never>
    /** The requested base branch name is empty. */
    'forgePanel/invalid-branch': Record<string, never>
    /** The Session has no created worktree to restore or leave. */
    'forgePanel/no-worktree': Record<string, never>
    /** The Session's Agent is not loaded or has other work, so its checkout cannot change now. */
    'forgePanel/session-busy': Record<string, never>
    /** The removed worktree could not be checked out again; the message gives the reason. */
    'forgePanel/restore-failed': Record<string, never>
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** A request, withdrawal, or creation of the worktree a Session starts in. */
    'plugin:client-ui-forge/worktree': WorktreeRecord
  }
}

/** Provider-neutral vocabulary for code hosts, their change requests, and provider contracts. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** One repository on a code host, identified the way its provider addresses it. */
export interface ForgeRepository {
  /** Provider family that serves the repository, such as `github`. */
  readonly forge: string
  /** Lowercase host name, such as `github.com`. */
  readonly host: string
  /** Owner or namespace path as the host spells it. */
  readonly owner: string
  /** Repository name as the host spells it. */
  readonly name: string
}

/** One change request (pull request or merge request) in a repository. */
export interface ChangeRequestRef {
  /** Repository that holds the change request. */
  readonly repository: ForgeRepository
  /** Host-assigned change request number. */
  readonly number: number
}

/** Canonical identity of a change request across providers; built by `changeRequestKey`. */
export type ChangeRequestKey = Branded<'ChangeRequestKey'>

/** Lifecycle state of a change request. */
export type ChangeRequestState = 'open' | 'closed' | 'merged'

/** Normalized outcome of one status check. */
export type CheckState = 'pending' | 'success' | 'failure' | 'neutral' | 'skipped' | 'cancelled'

/** One status check reported for the head commit of a change request. */
export interface ChangeRequestCheck {
  /** Check name as the host displays it. */
  readonly name: string
  /** Normalized check outcome. */
  readonly state: CheckState
  /** Web page for the check, or null when the host reports none. */
  readonly url: string | null
  /** Workflow that produced the check, or null when the host reports none. */
  readonly workflow: string | null
}

/** Combined outcome of all checks on the head commit. */
export type ChecksRollup = 'none' | 'pending' | 'success' | 'failure'

/** Whether the change request can merge into its base without conflicts. */
export type Mergeability = 'mergeable' | 'conflicting' | 'unknown'

/** Aggregate review outcome required by the host's merge rules. */
export type ReviewDecision = 'approved' | 'changes-requested' | 'review-required' | 'none'

/** Status of one change request at the time its provider read it. */
export interface ChangeRequestSnapshot {
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

/** Why a provider could not read a change request. */
export interface ForgeFailure {
  /** `not-found`: the host does not expose it; `unauthenticated`: credentials are missing or rejected; `unavailable`: any other failure. */
  readonly code: 'not-found' | 'unauthenticated' | 'unavailable'
  /** Human-readable cause. */
  readonly message: string
}

/** Latest polling result delivered to watchers of one change request. */
export type ChangeRequestUpdate = {
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

/**
 * Host-specific access registered with `ctx.forge`. One provider serves one
 * forge family; methods that take a signal must stop work when it aborts.
 */
export interface ForgeProvider {
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

/**
 * Receives every polling result for one watched change request.
 * @param update - the settled result.
 */
export type ChangeRequestListener = (update: ChangeRequestUpdate) => void

/** Poll cadence and fetch deadline for watched change requests. */
export interface Config {
  /** Poll interval in milliseconds while checks run or mergeability is unknown. */
  activeIntervalMs?: number
  /** Poll interval in milliseconds for an open change request whose checks have settled. */
  idleIntervalMs?: number
  /** Largest delay in milliseconds between polls after consecutive failures. */
  maxBackoffMs?: number
  /** Deadline in milliseconds for one provider fetch. */
  fetchTimeoutMs?: number
}

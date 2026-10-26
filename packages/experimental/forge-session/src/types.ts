/** Session binding vocabulary, the binding plugin record, and the host-only projection state. */

import type { ChangeRequestRef, ChangeRequestUpdate } from '@deepseek-ai/dsh-experimental-forge'
import type { SessionSeq } from '@deepseek-ai/dsh-session'

/**
 * How a change request became bound to a Session: `created` when a
 * `gh pr create` result printed its URL, `discovered` when a lookup after a
 * `git push` found it for the pushed branch, `tracked` when a caller bound it
 * by URL.
 */
export type BindingOrigin = 'created' | 'discovered' | 'tracked'

/** Which binding evidence a shell command can print: change request URLs, pushed refs, or both. */
export type CommandKind = 'create' | 'push' | 'both'

/** Payload of the `plugin:forge-session/binding` record. */
export interface BindingRecord {
  /** `track` binds or restores, `dismiss` hides, `discover` binds a change request found for a pushed branch. */
  readonly action: 'track' | 'dismiss' | 'discover'
  /** Web URL of the change request. */
  readonly url: string
}

/** One shell call whose result the projection still awaits. */
export interface PendingCommand {
  /** Tool call id that pairs the call with its result. */
  readonly callId: string
  /** Evidence the result may carry. */
  readonly kind: CommandKind
}

/** One change request remembered by the projection, including hidden ones. */
export interface BindingState {
  /** Web URL as first recorded. */
  readonly url: string
  /** How the change request became bound. */
  readonly origin: BindingOrigin
  /** Whether a dismissal hides the binding. */
  readonly dismissed: boolean
}

/** One branch that a `git push` result reported as updated on a remote. */
export interface PushedBranch {
  /** Remote as `git push` printed it after `To`. */
  readonly remote: string
  /** Branch name on the remote. */
  readonly branch: string
  /** Sequence number of the latest `tool/result` event that reported this branch. */
  readonly seq: SessionSeq
}

/** Host-only projection state folded from shell results and binding records. */
export interface ForgeChangeRequestsState {
  /** Shell calls awaiting their result, in call order. */
  readonly pending: readonly PendingCommand[]
  /** Bound change requests in first-recorded order. */
  readonly bindings: readonly BindingState[]
  /** Pushed branches, one entry per remote and branch, ordered by latest push. */
  readonly pushes: readonly PushedBranch[]
}

/** One change request bound to a Session and not dismissed, with its latest polling result. */
export interface SessionChangeRequest {
  /** Web URL as first recorded. */
  readonly url: string
  /** How the change request became bound. */
  readonly origin: BindingOrigin
  /** Parsed reference, or null when no registered provider serves the URL. */
  readonly ref: ChangeRequestRef | null
  /** Latest polling result, or null before the first poll and without a provider. */
  readonly update: ChangeRequestUpdate | null
}

/**
 * Receives the complete visible list after a binding or provider change, or a polling result.
 * @param changeRequests - every visible binding of the watched Session, in first-recorded order.
 */
export type SessionChangeRequestsListener = (changeRequests: readonly SessionChangeRequest[]) => void

/** Deployment settings of `forgeSession`. */
export interface Config {
  /** Deadline in milliseconds for one change request lookup after a push. */
  discoveryTimeoutMs?: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** A caller or discovery action that binds, restores, or hides one change request. */
    'plugin:forge-session/binding': BindingRecord
  }
}

/**
 * The conditions one viewer read can end in, and the answer that carries each.
 *
 * A page that cannot name why a read failed states one failure for every cause: a link that never
 * named a share, a share the owner stopped, an owner whose machine is asleep, and a sign-in that
 * expired all reach a reader as the same silence. These are the conditions the Relay may answer a
 * viewer with, each paired with the answer that means it and nothing else, so a page, a test, and an
 * operator all read the same name for what happened.
 *
 * @module @deepseek-ai/dsh-experimental-liveshare-protocol/viewer-states
 */

/** One condition a viewer read can end in. */
export type ViewerState =
  /** The link names no share: it was never valid, or the owner deleted it. */
  | 'share-not-found'
  /** The owner stopped the share, which ends every viewer's access to it. */
  | 'share-stopped'
  /** The share's own deadline passed, which denies like a stop but states its own reason. */
  | 'share-expired'
  /** No live owner gateway holds the share's route, or one stopped answering a held read. */
  | 'owner-offline'
  /** The reader's sign-in expired, so the Relay cannot say who is asking. */
  | 'sign-in-expired'
  /** The reader is signed in and admitted to the deployment, but this share does not admit it. */
  | 'access-denied'
  /** The viewer page could not reach the Relay at all: the request never arrived. */
  | 'relay-unreachable'

/** Whether the page may ask again, or the answer is the peer's verdict. */
export type ViewerStateReach = 'retryable' | 'terminal'

/**
 * One answer that carries exactly one condition.
 *
 * The two carriers are the two places a viewer page learns anything: a refused read, and the copy the
 * served page states for a failure that never reached the Relay.
 */
export type ViewerStateAnswer =
  | {
    readonly wire: 'http'
    readonly state: ViewerState
    /** HTTP status of the refused read. */
    readonly status: number
    /** `error` code the JSON body carries. */
    readonly code: string
    readonly reach: ViewerStateReach
  }
  | {
    readonly wire: 'page'
    readonly state: ViewerState
    /** Copy the served page states when the failure never reached the Relay. */
    readonly copy: string
    readonly reach: ViewerStateReach
  }

/**
 * Every answer a viewer page must tell apart, one entry per condition and carrier.
 *
 * This list is the whole of it: a page that knows these names can state what happened, and a check
 * over this list proves no two conditions share an answer.
 */
export const VIEWER_STATE_ANSWERS: readonly ViewerStateAnswer[] = [
  { wire: 'http', state: 'share-not-found', status: 404, code: 'share-not-found', reach: 'terminal' },
  { wire: 'http', state: 'share-stopped', status: 410, code: 'share-stopped', reach: 'terminal' },
  { wire: 'http', state: 'share-expired', status: 403, code: 'share-expired', reach: 'terminal' },
  { wire: 'http', state: 'owner-offline', status: 503, code: 'owner-offline', reach: 'retryable' },
  { wire: 'http', state: 'sign-in-expired', status: 401, code: 'authentication-required', reach: 'terminal' },
  { wire: 'http', state: 'access-denied', status: 403, code: 'access-denied', reach: 'terminal' },
  { wire: 'page', state: 'relay-unreachable', copy: 'accessDeniedTitle', reach: 'retryable' },
]

/**
 * The state one refused read carries.
 * @param status - HTTP status the read was refused with.
 * @param code - `error` code of the refusing body, when it carried one.
 * @returns The state that answer means, or undefined for an answer outside this vocabulary.
 */
export function viewerStateOfRefusal(status: number, code: string | undefined): ViewerState | undefined {
  return VIEWER_STATE_ANSWERS.find(answer =>
    answer.wire === 'http' && answer.status === status && answer.code === code)?.state
}

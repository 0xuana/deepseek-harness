/**
 * How this package states one refused branch.
 *
 * The branch action on the conversation and the verb on the sidebar's Session row both reach this
 * through the `uiConversation` service, so a reader's branch states the same reason whichever surface
 * asked for it.
 *
 * @module @deepseek-ai/dsh-client-ui-conversation/src/client/branch
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable code and message one fork rejection carries. */
export interface ForkRefusal {
  /** Code the Host refused with, or {@link UNNAMED_REFUSAL} when the rejection named none. */
  readonly code: string
  /** The Host's own message, empty when the rejection carried none. */
  readonly message: string
}

/** Code stand-in for a rejection that named none of its own. */
const UNNAMED_REFUSAL = 'unknown'

/**
 * Read the stable code and message one fork rejection carries.
 * @param error - Rejection the fork reported.
 * @returns The code the Host refused with, and its own message when it named one.
 */
export function readForkRefusal(error: unknown): ForkRefusal {
  // A rejection may be null, undefined, or any non-object; reading through it must not turn the
  // refusal notice itself into a crash.
  const wrapped: {
    readonly code?: unknown
    readonly message?: unknown
    readonly rpcError?: { readonly code?: unknown; readonly message?: unknown }
  } = typeof error === 'object' && error !== null ? error : {}
  const code = typeof wrapped.rpcError?.code === 'string' && wrapped.rpcError.code !== ''
    ? wrapped.rpcError.code
    : typeof wrapped.code === 'string' && wrapped.code !== '' ? wrapped.code : UNNAMED_REFUSAL
  const message = typeof wrapped.rpcError?.message === 'string' && wrapped.rpcError.message !== ''
    ? wrapped.rpcError.message
    : typeof wrapped.message === 'string' ? wrapped.message : ''
  return { code, message }
}

/**
 * State why one branch was refused, on the Session it was asked of.
 *
 * The reason is the Host's own message with the stable code beside it. A failed branch leaves the Session
 * unchanged; this notice is the only trace it leaves.
 * @param ctx - Client root Context.
 * @param sessionId - Session the branch was asked of.
 * @param error - Rejection the fork reported.
 * @param message - The caller's copy for one stated reason.
 */
export function noteBranchRefusal(
  ctx: Context,
  sessionId: SessionId,
  error: unknown,
  message: (reason: string) => string,
): void {
  const refusal = readForkRefusal(error)
  const scope = ctx.sessions.scope(sessionId)
  if (scope === undefined) return
  const conversation = scope.get('conversation')
  if (conversation === undefined) return
  // The Host's own words, with the stable code beside them when it named one; a rejection that named
  // neither stays its message alone rather than gaining a placeholder code.
  const reason = refusal.message === ''
    ? refusal.code
    : refusal.code === UNNAMED_REFUSAL ? refusal.message : `${refusal.message} (${refusal.code})`
  conversation.input.for(scope).notify('error', message(reason))
}

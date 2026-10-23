/**
 * Browser performance plugin contributing one entry to the conversation view
 * slot: per-turn and per-step context, timing, cache, and tool-cost columns.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionBinding, SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row and target registry types.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: ctx.slots on the client root context.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the standard Session props the slot component receives.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { de, en, es, fr, ja, NS, pt, ru, zh } from './locales.ts'
import type { LoadOlderResult, PerfSnapshot } from './perf-contract.ts'
import { registerPerfDefinitions } from './perf-definition.ts'
import { EMPTY_PERF_SNAPSHOT, registerPerfConversationView } from './perf-snapshot-builder.ts'
import { PerfView, type PerfViewInjected } from './PerfView.tsx'

export type { PerfKey } from './locales.ts'
export type { PerfCall, PerfSnapshot, PerfStepMetrics, PerfTurnMetrics } from './perf-contract.ts'

/** Required services: the conversation slot and view registries, Session paging, and the locale service. */
export const inject = ['slots', 'sessions', 'uiConversation', 'locale']


/** Resolve once the Session window has opened or failed, or the caller cancels. */
async function whenOpened(session: SessionFace, signal: AbortSignal): Promise<void> {
  const settled = (): boolean => {
    const state = session.getSnapshot().openState
    return state === 'open' || state === 'error'
  }
  if (settled() || signal.aborted) return
  await new Promise<void>((resolve) => {
    const subscription: { cleanup?: () => void } = {}
    const stop = (): void => {
      signal.removeEventListener('abort', stop)
      subscription.cleanup?.()
      resolve()
    }
    subscription.cleanup = session.subscribe(() => {
      if (settled()) stop()
    })
    signal.addEventListener('abort', stop, { once: true })
    if (settled() || signal.aborted) stop()
  })
}

/** Snapshot hook name; `InjectFace` turns it into the component's `usePerf` prop. */
const HOOK = 'perf'

/**
 * Client plugin body: register the locale dictionaries, the event Definitions,
 * the view target, and the tab itself. Every registration rides the caller's
 * fiber effect, so unloading the plugin removes the tab with it.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  // Per-plugin-instance source cache; unloading the plugin drops the map with it.
  const sources = new WeakMap<SessionBinding, ObservableSnapshot<PerfSnapshot>>()
  // One page request per Session binding; Chat/Trajectory may still own the
  // Session's in-flight page, which loadOlder observes through loadingOlder.
  const pages = new WeakMap<SessionBinding, Promise<LoadOlderResult>>()
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, de, es, fr, pt, ru }), 'client-ui-perf: dictionaries')
  // Registration-time text (the tab label) reads through the bound translate as
  // a thunk, so it follows the active locale without re-registration.
  const t = ctx.locale.bind(NS)
  registerPerfDefinitions(ctx)
  registerPerfConversationView(ctx)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'perf',
    order: 40,
    locale: NS,
    label: () => t('view.perf'),
    inject: (sessionId: SessionId): PerfViewInjected => {
      const binding = ctx.sessions.binding(sessionId)
      const session = binding?.session
      if (binding === undefined || session === undefined) {
        throw new Error(`client-ui-perf: session "${sessionId}" is unavailable`)
      }
      const target = ctx.uiConversation.binding(sessionId).target('perf')
      const lifecycle = new AbortController()
      let perf = sources.get(binding)
      if (perf === undefined) {
        perf = {
          getSnapshot: () => target.getSnapshot() ?? EMPTY_PERF_SNAPSHOT,
          subscribe: listener => target.subscribe(listener),
        }
        sources.set(binding, perf)
      }
      return {
        hooks: { [HOOK]: perf },
        cancel: () => { lifecycle.abort() },
        loadOlder: (): Promise<LoadOlderResult> => {
          const pending = pages.get(binding)
          if (pending !== undefined) return pending
          const task = (async (): Promise<LoadOlderResult> => {
            const before = perf.getSnapshot()
            // A view can mount before the Session finishes opening; paging before
            // that is a no-op, so wait for open unless the view is gone.
            await whenOpened(session, lifecycle.signal)
            if (lifecycle.signal.aborted) return 'retry'
            if (session.getSnapshot().loadingOlder) return 'retry'
            await session.loadOlder()
            if (perf.getSnapshot() !== before) return 'grew'
            const after = session.getSnapshot()
            // A page can grow the Session window without adding a perf node. Only
            // an exhausted Session may hide the trigger; otherwise keep it retryable.
            return after.hasMore ? 'retry' : 'exhausted'
          })()
          const promise = task.finally(() => { pages.delete(binding) })
          pages.set(binding, promise)
          return promise
        },
        // The shared Conversation cache reads the durable bytes once per Session
        // and owns the resulting browser URL until its binding is released.
        loadImage: (attachment: ImageAttachmentRef) => ctx.uiConversation.imageUrl(sessionId, attachment),
      }
    },
  }, PerfView))
}

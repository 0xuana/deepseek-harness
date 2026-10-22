/**
 * Browser performance plugin contributing one entry to the conversation view
 * slot: per-turn and per-step context, timing, cache, and tool-cost columns.
 */

import type { Context } from '@deepseek-ai/cordis'
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
import { en, ja, NS, zh } from './locales.ts'
import type { PerfSnapshot } from './perf-contract.ts'
import { registerPerfDefinitions } from './perf-definition.ts'
import { EMPTY_PERF_SNAPSHOT, registerPerfConversationView } from './perf-snapshot-builder.ts'
import { PerfView, type PerfViewInjected } from './PerfView.tsx'

export type { PerfKey } from './locales.ts'
export type { PerfCall, PerfSnapshot, PerfStepMetrics, PerfTurnMetrics } from './perf-contract.ts'

/** Required services: the conversation slot and view registries, Session paging, and the locale service. */
export const inject = ['slots', 'sessions', 'uiConversation', 'locale']


/** Resolve once the Session window has opened (or failed); paging before that is a no-op. */
async function whenOpened(session: SessionFace): Promise<void> {
  const settled = (): boolean => {
    const state = session.getSnapshot().openState
    return state === 'open' || state === 'error'
  }
  if (settled()) return
  await new Promise<void>((resolve) => {
    const stop = session.subscribe(() => {
      if (!settled()) return
      stop()
      resolve()
    })
    if (settled()) {
      stop()
      resolve()
    }
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
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja }), 'client-ui-perf: dictionaries')
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
        loadOlder: async () => {
          const before = perf.getSnapshot()
          // A view can mount before the Session finishes opening; loadOlder is a
          // no-op then and would look like exhausted history.
          await whenOpened(session)
          await session.loadOlder()
          // A concurrent view (Chat/Trajectory) may own the in-flight page and
          // this call then returns without progress. Only a Session that has no
          // older history left may hide the trigger; otherwise keep it retryable.
          const grew = perf.getSnapshot() !== before
          if (grew) return true
          const snapshot = session.getSnapshot()
          if (snapshot.hasMore === true) {
            throw new Error('client-ui-perf: history page did not advance')
          }
          return false
        },
      }
    },
  }, PerfView))
}

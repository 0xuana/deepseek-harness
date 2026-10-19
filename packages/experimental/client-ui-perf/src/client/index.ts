/**
 * Browser performance plugin contributing one entry to the conversation view
 * slot: per-turn and per-step context, timing, cache, and tool-cost columns.
 */

import type { Context } from '@deepseek-ai/cordis'
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
import { en, NS, zh } from './locales.ts'
import type { PerfSnapshot } from './perf-contract.ts'
import { registerPerfDefinitions } from './perf-definition.ts'
import { EMPTY_PERF_SNAPSHOT, registerPerfConversationView } from './perf-snapshot-builder.ts'
import { PerfView, type PerfViewInjected } from './PerfView.tsx'

export type { PerfKey } from './locales.ts'
export type { PerfCall, PerfSnapshot, PerfStepMetrics, PerfTurnMetrics } from './perf-contract.ts'

/** Required services: the conversation slot registry, view registry, and locale. */
export const inject = ['slots', 'uiConversation', 'locale']

/** Snapshot hook name; `InjectFace` turns it into the component's `usePerf` prop. */
const HOOK = 'perf'

/**
 * Client plugin body: register the locale dictionaries, the event Definitions,
 * the view target, and the tab itself. Every registration rides the caller's
 * fiber effect, so unloading the plugin removes the tab with it.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-perf: dictionaries')
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
      const target = ctx.uiConversation.binding(sessionId).target('perf')
      const perf: ObservableSnapshot<PerfSnapshot> = {
        getSnapshot: () => target.getSnapshot() ?? EMPTY_PERF_SNAPSHOT,
        subscribe: listener => target.subscribe(listener),
      }
      return { hooks: { [HOOK]: perf } }
    },
  }, PerfView))
}

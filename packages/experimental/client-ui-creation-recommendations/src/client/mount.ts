/** Register completed-answer recommendations and their localized actions. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-experimental-creation-recommendations/remote'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-experimental-creation-recommendations/types'
import { RecommendationTail, type CardInjected } from './Card.tsx'
import { en, ja, zh, type RecommendationKey } from './locales.ts'
import { createCreationInfoStore } from './info-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { creationRecommendations: RecommendationKey }
}

/** Registries available before this plugin mounts its optional Remote. */
export const inject = ['slots', 'locale', 'remote']

/** Mount the optional Remote and UI for the same plugin lifetime.
 * @param ctx - Client plugin context.
 * @param contribution - Generated Remote descriptors supplied by the built entry.
 * @returns disposer removing the UI before the Remote contribution.
 */
export async function mountRecommendations(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  // Each independently optional bundle owns its Remote and dependent UI lifetime.
  /* jscpd:ignore-start */
  const unmount = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.creationRecommendations'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await unmount(); throw error }
  return async () => { await ui.dispose(); await unmount() }
  /* jscpd:ignore-end */
}

function registerUi(ctx: Context): void {
  const infoDismissed = createCreationInfoStore()
  ctx.effect(() => ctx.locale.register('creationRecommendations', { en, zh, ja }), 'creation-recommendations: locale')
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail', id: 'creation-recommendation', locale: 'creationRecommendations',
    inject: (sessionId: SessionId): CardInjected => ({
      hooks: { infoDismissed },
      dismissInfo: () => { infoDismissed.set(true) },
      act: async (callId, action, slot, customLocation) => {
        const result = await ctx.remote.creationRecommendations.act(sessionId, callId, action, slot, customLocation)
        return result.ok ? result.value : undefined
      },
    }),
  }, RecommendationTail))
}

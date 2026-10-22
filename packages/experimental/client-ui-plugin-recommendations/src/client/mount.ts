/** Register completed-answer recommendations and their localized actions. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-experimental-plugin-recommendations/remote'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-experimental-plugin-recommendations/types'
import { RecommendationTail, type CardInjected, type CatalogDetails } from './Card.tsx'
import { en, ja, zh, type RecommendationKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { pluginRecommendations: RecommendationKey }
}

/** Registries available before this plugin mounts its optional Remote. */
export const inject = ['slots', 'locale', 'remote', 'pluginNavigation']

/** Mount the optional Remote and UI for the same plugin lifetime.
 * @param ctx - Client plugin context.
 * @param contribution - Generated Remote descriptors supplied by the built entry.
 * @returns disposer removing the UI before the Remote contribution.
 */
export async function mountRecommendations(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  // Each independently optional bundle owns its Remote and dependent UI lifetime.
  /* jscpd:ignore-start */
  const unmount = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.pluginRecommendations'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await unmount(); throw error }
  return async () => { await ui.dispose(); await unmount() }
  /* jscpd:ignore-end */
}

function registerUi(ctx: Context): void {
  // Catalog text by plugin name for this plugin lifetime: a revisited card renders it before its own lookup returns.
  const catalog = createSnapshotStore<Readonly<Record<string, CatalogDetails>>>({})
  ctx.effect(() => ctx.locale.register('pluginRecommendations', { en, zh, ja }), 'plugin-recommendations: locale')
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail', id: 'plugin-recommendation', locale: 'pluginRecommendations',
    inject: (sessionId: SessionId): CardInjected => ({
      openDetails: (packageName) => { ctx.pluginNavigation.openBundle(packageName) },
      hooks: { locale: {
        getSnapshot: () => ctx.locale.getSnapshot().active,
        subscribe: listener => ctx.locale.subscribe(listener),
      }, catalog },
      remember: (name, details) => { catalog.set({ ...catalog.getSnapshot(), [name]: details }) },
      resolveText: text => ctx.locale.resolveText(text),
      describe: async (callId) => {
        const result = await ctx.remote.pluginRecommendations.describe(sessionId, callId)
        return result.ok ? result.value : undefined
      },
      act: async (callId, action) => {
        const result = await ctx.remote.pluginRecommendations.act(sessionId, callId, action)
        return result.ok ? result.value : undefined
      },
    }),
  }, RecommendationTail))
}

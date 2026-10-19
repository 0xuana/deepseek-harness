/** Register completed-answer recommendations and their localized actions. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import remote from '@deepseek-ai/dsh-experimental-plugin-recommendations/remote'
import type {} from '@deepseek-ai/dsh-experimental-plugin-recommendations/types'
import { RecommendationTail, type RecommendationTailInjected } from './Card.tsx'
import { recommendationDefinition } from './definition.ts'
import { en, zh, type RecommendationKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { pluginRecommendations: RecommendationKey }
}

/** Registries available before this plugin mounts its optional Remote. */
export const inject = ['slots', 'uiConversation', 'sessions', 'locale', 'remote', 'pluginNavigation']

/** Mount the optional Remote and UI for the same plugin lifetime.
 * @param ctx - Client plugin context.
 * @returns disposer removing the UI before the Remote contribution.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(remote)
  const ui = ctx.inject(['remote.pluginRecommendations'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await unmount(); throw error }
  return async () => { await ui.dispose(); await unmount() }
}

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('pluginRecommendations', { en, zh }), 'plugin-recommendations: locale')
  ctx.effect(() => ctx.uiConversation.events.register(recommendationDefinition), 'plugin-recommendations: chat')
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail', id: 'plugin-recommendation', locale: 'pluginRecommendations',
    inject: (sessionId: SessionId): RecommendationTailInjected => {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`plugin-recommendations: unknown session "${sessionId}"`)
      const chat = ctx.uiConversation.binding(binding).target('chat')
      return {
        openDetails: (packageName) => { ctx.pluginNavigation.openBundle(packageName) },
        keyedHooks: { recommendations: (turn) => {
          const snapshot = chat.getSnapshot()
          if (snapshot === undefined) throw new Error('plugin-recommendations: Chat target is unavailable')
          return snapshot.nodes.turnDataSource(Number(turn), 'plugin-recommendation')
        } },
        hooks: { chinese: {
          getSnapshot: () => ctx.locale.getSnapshot().active.startsWith('zh'),
          subscribe: listener => ctx.locale.subscribe(listener),
        } },
        act: async (callId, action) => {
          const result = await ctx.remote.pluginRecommendations.act(sessionId, callId, action)
          return result.ok ? result.value : undefined
        },
      }
    },
  }, RecommendationTail))
}

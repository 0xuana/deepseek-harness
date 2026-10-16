/** Remote contribution and slot registrations of the forge panel. */

import type { Context } from '@deepseek-ai/cordis'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-experimental-client-ui-forge/remote'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { ForgePanelChangeRequest } from '../types.ts'
import { ActionToast } from './ActionToast.tsx'
import { BranchChip, type BranchChipInjected } from './BranchChip.tsx'
import { ForgeTab, type ForgeTabInjected } from './ForgeTab.tsx'
import { ForgeTabTitle } from './ForgeTabTitle.tsx'
import { HeaderButton, type HeaderButtonInjected } from './HeaderButton.tsx'
import { en, NS, zh, type ForgePanelKey } from './locales.ts'
import {
  createNoticeSource, createPanelSource, createVisibilitySource, type PanelSource, type VisibilitySource,
} from './source.ts'
import { numberOf } from './status.ts'
import { WorktreeProgress, type WorktreeProgressInjected } from './WorktreeProgress.tsx'
import { WorktreeToggle, type WorktreeToggleInjected } from './WorktreeToggle.tsx'

/** Services required before the Remote contribution mounts. */
export const inject = ['remote', 'slots', 'locale', 'sidebarRightTabs', 'sidebarRight']

/** Registry id of the forge tab type, also its slot key. */
export const TAB_ID = '@deepseek-ai/dsh-experimental-client-ui-forge'

/** Kind of the forge tab. */
export const TAB_KIND = 'forge-panel'

/**
 * Open a URL in a new browsing context without giving it access to this page.
 * @param url - change request web URL.
 */
function openLink(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** Per-Session stores shared by the tab, the header entries, the New Session option, and the worktree card. */
interface SessionStores {
  readonly panel: PanelSource
  readonly visibility: VisibilitySource
}

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'forge-panel: dictionaries')
  const t = ctx.locale.bind(NS)
  const notices = createNoticeSource()
  const stores = new Map<SessionId, SessionStores>()
  ctx.effect(() => () => {
    for (const store of stores.values()) store.panel.close()
    stores.clear()
  }, 'forge-panel: panel streams')
  const storesOf = (sessionId: SessionId): SessionStores => {
    let store = stores.get(sessionId)
    if (store === undefined) {
      store = {
        panel: createPanelSource({
          open: signal => ctx.remote.forgePanel.follow(sessionId, signal),
          subscribeReset: listener => ctx.on('connection/reset', listener),
        }),
        visibility: createVisibilitySource(),
      }
      stores.set(sessionId, store)
    }
    return store
  }
  const settled = (result: RemoteResult<unknown>, failure: ForgePanelKey, codes: Partial<Record<string, ForgePanelKey>> = {}): boolean => {
    if (result.ok) return true
    notices.report(codes[result.error.code] ?? failure)
    return false
  }
  const copyText = (text: string): void => {
    void navigator.clipboard.writeText(text).then(
      () => { notices.report('toast.copied', { tone: 'success' }) },
      () => { notices.report('toast.copyFailed') },
    )
  }
  const remove = (sessionId: SessionId, entry: ForgePanelChangeRequest): void => {
    void ctx.remote.forgePanel.dismiss(sessionId, entry.url).then((result) => {
      if (!settled(result, 'toast.removeFailed')) return
      const number = numberOf(entry)
      notices.report('toast.removed', {
        tone: 'success',
        params: { name: number === null ? entry.snapshot?.title ?? entry.url : t('change.number', { number }) },
        // Restoring needs a provider that recognizes the URL; an unrecognized one is removed without undo.
        ...entry.ref === null ? {} : {
          undo: () => {
            void ctx.remote.forgePanel.track(sessionId, entry.url).then(restored => settled(restored, 'toast.undoFailed'))
          },
        },
      })
    })
  }
  const host: HostObservable<RemoteHostFacts> = {
    getSnapshot: () => ctx.remote.$host,
    subscribe: listener => ctx.on('connection/reset', listener),
  }
  const restore = async (sessionId: SessionId): Promise<string | undefined> => {
    const result = await ctx.remote.forgePanel.restoreWorktree(sessionId)
    if (!result.ok) return result.error.message
    notices.report('toast.restored', { tone: 'success' })
    return undefined
  }
  const tabFace = (sessionId: SessionId): ForgeTabInjected => {
    const store = storesOf(sessionId)
    return {
      hooks: { panel: store.panel.hooks.panel, host },
      reconnect: store.panel.reconnect,
      refresh: () => {
        void ctx.remote.forgePanel.refresh(sessionId).then(result => settled(result, 'toast.refreshFailed'))
      },
      remove: (entry) => { remove(sessionId, entry) },
      restore: () => {
        void restore(sessionId).then((message) => {
          if (message !== undefined) notices.report('toast.restoreFailed', { params: { message } })
        })
      },
      openLink,
      copyText,
      reportVisible: store.visibility.set,
    }
  }
  const progressFace = (sessionId: SessionId): WorktreeProgressInjected => {
    const store = storesOf(sessionId)
    return {
      hooks: { panel: store.panel.hooks.panel },
      stop: () => {
        void ctx.remote.forgePanel.stopCreation(sessionId).then(result => settled(result, 'toast.worktreeFailed'))
      },
      withdraw: () => {
        void ctx.remote.forgePanel.cancelWorktree(sessionId).then(result => settled(result, 'toast.worktreeFailed'))
      },
      restore: () => restore(sessionId),
      leave: () => {
        void ctx.remote.forgePanel.continueInProject(sessionId).then(result => settled(result, 'toast.leaveFailed'))
      },
    }
  }
  const worktreeFace = (sessionId: SessionId): WorktreeToggleInjected => {
    const worktreeCodes: Partial<Record<string, ForgePanelKey>> = { 'forgePanel/session-started': 'toast.worktreeStarted' }
    const store = storesOf(sessionId)
    return {
      hooks: { panel: store.panel.hooks.panel },
      request: async from => settled(await ctx.remote.forgePanel.requestWorktree(sessionId, from), 'toast.worktreeFailed', worktreeCodes),
      cancel: async () => settled(await ctx.remote.forgePanel.cancelWorktree(sessionId), 'toast.worktreeFailed', worktreeCodes),
      branches: async () => {
        const result = await ctx.remote.forgePanel.branches(sessionId)
        return settled(result, 'toast.branchesFailed') && result.ok ? result.value : undefined
      },
    }
  }
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: TAB_ID, kind: TAB_KIND, title: () => t('tab.title') }), 'forge-panel: sidebar tab')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS, inject: tabFace,
  }, ForgeTab))
  ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: NS,
  }, ForgeTabTitle))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'forge-panel',
    // Left of the schedule entry (-5) and the overflow menu (0), right of open-in-app (-10).
    order: -8,
    locale: NS,
    inject: (sessionId: SessionId): HeaderButtonInjected => {
      const store = storesOf(sessionId)
      return {
        hooks: { panel: store.panel.hooks.panel, visible: store.visibility.hooks.visible },
        toggle: (visible) => {
          if (visible) ctx.sidebarRight.toggleExpanded()
          else ctx.sidebarRight.openTab(TAB_KIND)
        },
      }
    },
  }, HeaderButton))
  ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
    name: 'conversation.hero.options', id: 'forge-panel.worktree', locale: NS, inject: worktreeFace,
  }, WorktreeToggle))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'forge-panel.worktree', order: 5, locale: NS, inject: progressFace,
  }, WorktreeProgress))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'forge-panel.branch',
    // After the subagent lineage (-30), Team navigation (-20), and the preset label (-10).
    order: 10,
    locale: NS,
    inject: (sessionId: SessionId): BranchChipInjected => ({ hooks: { panel: storesOf(sessionId).panel.hooks.panel, host } }),
  }, BranchChip))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'forge-panel.toast', locale: NS,
    inject: () => ({ hooks: notices.hooks, dismiss: notices.dismiss }),
  }, ActionToast))
}

/**
 * Mount the forge panel Remote, then the UI that calls it; the UI is withdrawn before the Remote.
 * @param ctx - client plugin lifetime.
 * @param contribution - generated forge panel Remote definitions.
 * @returns the disposer that removes both contributions.
 */
export async function mountForgePanel(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.forgePanel', ...inject.slice(1)], registerUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await unmountRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await unmountRemote()
  }
}

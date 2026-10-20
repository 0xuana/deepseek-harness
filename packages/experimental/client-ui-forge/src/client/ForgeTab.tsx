/** Body of the forge sidebar tab: where the Session works and the pull requests it created or pushed. */

import { useEffect, useState, type ReactNode } from 'react'
import {
  Button, IconBranchOutlineRegular, IconRefreshOutlineRegular, StateDot, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { ForgePanelChangeRequest, ForgePanelState } from '../types.ts'
import { ChangeRequestCard, type ChangeRequestActions } from './ChangeRequestCard.tsx'
import type { ForgePanelKey, NS } from './locales.ts'
import type { PanelSnapshot } from './source.ts'
import css from './ForgeTab.module.css'

/** Business face of the tab body. */
export interface ForgeTabInjected {
  /** Panel snapshot of the Session; the renderer binds it as `usePanel`. */
  readonly hooks: { readonly panel: HostObservable<PanelSnapshot> }
  /** Open the stream again after it ended. */
  readonly reconnect: () => void
  /** Reinspect the checkout, probe sign-in, and poll the change requests. */
  readonly refresh: () => void
  /** Remove a change request from the Session, offering to undo it. */
  readonly remove: (entry: ForgePanelChangeRequest) => void
  /** Open a URL outside the app. */
  readonly openLink: (url: string) => void
  /** Copy text to the clipboard and report the outcome. */
  readonly copyText: (text: string) => void
  /** Show one notice. */
  readonly report: (key: ForgePanelKey) => void
  /** Record whether the tab is visible, for the header entry's pressed state. */
  readonly reportVisible: (visible: boolean) => void
}

/** Full props of the tab body. */
export type ForgeTabProps =
  Pick<PropsRuntime<'sidebar.right.pane.tab'>, 'useTabInfo' | 'inputActions'>
  & InjectFace<ForgeTabInjected>
  & PropsLocale<typeof NS>

type Translate = ForgeTabProps['t']

function Checkout({ state, t }: { readonly state: ForgePanelState; readonly t: Translate }): ReactNode {
  const checkout = state.checkout
  if (checkout.state === 'pending') return null
  if (checkout.state === 'none') return <div className={css.checkout}>{t('checkout.none')}</div>
  if (checkout.state === 'failed') {
    return (
      <Tooltip label={checkout.message} side="bottom">
        <div className={css.checkout} tabIndex={0}>{t('checkout.failed')}</div>
      </Tooltip>
    )
  }
  const created = state.worktree.created
  const worktree = created !== null && created.path === checkout.checkout.root ? created : null
  const branch = worktree?.branch ?? checkout.checkout.branch
  return (
    <Tooltip label={checkout.checkout.root} side="bottom">
      <div className={css.checkout} tabIndex={0} data-forge-checkout="">
        <IconBranchOutlineRegular size={14} className={css.checkoutIcon} />
        <span>{t(worktree === null ? 'checkout.branch' : 'checkout.worktree')}</span>
        <span className={css.checkoutBranch}>{branch ?? t('checkout.detached')}</span>
        <span className={css.checkoutNote}>
          {worktree === null
            ? t('checkout.current')
            : t('checkout.basedOn', { base: worktree.from ?? worktree.baseCommit.slice(0, 7) })}
        </span>
      </div>
    </Tooltip>
  )
}

function SignIn({ state, copyText, t }: {
  readonly state: ForgePanelState
  readonly copyText: (text: string) => void
  readonly t: Translate
}): ReactNode {
  const { repository, readiness } = state
  if (repository === null || readiness === null || readiness.state === 'ready') return null
  const host = repository.host
  if (readiness.state === 'unavailable') {
    return <div className={css.banner} role="status">{t('signin.unavailable', { host, message: readiness.message ?? '' })}</div>
  }
  const command = repository.forge === 'github' ? `gh auth login --hostname ${host}` : undefined
  return (
    <div className={css.banner} role="status">
      <span>{t('signin.title', { host })}</span>
      {command === undefined
        ? readiness.message !== null && <span className={css.bannerDetail}>{readiness.message}</span>
        : (
          <>
            <code className={css.bannerCommand}>{command}</code>
            <Button size="sm" variant="outline" className={css.bannerAction} onClick={() => { copyText(command) }}>
              {t('signin.copy')}
            </Button>
          </>
        )}
    </div>
  )
}

/**
 * Render the forge tab of one Session.
 * @param props - tab information, composer actions, panel snapshot hook, actions, and copy.
 * @returns the tab body.
 */
export function ForgeTab({
  useTabInfo, inputActions, usePanel, reconnect, refresh, remove, openLink, copyText, report, reportVisible, t,
}: ForgeTabProps): ReactNode {
  const snapshot = usePanel(current => current)
  const visible = useTabInfo().tab.visible
  const [expanded, setExpanded] = useState<string | null>(null)
  useEffect(() => {
    reportVisible(visible)
  }, [reportVisible, visible])
  useEffect(() => () => { reportVisible(false) }, [reportVisible])
  const state = snapshot.state
  const disconnected = snapshot.disconnected && (
    <div className={css.disconnected} role="status">
      <span>{t('stream.failed')}</span>
      <Button size="sm" variant="outline" onClick={reconnect}>{t('retry')}</Button>
    </div>
  )
  if (state === null) return <div className={css.centered}>{disconnected || <StateDot state="ongoing" />}</div>
  const actions: ChangeRequestActions = {
    openLink,
    copyLink: copyText,
    retry: refresh,
    addToChat: (url) => {
      if (!inputActions.insertText(`${url} `, inputActions.captureInsertion())) report('toast.chatFailed')
    },
    remove,
  }
  const now = Date.now()
  const count = state.changeRequests.length
  return (
    <div className={css.root} data-forge-panel="">
      {disconnected}
      <Checkout state={state} t={t} />
      <section className={css.section}>
        <div className={css.sectionHeader}>
          <h3 className={css.sectionTitle}>{t('changes.title', { count })}</h3>
          <Tooltip label={t('refresh')} side="top">
            <button type="button" className={css.iconButton} aria-label={t('refresh')} onClick={refresh}>
              <IconRefreshOutlineRegular size={14} />
            </button>
          </Tooltip>
        </div>
        <SignIn state={state} copyText={copyText} t={t} />
        {count === 0
          ? (
            <div className={css.empty}>
              <p className={css.emptyTitle}>{t('changes.empty')}</p>
              <p className={css.emptyHint}>{t('changes.emptyHint')}</p>
            </div>
          )
          : (
            <ul className={css.list}>
              {state.changeRequests.map(entry => (
                <ChangeRequestCard
                  key={entry.url}
                  entry={entry}
                  expanded={expanded === entry.url}
                  onToggle={() => { setExpanded(expanded === entry.url ? null : entry.url) }}
                  now={now}
                  actions={actions}
                  t={t}
                />
              ))}
            </ul>
          )}
      </section>
    </div>
  )
}

/**
 * One change request as a card: its title links to the host, a one-line
 * summary shows while collapsed, and the checks, review, merge state, diff
 * size, and the ready-for-review or merge action show while expanded.
 */

import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, IconChevronDownOutlineRegular, IconCloseOutlineRegular, IconCopyOutlineRegular, IconRightUpOutlineRegular,
  Menu, MenuItemButton, StateDot, Tooltip, type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ChangeRequestCheck, ChangeRequestSnapshot, CheckState, ChecksRollup, ForgeFailure, MergeMethod, MergeRequest,
} from '@deepseek-ai/dsh-experimental-forge/types'
import type { ForgePanelChangeRequest } from '../types.ts'
import { formatAgo, formatDuration } from './format.ts'
import { ChangeRequestGlyph, CheckGlyph } from './glyphs.tsx'
import type { ForgePanelKey, NS } from './locales.ts'
import { checkCounts, checkDuration, ciSummary, flagOf, numberOf, toneOf, type ChangeRequestTone } from './status.ts'
import css from './ForgeTab.module.css'

type Translate = PropsLocale<typeof NS>['t']

/** What a card can do; a surface without a Session binding omits `remove`, `markReady`, and `merge`. */
export interface ChangeRequestActions {
  /** Open a URL outside the app. */
  readonly openLink: (url: string) => void
  /** Copy a URL to the clipboard. */
  readonly copyLink: (url: string) => void
  /** Read the status again after a failed read. */
  readonly retry: () => void
  /** Remove the change request from its Session. */
  readonly remove?: ((entry: ForgePanelChangeRequest) => void) | undefined
  /** Mark a draft ready for review; settles once the outcome is reported. */
  readonly markReady?: ((entry: ForgePanelChangeRequest) => Promise<void>) | undefined
  /** Merge the change request as `request` describes; settles once the outcome is reported. */
  readonly merge?: ((entry: ForgePanelChangeRequest, request: MergeRequest) => Promise<void>) | undefined
}

/** Props of one change request card. */
export interface ChangeRequestCardProps {
  /** Change request with its latest snapshot and polling result. */
  readonly entry: ForgePanelChangeRequest
  /** Whether the details show. */
  readonly expanded: boolean
  /** Show or hide the details. */
  readonly onToggle: () => void
  /** Current epoch milliseconds for relative times. */
  readonly now: number
  /** Card actions. */
  readonly actions: ChangeRequestActions
  /** Forge panel copy. */
  readonly t: Translate
}

const STATE: Record<ChangeRequestTone, ForgePanelKey> = {
  open: 'change.state.open',
  blocked: 'change.state.blocked',
  draft: 'change.state.draft',
  merged: 'change.state.merged',
  closed: 'change.state.closed',
  unknown: 'change.state.unknown',
}

const REVIEW: Record<ChangeRequestSnapshot['reviewDecision'], ForgePanelKey> = {
  'approved': 'change.review.approved',
  'changes-requested': 'change.review.changesRequested',
  'review-required': 'change.review.required',
  'none': 'change.review.none',
}

const FAILURE: Record<ForgeFailure['code'], ForgePanelKey> = {
  'not-found': 'change.failure.notFound',
  'unauthenticated': 'change.failure.unauthenticated',
  'unavailable': 'change.failure.unavailable',
}

const ROLLUP: Record<ChecksRollup, CheckState> = {
  none: 'neutral',
  pending: 'pending',
  success: 'success',
  failure: 'failure',
}

const CHECK_RANK: Record<CheckState, number> = {
  failure: 0, pending: 1, success: 2, neutral: 3, skipped: 3, cancelled: 3,
}

function failureOf(entry: ForgePanelChangeRequest): ForgeFailure | undefined {
  return entry.update !== null && 'failure' in entry.update ? entry.update.failure : undefined
}

/** Failed checks first, then running ones, then the rest, each group in host order. */
function orderedChecks(checks: readonly ChangeRequestCheck[]): ChangeRequestCheck[] {
  return checks.toSorted((left, right) => CHECK_RANK[left.state] - CHECK_RANK[right.state])
}

function checkTime(check: ChangeRequestCheck, t: Translate): string {
  if (check.state === 'pending') return t(check.startedAt === null ? 'change.check.queued' : 'change.check.running')
  const elapsed = checkDuration(check)
  return elapsed === undefined ? '' : formatDuration(elapsed, t)
}

function DiffSize({ snapshot }: { readonly snapshot: ChangeRequestSnapshot }): ReactNode {
  return (
    <span className={css.diff}>
      <span className={css.added}>{`+${snapshot.additions.toLocaleString('en-US')}`}</span>
      <span className={css.deleted}>{`−${snapshot.deletions.toLocaleString('en-US')}`}</span>
    </span>
  )
}

/** The merged or closed fact with its time, such as 已合并到 main · 2 小时前. */
function finished(snapshot: ChangeRequestSnapshot, now: number, t: Translate): string {
  const state = snapshot.state === 'merged' ? t('change.mergedTo', { base: snapshot.baseBranch }) : t('change.state.closed')
  const ago = snapshot.closedAt === null ? undefined : formatAgo(snapshot.closedAt, now, t)
  return ago === undefined ? state : t('time.finished', { state, time: ago })
}

/** Collapsed status after the number: checks and the most urgent flag, the merge or close time, or a read in progress. */
function Summary({ snapshot, now, t }: {
  readonly snapshot: ChangeRequestSnapshot | null
  readonly now: number
  readonly t: Translate
}): ReactNode {
  if (snapshot === null) return <StateDot state="ongoing" size={11} />
  if (snapshot.state !== 'open') {
    return <span className={css.finished} data-tone={snapshot.state}>{finished(snapshot, now, t)}</span>
  }
  const ci = ciSummary(snapshot)
  const flag = flagOf(snapshot)
  return (
    <>
      <span className={css.ci} data-tone={ci.kind === 'failed' ? 'error' : undefined}>
        {ci.kind !== 'none' && <CheckGlyph state={ROLLUP[snapshot.checksRollup]} size={12} />}
        {ci.kind === 'failed'
          ? ci.count > 0 ? t('change.ci.failed', { count: ci.count }) : t('change.ci.failedUnlisted')
          : t(`change.ci.${ci.kind}`)}
      </span>
      {flag !== undefined && <span className={css.flag} data-flag={flag}>{t(`change.flag.${flag}`)}</span>}
    </>
  )
}

/** Expanded identity after the number: draft state and the head and base branches. */
function Target({ snapshot, t }: { readonly snapshot: ChangeRequestSnapshot; readonly t: Translate }): ReactNode {
  return (
    <>
      {snapshot.state === 'open' && snapshot.draft && <span>{t('change.state.draft')}</span>}
      <span className={clsx(css.code, css.ellipsis)}>{`${snapshot.headBranch} → ${snapshot.baseBranch}`}</span>
    </>
  )
}

function ChecksRow({ snapshot, openLink, t }: {
  readonly snapshot: ChangeRequestSnapshot
  readonly openLink: (url: string) => void
  readonly t: Translate
}): ReactNode {
  const [open, setOpen] = useState(false)
  if (snapshot.checks.length === 0) {
    return (
      <div className={css.row}>
        <span className={css.rowLabel}>{t('change.row.checks')}</span>
        <span className={css.rowValue}>{t('change.ci.none')}</span>
      </div>
    )
  }
  const counts = checkCounts(snapshot.checks)
  const summary = [
    ...counts.failed > 0 ? [t('change.checks.failed', { count: counts.failed })] : [],
    ...counts.running > 0 ? [t('change.checks.running', { count: counts.running })] : [],
    ...counts.passed > 0 ? [t('change.checks.passed', { count: counts.passed })] : [],
    ...counts.other > 0 ? [t('change.checks.other', { count: counts.other })] : [],
  ].join(' · ')
  const close = (): void => { setOpen(false) }
  const truncated: MenuEntry[] = [{ type: 'label', id: 'truncated', text: t('change.checks.truncated', { count: snapshot.checks.length }) }]
  return (
    <Menu
      open={open}
      onClose={close}
      portal
      dense
      className={css.checksAnchor}
      listClassName={css.checksList}
      anchor={(
        <button type="button" className={clsx(css.row, css.rowButton)} aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(!open) }}>
          <span className={css.rowLabel}>{t('change.row.checks')}</span>
          <span className={css.rowValue} data-tone={counts.failed > 0 ? 'error' : undefined}>
            <CheckGlyph state={ROLLUP[snapshot.checksRollup]} size={14} />
            <span className={css.ellipsis}>{summary}</span>
          </span>
          <IconChevronDownOutlineRegular size={12} className={clsx(css.chevron, open && css.chevronOpen)} />
        </button>
      )}
      {...snapshot.checksTruncated ? { footer: truncated } : {}}
    >
      {orderedChecks(snapshot.checks).map((check, index) => {
        const { url } = check
        return (
          <MenuItemButton
            // The list is replaced as a whole with each snapshot, and check names can repeat.
            key={index}
            icon={<CheckGlyph state={check.state} />}
            disabled={url === null}
            onSelect={url === null ? close : () => {
              close()
              openLink(url)
            }}
          >
            <span className={css.checkItem}>
              <span className={css.ellipsis}>{check.name}</span>
              <span className={css.checkTime}>{checkTime(check, t)}</span>
            </span>
          </MenuItemButton>
        )
      })}
    </Menu>
  )
}

/** The merge button and its menu: a title row, one row per method with the chosen one checked, and the confirmation. */
function MergeMenu({ snapshot, name, usual, busy, onMerge, t }: {
  readonly snapshot: ChangeRequestSnapshot
  readonly name: string
  readonly usual: MergeMethod
  readonly busy: boolean
  readonly onMerge: (method: MergeMethod) => void
  readonly t: Translate
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<string>(usual)
  // The methods can change between polls; a choice the repository no longer allows falls back to the usual one.
  const method = snapshot.mergeMethods.find(entry => entry === chosen) ?? usual
  const close = (): void => { setOpen(false) }
  const base = snapshot.baseBranch
  const items: MenuEntry[] = [
    { type: 'label', id: 'title', text: t('change.mergeTitle', { name, base }) },
    ...snapshot.mergeMethods.map(entry => ({
      id: entry,
      label: (
        <span className={css.method}>
          <span>{t(`change.mergeMethod.${entry}`)}</span>
          <span className={css.methodNote}>{t(`change.mergeNote.${entry}`, { base })}</span>
        </span>
      ),
    })),
  ]
  return (
    <Menu
      open={open}
      onClose={close}
      portal
      align="end"
      anchor={(
        <Button size="sm" variant="primary" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => { setOpen(!open) }}>
          {t('change.merge')}
          <IconChevronDownOutlineRegular size={12} className={clsx(css.chevron, open && css.chevronOpen)} />
        </Button>
      )}
      items={items}
      selectedId={method}
      onSelect={setChosen}
    >
      <MenuItemButton
        separatorBefore
        onSelect={() => {
          close()
          onMerge(method)
        }}
      >
        {t('change.mergeConfirm')}
      </MenuItemButton>
    </Menu>
  )
}

/** The footer action of an open change request: mark a draft ready, or merge one the host would merge now. */
function Primary({ entry, snapshot, name, actions, t }: {
  readonly entry: ForgePanelChangeRequest
  readonly snapshot: ChangeRequestSnapshot
  readonly name: string
  readonly actions: ChangeRequestActions
  readonly t: Translate
}): ReactNode {
  // One request at a time: the action stays disabled until the previous one settles.
  const [busy, setBusy] = useState(false)
  const run = (action: () => Promise<void>): void => {
    setBusy(true)
    void action().finally(() => { setBusy(false) })
  }
  const { markReady, merge } = actions
  if (snapshot.state !== 'open') return null
  if (snapshot.draft) {
    if (markReady === undefined) return null
    return (
      <Button size="sm" variant="primary" disabled={busy} onClick={() => { run(() => markReady(entry)) }}>
        {t('change.markReady')}
      </Button>
    )
  }
  const [usual] = snapshot.mergeMethods
  if (!snapshot.mergeReady || usual === undefined || merge === undefined) return null
  return (
    <MergeMenu
      snapshot={snapshot}
      name={name}
      usual={usual}
      busy={busy}
      onMerge={(method) => { run(() => merge(entry, { method, headSha: snapshot.headSha })) }}
      t={t}
    />
  )
}

function Details({ snapshot, now, actions, t }: {
  readonly snapshot: ChangeRequestSnapshot
  readonly now: number
  readonly actions: ChangeRequestActions
  readonly t: Translate
}): ReactNode {
  if (snapshot.state !== 'open') {
    return (
      <div className={css.rows}>
        <div className={css.row}>
          <span className={css.rowValue} data-tone={snapshot.state}>{finished(snapshot, now, t)}</span>
        </div>
      </div>
    )
  }
  const review = t(REVIEW[snapshot.reviewDecision])
  const reviewTone = snapshot.reviewDecision === 'changes-requested' ? 'error' : snapshot.reviewDecision === 'approved' ? 'success' : undefined
  const merge = snapshot.mergeability === 'mergeable'
    ? t('change.merge.mergeable')
    : snapshot.mergeability === 'conflicting' ? t('change.merge.conflicting', { base: snapshot.baseBranch }) : t('change.merge.unknown')
  return (
    <div className={css.rows}>
      <ChecksRow snapshot={snapshot} openLink={actions.openLink} t={t} />
      <div className={css.row}>
        <span className={css.rowLabel}>{t('change.row.review')}</span>
        <span className={css.rowValue} data-tone={reviewTone}>
          {snapshot.unresolvedThreads > 0 ? t('change.review.threads', { review, count: snapshot.unresolvedThreads }) : review}
        </span>
      </div>
      <div className={css.row}>
        <span className={css.rowLabel}>{t('change.row.merge')}</span>
        <span className={css.rowValue} data-tone={snapshot.mergeability === 'conflicting' ? 'error' : undefined}>{merge}</span>
      </div>
    </div>
  )
}

/**
 * Render one change request.
 * @param props - change request, expansion, current time, actions, and copy.
 * @returns the card.
 */
export function ChangeRequestCard({ entry, expanded, onToggle, now, actions, t }: ChangeRequestCardProps): ReactNode {
  const snapshot = entry.snapshot
  const number = numberOf(entry)
  const url = snapshot?.url ?? entry.url
  const failure = failureOf(entry)
  const notice = entry.ref === null ? 'change.unserved' : failure === undefined ? undefined : FAILURE[failure.code]
  const tone = toneOf(snapshot)
  const name = number === null ? snapshot?.title ?? url : t('change.number', { number })
  // A notice replaces the collapsed summary, so a failed read never shows its stale status beside it.
  const meta = expanded
    ? snapshot === null ? null : <Target snapshot={snapshot} t={t} />
    : notice === undefined ? <Summary snapshot={snapshot} now={now} t={t} /> : null
  const { remove } = actions
  return (
    <li className={css.change} data-forge-change={entry.url} data-expanded={expanded ? '' : undefined}>
      <div className={css.changeHead}>
        <ChangeRequestGlyph tone={tone} label={t('change.stateAria', { state: t(STATE[tone]) })} />
        <div className={css.headText}>
          <a
            className={css.changeTitle}
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault()
              actions.openLink(url)
            }}
          >
            {snapshot?.title ?? url.replace(/^https?:\/\//i, '')}
          </a>
          {(number !== null || meta !== null) && (
            <div className={css.meta}>
              {number !== null && <span className={css.code}>{t('change.number', { number })}</span>}
              {number !== null && meta !== null && <span aria-hidden="true">·</span>}
              {meta}
            </div>
          )}
        </div>
        {expanded && (
          <Tooltip label={t('change.view')} side="top">
            <button type="button" className={css.iconButton} aria-label={t('change.view')} onClick={() => { actions.openLink(url) }}>
              <IconRightUpOutlineRegular size={14} />
            </button>
          </Tooltip>
        )}
        {expanded && remove !== undefined && (
          <Tooltip label={t('change.remove')} side="top">
            <button type="button" className={css.iconButton} aria-label={t('change.removeAria', { name })} onClick={() => { remove(entry) }}>
              <IconCloseOutlineRegular size={14} />
            </button>
          </Tooltip>
        )}
        <button
          type="button"
          className={css.iconButton}
          aria-expanded={expanded}
          aria-label={t(expanded ? 'change.collapse' : 'change.expand', { name })}
          onClick={onToggle}
        >
          <IconChevronDownOutlineRegular size={12} className={clsx(css.chevron, expanded && css.chevronOpen)} />
        </button>
      </div>
      {notice !== undefined && (
        <div className={css.notice}>
          <span>{t(notice)}</span>
          {entry.ref === null
            ? <Button size="sm" variant="outline" onClick={() => { actions.openLink(url) }}>{t('change.view')}</Button>
            : <Button size="sm" variant="outline" onClick={actions.retry}>{t('retry')}</Button>}
        </div>
      )}
      {expanded && snapshot !== null && <Details snapshot={snapshot} now={now} actions={actions} t={t} />}
      {expanded && (
        <div className={css.footer}>
          {snapshot !== null && <DiffSize snapshot={snapshot} />}
          <Tooltip label={t('change.copy')} side="top">
            <button type="button" className={clsx(css.iconButton, css.footerEnd)} aria-label={t('change.copy')} onClick={() => { actions.copyLink(url) }}>
              <IconCopyOutlineRegular size={14} />
            </button>
          </Tooltip>
          {snapshot !== null && <Primary entry={entry} snapshot={snapshot} name={name} actions={actions} t={t} />}
        </div>
      )}
    </li>
  )
}

/** One change request as a collapsible card: a status summary, and its details and actions when expanded. */

import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, IconBranchOutlineRegular, IconCheckOutlineRegular, IconChecklistOutlineRegular, IconChevronDownOutlineRegular,
  IconCloseOutlineRegular, IconContextInjectionOutlineRegular, IconCopyOutlineRegular, IconInfoOutlineRegular,
  IconRightUpOutlineRegular, IconTrashOutlineRegular, IconUsersOutlineRegular, StateDot, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { ChangeRequestCheck, ChangeRequestSnapshot, ForgeFailure } from '@deepseek-ai/dsh-experimental-forge/types'
import type { BindingOrigin } from '@deepseek-ai/dsh-experimental-forge-session/types'
import type { ForgePanelChangeRequest } from '../types.ts'
import { formatAgo, formatDuration } from './format.ts'
import type { ForgePanelKey, NS } from './locales.ts'
import { checkCounts, checkDuration, ciSummary, flagOf, numberOf, toneOf } from './status.ts'
import css from './ForgeTab.module.css'

type Translate = PropsLocale<typeof NS>['t']

/** What a card can do; a surface without a composer or Session binding omits the optional actions. */
export interface ChangeRequestActions {
  /** Open a URL outside the app. */
  readonly openLink: (url: string) => void
  /** Copy a URL to the clipboard. */
  readonly copyLink: (url: string) => void
  /** Read the status again after a failed read. */
  readonly retry: () => void
  /** Insert the change request URL into the composer. */
  readonly addToChat?: ((url: string) => void) | undefined
  /** Remove the change request from its Session. */
  readonly remove?: ((entry: ForgePanelChangeRequest) => void) | undefined
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

const ORIGIN: Record<BindingOrigin, ForgePanelKey> = {
  created: 'change.origin.created',
  discovered: 'change.origin.discovered',
  tracked: 'change.origin.tracked',
}

const REVIEW: Record<ChangeRequestSnapshot['reviewDecision'], ForgePanelKey> = {
  'approved': 'change.review.approved',
  'changes-requested': 'change.review.changesRequested',
  'review-required': 'change.review.required',
  'none': 'change.review.none',
}

const MERGE: Record<ChangeRequestSnapshot['mergeability'], ForgePanelKey> = {
  mergeable: 'change.merge.mergeable',
  conflicting: 'change.merge.conflicting',
  unknown: 'change.merge.unknown',
}

const FAILURE: Record<ForgeFailure['code'], ForgePanelKey> = {
  'not-found': 'change.failure.notFound',
  'unauthenticated': 'change.failure.unauthenticated',
  'unavailable': 'change.failure.unavailable',
}

function stateKey(snapshot: ChangeRequestSnapshot): ForgePanelKey {
  if (snapshot.state === 'open') return snapshot.draft ? 'change.state.draft' : 'change.state.open'
  return snapshot.state === 'merged' ? 'change.state.merged' : 'change.state.closed'
}

function failureOf(entry: ForgePanelChangeRequest): ForgeFailure | undefined {
  return entry.update !== null && 'failure' in entry.update ? entry.update.failure : undefined
}

function Diff({ snapshot }: { readonly snapshot: ChangeRequestSnapshot }): ReactNode {
  return (
    <span className={css.diff}>
      <span className={css.added}>{`+${String(snapshot.additions)}`}</span>
      <span className={css.deleted}>{`−${String(snapshot.deletions)}`}</span>
    </span>
  )
}

function Ci({ snapshot, t }: { readonly snapshot: ChangeRequestSnapshot; readonly t: Translate }): ReactNode {
  const ci = ciSummary(snapshot)
  switch (ci.kind) {
    case 'none': return <span className={css.ci}>{t('change.ci.none')}</span>
    case 'running': return <span className={css.ci}><StateDot state="ongoing" size={11} />{t('change.ci.running')}</span>
    case 'passed': return <span className={css.ci}><StateDot state="done" size={7} />{t('change.ci.passed')}</span>
    case 'failed': return (
      <span className={css.ci} data-tone="error">
        <StateDot state="error" size={7} />
        {ci.count > 0 ? t('change.ci.failed', { count: ci.count }) : t('change.ci.failedUnlisted')}
      </span>
    )
    /* v8 ignore next -- closed CiSummary kind union exhaustiveness guard */
    default: return assertNever(ci, 'CiSummary.kind')
  }
}

/** Status line inside the toggle: diff size, then checks and the open-state flag, or the merge or close time. */
function Summary({ entry, now, t }: { readonly entry: ForgePanelChangeRequest; readonly now: number; readonly t: Translate }): ReactNode {
  const snapshot = entry.snapshot
  if (entry.ref === null || failureOf(entry) !== undefined) return null
  if (snapshot === null) {
    return <span className={css.summary}><span className={css.ci}><StateDot state="ongoing" size={11} />{t('change.loading')}</span></span>
  }
  if (snapshot.state !== 'open') {
    const ago = snapshot.closedAt === null ? undefined : formatAgo(snapshot.closedAt, now, t)
    const state = t(stateKey(snapshot))
    return (
      <span className={css.summary}>
        <Diff snapshot={snapshot} />
        <span className={css.finished} data-tone={snapshot.state}>{ago === undefined ? state : t('time.finished', { state, time: ago })}</span>
      </span>
    )
  }
  const flag = flagOf(snapshot)
  return (
    <span className={css.summary}>
      <Diff snapshot={snapshot} />
      <Ci snapshot={snapshot} t={t} />
      {flag !== undefined && <span className={css.flag} data-flag={flag}>{t(`change.flag.${flag}`)}</span>}
    </span>
  )
}

function CheckIcon({ check }: { readonly check: ChangeRequestCheck }): ReactNode {
  switch (check.state) {
    case 'success': return <IconCheckOutlineRegular size={13} className={css.pass} />
    case 'failure': return <IconCloseOutlineRegular size={13} className={css.fail} />
    case 'pending': return <StateDot state="ongoing" size={12} />
    case 'neutral':
    case 'skipped':
    case 'cancelled': return <StateDot state="idle" size={7} />
    /* v8 ignore next -- closed CheckState union exhaustiveness guard */
    default: return assertNever(check.state, 'ChangeRequestCheck.state')
  }
}

const CHECK_RANK: Record<ChangeRequestCheck['state'], number> = {
  failure: 0, pending: 1, success: 2, neutral: 3, skipped: 3, cancelled: 3,
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

function Checks({ snapshot, openLink, t }: {
  readonly snapshot: ChangeRequestSnapshot
  readonly openLink: (url: string) => void
  readonly t: Translate
}): ReactNode {
  const [open, setOpen] = useState(false)
  const counts = checkCounts(snapshot.checks)
  if (snapshot.checks.length === 0) {
    return <Row icon={<IconChecklistOutlineRegular size={15} />} label={t('change.row.checks')} value={t('change.ci.none')} />
  }
  const summary = [
    ...counts.failed > 0 ? [t('change.checks.failed', { count: counts.failed })] : [],
    ...counts.running > 0 ? [t('change.checks.running', { count: counts.running })] : [],
    ...counts.passed > 0 ? [t('change.checks.passed', { count: counts.passed })] : [],
    ...counts.other > 0 ? [t('change.checks.other', { count: counts.other })] : [],
  ].join(' · ')
  return (
    <>
      <button type="button" className={css.item} aria-expanded={open} onClick={() => { setOpen(!open) }}>
        <IconChecklistOutlineRegular size={15} />
        <span>{t('change.row.checks')}</span>
        <span className={css.value} data-tone={counts.failed > 0 ? 'error' : undefined}>{summary}</span>
        <IconChevronDownOutlineRegular size={12} className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>
      {open && (
        <ul className={css.checks}>
          {orderedChecks(snapshot.checks).map((check, index) => {
            const body = (
              <>
                <CheckIcon check={check} />
                <span className={clsx(css.code, css.ellipsis)}>{check.name}</span>
                <span className={css.value}>{checkTime(check, t)}</span>
              </>
            )
            const url = check.url
            return (
              <li key={`${String(index)}:${check.name}`}>
                {url === null
                  ? <div className={css.check}>{body}</div>
                  : <button type="button" className={css.check} onClick={() => { openLink(url) }}>{body}</button>}
              </li>
            )
          })}
          {snapshot.checksTruncated && <li className={css.truncated}>{t('change.checks.truncated', { count: snapshot.checks.length })}</li>}
        </ul>
      )}
    </>
  )
}

function Row({ icon, label, value, tone }: {
  readonly icon: ReactNode
  readonly label: string
  readonly value: string
  readonly tone?: 'error' | undefined
}): ReactNode {
  return (
    <div className={css.item} data-static="">
      {icon}
      <span>{label}</span>
      <span className={css.value} data-tone={tone}>{value}</span>
    </div>
  )
}

function Details({ entry, url, actions, t }: {
  readonly entry: ForgePanelChangeRequest
  readonly url: string
  readonly actions: ChangeRequestActions
  readonly t: Translate
}): ReactNode {
  const snapshot = entry.snapshot
  const { addToChat, remove } = actions
  const review = snapshot === null ? '' : t(REVIEW[snapshot.reviewDecision])
  return (
    <div className={css.details}>
      <div className={css.linkRow}>
        <button type="button" className={css.item} onClick={() => { actions.openLink(url) }}>
          <IconRightUpOutlineRegular size={15} />
          <span>{t('change.view')}</span>
        </button>
        <Tooltip label={t('change.copy')} side="top">
          <button type="button" className={css.iconButton} aria-label={t('change.copy')} onClick={() => { actions.copyLink(url) }}>
            <IconCopyOutlineRegular size={14} />
          </button>
        </Tooltip>
      </div>
      {snapshot !== null && (
        <>
          <Row icon={<IconInfoOutlineRegular size={15} />} label={t('change.row.state')} value={`${t(stateKey(snapshot))} · ${t(ORIGIN[entry.origin])}`} />
          <Checks snapshot={snapshot} openLink={actions.openLink} t={t} />
          <Row
            icon={<IconUsersOutlineRegular size={15} />}
            label={t('change.row.review')}
            value={snapshot.unresolvedThreads > 0 ? t('change.review.threads', { review, count: snapshot.unresolvedThreads }) : review}
            tone={snapshot.reviewDecision === 'changes-requested' ? 'error' : undefined}
          />
          <Row
            icon={<IconBranchOutlineRegular size={15} />}
            label={t('change.row.merge')}
            value={snapshot.state === 'open' ? t(MERGE[snapshot.mergeability]) : t(stateKey(snapshot))}
            tone={snapshot.state === 'open' && snapshot.mergeability === 'conflicting' ? 'error' : undefined}
          />
        </>
      )}
      {(addToChat !== undefined || remove !== undefined) && <div className={css.separator} role="separator" />}
      {addToChat !== undefined && (
        <button type="button" className={css.item} onClick={() => { addToChat(url) }}>
          <IconContextInjectionOutlineRegular size={15} />
          <span>{t('change.addToChat')}</span>
        </button>
      )}
      {remove !== undefined && (
        <button type="button" className={css.item} data-tone="error" onClick={() => { remove(entry) }}>
          <IconTrashOutlineRegular size={15} />
          <span>{t('change.remove')}</span>
        </button>
      )}
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
  return (
    <li className={css.change} data-forge-change={entry.url}>
      <button type="button" className={css.changeHead} aria-expanded={expanded} onClick={onToggle}>
        <span className={css.headRow}>
          <span className={css.glyph} data-tone={toneOf(snapshot)} aria-hidden="true"><IconBranchOutlineRegular size={15} /></span>
          <span className={css.changeTitle}>{snapshot?.title ?? entry.url.replace(/^https?:\/\//i, '')}</span>
          <IconChevronDownOutlineRegular size={12} className={clsx(css.chevron, expanded && css.chevronOpen)} />
        </span>
        {(number !== null || snapshot !== null) && (
          <span className={css.metaRow}>
            {number !== null && <span className={css.code}>{t('change.number', { number })}</span>}
            {number !== null && snapshot !== null && <span aria-hidden="true">·</span>}
            {snapshot !== null && <span className={clsx(css.code, css.ellipsis)}>{snapshot.headBranch}</span>}
          </span>
        )}
        <Summary entry={entry} now={now} t={t} />
      </button>
      {notice !== undefined && (
        <div className={css.notice}>
          <span>{t(notice)}</span>
          {entry.ref === null
            ? <Button size="sm" variant="outline" onClick={() => { actions.openLink(url) }}>{t('change.view')}</Button>
            : <Button size="sm" variant="outline" onClick={actions.retry}>{t('retry')}</Button>}
        </div>
      )}
      {expanded && <Details entry={entry} url={url} actions={actions} t={t} />}
    </li>
  )
}

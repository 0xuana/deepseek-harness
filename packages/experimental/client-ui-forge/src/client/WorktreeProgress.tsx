/** Card above the composer while a Session's worktree is created, after a failed creation, and when its worktree is gone. */

import { useState, type ReactNode } from 'react'
import {
  Button, IconBranchOutlineRegular, IconCheckOutlineRegular, IconChevronRightOutlineRegular, IconCloseOutlineRegular, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { ForgeMissingWorktree, ForgePanelWorktree, ForgeSessionWorktree } from '../types.ts'
import type { ForgePanelKey, NS } from './locales.ts'
import type { PanelSnapshot } from './source.ts'
import css from './WorktreeProgress.module.css'

/** Business face of the card. */
export interface WorktreeProgressInjected {
  /** Panel snapshot of the Session; the renderer binds it as `usePanel`. */
  readonly hooks: { readonly panel: HostObservable<PanelSnapshot> }
  /** Stop the creation that holds the Session's message, which returns the message to the composer. */
  readonly stop: () => void
  /** Withdraw the worktree request after a failed creation, so the message can go without a worktree. */
  readonly withdraw: () => void
  /**
   * Check out the removed worktree again.
   * @returns the failure text, or undefined once it is restored.
   */
  readonly restore: () => Promise<string | undefined>
  /** Move the Session back to the source checkout of its removed worktree. */
  readonly leave: () => void
}

/** Full props of the card. */
export type WorktreeProgressProps = InjectFace<WorktreeProgressInjected> & PropsLocale<typeof NS>

type Translate = WorktreeProgressProps['t']

type StepState = 'done' | 'running' | 'waiting' | 'failed'

const STEPS: readonly { readonly phase: 'prepare' | 'checkout'; readonly label: ForgePanelKey }[] = [
  { phase: 'prepare', label: 'creation.prepare' },
  { phase: 'checkout', label: 'creation.checkout' },
]

function stepState(current: 'prepare' | 'checkout', failed: boolean, phase: 'prepare' | 'checkout'): StepState {
  if (phase === current) return failed ? 'failed' : 'running'
  return phase === 'prepare' ? 'done' : 'waiting'
}

function StepIcon({ state }: { readonly state: StepState }): ReactNode {
  switch (state) {
    case 'done': return <IconCheckOutlineRegular size={14} className={css.done} />
    case 'running': return <StateDot state="ongoing" size={14} />
    case 'failed': return <IconCloseOutlineRegular size={14} className={css.failed} />
    case 'waiting': return <span className={css.waiting} aria-hidden="true" />
    /* v8 ignore next -- closed StepState union exhaustiveness guard */
    default: return assertNever(state, 'StepState')
  }
}

/** One creation as the card shows it: the running step, or the failed one with its failure text. */
interface CreationView {
  readonly phase: 'prepare' | 'checkout'
  readonly branch: string | null
  readonly from: string | null
  /** Failure text, or null while the creation runs. */
  readonly message: string | null
  /** Whether a message waits for the running creation, which can then be stopped. */
  readonly held: boolean
}

/** The running creation, else the last failed one, or undefined without either. */
function creationOf(worktree: ForgePanelWorktree): CreationView | undefined {
  const { creation, failure } = worktree
  if (creation !== null) return { ...creation, message: null }
  return failure === null ? undefined : { ...failure, held: false }
}

function Details({ creation, t }: { readonly creation: CreationView; readonly t: Translate }): ReactNode {
  return (
    <dl className={css.details}>
      {creation.branch !== null && (
        <>
          <dt>{t('creation.branch')}</dt>
          <dd className={css.code}>{creation.branch}</dd>
        </>
      )}
      <dt>{t('creation.base')}</dt>
      <dd className={css.code}>{creation.from ?? t('creation.head')}</dd>
      {creation.message !== null && (
        <>
          <dt>{t('creation.error')}</dt>
          <dd className={css.message}>{creation.message}</dd>
        </>
      )}
    </dl>
  )
}

function CreationCard({ creation, stop, withdraw, t }: {
  readonly creation: CreationView
  readonly stop: WorktreeProgressInjected['stop']
  readonly withdraw: WorktreeProgressInjected['withdraw']
  readonly t: Translate
}): ReactNode {
  const [open, setOpen] = useState(false)
  const failed = creation.message !== null
  const expanded = open || failed
  return (
    <div className={css.dock} data-forge-creation={failed ? 'failed' : creation.phase}>
      <section className={css.card} aria-label={t(failed ? 'creation.failed' : 'creation.title')} aria-busy={!failed}>
        <div className={css.header}>
          <IconBranchOutlineRegular size={14} className={css.glyph} />
          <span className={css.title}>{t(failed ? 'creation.failed' : 'creation.title')}</span>
          {creation.branch !== null && <span className={css.branch}>{creation.branch}</span>}
        </div>
        <ul className={css.steps}>
          {STEPS.map(step => (
            <li key={step.phase} className={css.step} data-state={stepState(creation.phase, failed, step.phase)}>
              <StepIcon state={stepState(creation.phase, failed, step.phase)} />
              <span>{t(step.label)}</span>
            </li>
          ))}
        </ul>
        {expanded && <Details creation={creation} t={t} />}
        {failed && <p className={css.note}>{t('creation.retryHint')}</p>}
        <div className={css.footer}>
          {!failed && (
            <button type="button" className={css.disclosure} aria-expanded={open} onClick={() => { setOpen(!open) }}>
              <IconChevronRightOutlineRegular size={12} className={open ? css.chevronOpen : css.chevron} />
              {t('creation.details')}
            </button>
          )}
          {failed && (
            <span className={css.actions}>
              <Button size="sm" variant="ghost" onClick={withdraw}>{t('creation.skip')}</Button>
            </span>
          )}
          {creation.held && (
            <span className={css.actions}>
              <Button size="sm" variant="ghost" icon={<IconCloseOutlineRegular size={14} />} onClick={stop}>{t('creation.cancel')}</Button>
            </span>
          )}
        </div>
      </section>
    </div>
  )
}

function MissingCard({ created, missing, restore, leave, t }: {
  readonly created: ForgeSessionWorktree
  readonly missing: ForgeMissingWorktree
  readonly restore: WorktreeProgressInjected['restore']
  readonly leave: WorktreeProgressInjected['leave']
  readonly t: Translate
}): ReactNode {
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const start = (): void => {
    setRestoring(true)
    setError(null)
    void restore().then(
      (failure) => {
        setRestoring(false)
        setError(failure ?? null)
      },
      (failure: unknown) => {
        setRestoring(false)
        setError(failure instanceof Error ? failure.message : String(failure))
      },
    )
  }
  return (
    <div className={css.dock} data-forge-missing="">
      <section className={css.card} aria-label={t('missing.title')}>
        <div className={css.header}>
          <IconBranchOutlineRegular size={14} className={css.warning} />
          <span className={css.title}>{t('missing.title')}</span>
          <span className={css.branch}>{created.branch}</span>
        </div>
        <p className={css.note}>{t(missing.branchExists ? 'missing.kept' : 'missing.recreated', { branch: created.branch })}</p>
        {error !== null && <p className={css.error}>{error}</p>}
        <div className={css.footer}>
          <span className={css.actions}>
            <Button size="sm" variant="primary" disabled={restoring} onClick={start}>{t('missing.restore')}</Button>
            <Button size="sm" variant="ghost" disabled={restoring} onClick={leave}>{t('missing.leave')}</Button>
          </span>
        </div>
      </section>
    </div>
  )
}

/**
 * Render the worktree card of a Session: the running creation of its
 * requested worktree, which can be stopped while a message waits for it; the
 * last failed creation, after which sending the message again tries again or
 * withdrawing the request lets it go without a worktree; or the removal of the
 * worktree the Session works in, with restoring it and returning to the source
 * checkout.
 * @param props - panel hook, actions, and copy.
 * @returns the card, or nothing while no creation runs or failed and the worktree exists.
 */
export function WorktreeProgress({ usePanel, stop, withdraw, restore, leave, t }: WorktreeProgressProps): ReactNode {
  const worktree = usePanel(snapshot => snapshot.state?.worktree ?? null)
  if (worktree === null) return null
  const creation = creationOf(worktree)
  if (creation !== undefined) return <CreationCard creation={creation} stop={stop} withdraw={withdraw} t={t} />
  if (worktree.missing === null || worktree.created === null) return null
  return <MissingCard created={worktree.created} missing={worktree.missing} restore={restore} leave={leave} t={t} />
}

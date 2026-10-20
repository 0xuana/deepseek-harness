/** Completed-answer creation card with location selection and undo. */
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Button, IconInfoOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { CreationRecommendation, CreationActionResult, CreationSlot } from '@deepseek-ai/dsh-experimental-creation-recommendations/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { RecommendationKey } from './locales.ts'
import type {} from './definition.ts'
import css from './Card.module.css'

/** Session-bound user actions; installation paths remain Host-owned. */
export interface CardInjected {
  act: (callId: ToolCallId, action: 'create' | 'dismiss' | 'keep' | 'undo' | 'cancel', slot: CreationSlot) => Promise<CreationActionResult | undefined>
}

/** Proposals indexed by their originating turn. */
export interface RecommendationTailInjected extends CardInjected {
  keyedHooks: { recommendations: (turn: string) => ObservableSnapshot<readonly CreationRecommendation[]> }
}

type CardProps = { recommendation: CreationRecommendation } & Pick<PropsRuntime<'conversation.chat.turnTail'>, 'useProjection'>
  & PropsLocale<'creationRecommendations'> & InjectFace<CardInjected>

/** Keep long plans compact without truncating the brief sent to Creator. */
function CreationPlan({ brief, t }: { brief: string } & PropsLocale<'creationRecommendations'>) {
  const ref = useRef<HTMLParagraphElement>(null)
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  // Browser clamp measurement is shared idiom; this card owns its plan formatting and lifetime.
  /* jscpd:ignore-start */
  useLayoutEffect(() => {
    if (expanded) return
    const paragraph = ref.current as HTMLParagraphElement
    const measure = () => { setClamped(paragraph.scrollHeight > paragraph.clientHeight) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(paragraph)
    return () => { observer.disconnect() }
  }, [expanded, brief])
  /* jscpd:ignore-end */
  return <>
    <p ref={ref} id={id} className={css.reason} data-expanded={expanded || undefined}>{expanded ? brief : brief.replace(/\s+/g, ' ').trim()}</p>
    {clamped && <Button variant="ghost" size="sm" className={css.planToggle} aria-expanded={expanded} aria-controls={id}
      onClick={() => { setExpanded(value => !value) }}>{t(expanded ? 'collapsePlan' : 'expandPlan')}</Button>}
  </>
}

/** Place one card after the complete answer.
 * @param props - Completed turn and its session-bound proposals.
 * @returns the first proposal, or null.
 */
// Each optional bundle owns its card and locale contracts; this small tail wrapper does not warrant a shared package.
/* jscpd:ignore-start */
export function RecommendationTail({ turn, useRecommendations, ...props }: Pick<PropsRuntime<'conversation.chat.turnTail'>, 'turn' | 'useProjection'>
  & PropsLocale<'creationRecommendations'> & InjectFace<RecommendationTailInjected>) {
  const recommendation = useRecommendations(String(turn.turn))?.[0]
  return recommendation === undefined || turn.end?.data.reason.kind !== 'completed' || turn.data.get('turn-tail')?.closing == null
    ? null : <RecommendationCard {...props} recommendation={recommendation} />
}
/* jscpd:ignore-end */

/** Display creation, persistent installation, and reversible removal.
 * @param props - Proposal, receipts and human actions.
 * @returns the creation card.
 */
export function RecommendationCard({ recommendation, useProjection, act, t }: CardProps) {
  const view = useProjection('creationRecommendations')
  const decision = view?.decisions[recommendation.callId]
  const [selected, setSelected] = useState<CreationSlot>()
  const [options, setOptions] = useState(false)
  const [info, setInfo] = useState(false)
  const infoId = useId()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<RecommendationKey>()
  const slot = selected ?? decision?.slot ?? recommendation.slot
  const offer = decision === undefined || decision.phase === 'cancelled' || decision.phase === 'failed' || decision.phase === 'interrupted' || decision.phase === 'unconfirmed'
  const installed = decision?.phase === 'installed' || decision?.phase === 'kept'
  const run = async (action: 'create' | 'dismiss' | 'keep' | 'undo' | 'cancel') => {
    setPending(true)
    setError(undefined)
    // Independent optional cards keep their action and receipt handling local.
    /* jscpd:ignore-start */
    try {
      const result = await act(recommendation.callId, action, slot)
      if (result === undefined) setError('transport')
      else if (result.status === 'refused' || result.status === 'unconfirmed') setError(result.reason)
    } catch {
      // A lost reply does not prove failure; replay supplies the durable receipt.
      setError('transport')
    } finally { setPending(false) }
    /* jscpd:ignore-end */
  }
  return <section className={css.card} aria-label={t('heading')} data-creation-recommendation={recommendation.callId}>
    <header className={css.header}><span className={css.heading}>{t('heading')}
      <Tooltip label={t('creationInfo')} side="top" portal disabled={info}>
        <Button variant="ghost" size="sm" className={css.infoButton} aria-label={t('creationInfo')}
          aria-expanded={info} aria-controls={infoId} onClick={() => { setInfo(value => !value) }}>
          <IconInfoOutlineRegular size={14} />
        </Button>
      </Tooltip>
    </span>
    {decision === undefined ? <span>{t('newPlugin')}</span>
      : <span role="status" className={css.phase} data-phase={decision.phase}>{t(decision.phase)}</span>}
    </header>
    {info && <div id={infoId} role="note" className={css.info}>
      <p>{t('creationMethod')}</p>
      <p><strong>{t('creationCost')}</strong></p>
      <p>{t('creationBackground')}</p>
    </div>}
    <div className={css.body}>
      <strong className={css.title}>{recommendation.title}</strong>
      <CreationPlan brief={recommendation.brief} t={t} />
      <p className={css.description}>{t('location')} · {t(slot)}</p>
      {decision?.application !== undefined && decision.application !== 'applied'
        && <p role="status" className={css.status}>{t(decision.application)}</p>}
      {error !== undefined && <p role="alert" className={css.status}>{t(error)}</p>}
      {offer && <>
        {options && <fieldset className={css.locations}>
          <legend>{t('location')}</legend>
          {(['sidebar-right', 'page', 'sidebar-left'] as const).map(value => <label key={value}>
            <input type="radio" name={recommendation.callId} value={value} checked={slot === value}
              disabled={pending} onChange={() => { setSelected(value) }} />{t(value)}
          </label>)}
        </fieldset>}
        <footer className={css.footer}>
          <Button variant="ghost" size="sm" aria-expanded={options} disabled={pending} onClick={() => { setOptions(value => !value) }}>{t('options')}</Button>
          <div className={css.actions}>
            <Button variant="ghost" size="sm" disabled={pending || view === undefined} onClick={() => { void run('dismiss') }}>{t('dismiss')}</Button>
            <Button variant="primary" size="sm" disabled={pending || view === undefined} onClick={() => { void run('create') }}>
              {t(pending ? 'starting' : decision === undefined ? 'create' : 'retry')}
            </Button>
          </div>
        </footer>
      </>}
      {decision?.phase === 'creating' && <footer className={css.footer}>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => { void run('cancel') }}>{t(pending ? 'cancelling' : 'cancel')}</Button>
      </footer>}
      {installed && <footer className={css.footer}>
        <span className={css.scope}>{t('scope')}</span>
        <div className={css.actions}>
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => { void run('undo') }}>{t('undo')}</Button>
          {decision.phase !== 'kept' && <Button variant="primary" size="sm" disabled={pending} onClick={() => { void run('keep') }}>{t('keep')}</Button>}
        </div>
      </footer>}
      {decision?.bundleName !== undefined && <p className={css.status}>{t('sourceRetained')}</p>}
    </div>
  </section>
}

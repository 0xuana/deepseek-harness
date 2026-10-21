/** Completed-answer creation card with location selection and undo. */
import { useId, useMemo, useState } from 'react'
import { Button, IconChevronDownOutlineRegular, IconInfoOutlineRegular, Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { CreationRecommendation, CreationActionResult, CreationSlot } from '@deepseek-ai/dsh-experimental-creation-recommendations/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { RecommendationKey } from './locales.ts'
import type {} from './definition.ts'
import css from './Card.module.css'

/** Session-bound user actions; installation paths remain Host-owned. */
export interface CardInjected {
  act: (callId: ToolCallId, action: 'create' | 'dismiss' | 'keep' | 'undo' | 'cancel', slot: CreationSlot, customLocation?: string) => Promise<CreationActionResult | undefined>
  hooks: { infoDismissed: ObservableSnapshot<boolean> }
  dismissInfo: () => void
}

/** Proposals indexed by their originating turn. */
export interface RecommendationTailInjected extends CardInjected {
  keyedHooks: { recommendations: (turn: string) => ObservableSnapshot<readonly CreationRecommendation[]> }
}

type CardProps = { recommendation: CreationRecommendation } & Pick<PropsRuntime<'conversation.chat.turnTail'>, 'useProjection'>
  & PropsLocale<'creationRecommendations'> & InjectFace<CardInjected>

type LocationChoice = CreationSlot | 'custom'

function LocationPicker({ value, disabled, onChange, t }: {
  value: LocationChoice
  disabled: boolean
  onChange: (value: LocationChoice) => void
} & PropsLocale<'creationRecommendations'>) {
  const [open, setOpen] = useState(false)
  return <Menu open={open && !disabled} portal autoFocus compact
    listClassName={css.locationMenu} selectedId={value}
    onClose={() => { setOpen(false) }}
    onSelect={(id) => { onChange(id as LocationChoice); setOpen(false) }}
    items={(['sidebar-right', 'page', 'sidebar-left', 'custom'] as const).map(id => ({
      id, label: <span className={css.locationOption}><span>{t(id)}</span><span>{t(`${id}Hint`)}</span></span>,
    }))}
    anchor={<Button variant="outline" size="sm" disabled={disabled} className={css.locationButton}
      aria-label={`${t('location')}: ${t(value)}`} aria-haspopup="menu" aria-expanded={open && !disabled}
      onClick={() => { setOpen(current => !current) }}>
      {t(value)}<IconChevronDownOutlineRegular size={14} />
    </Button>} />
}

/** Fold omitted text without measuring layout; the full text is never altered. */
function FoldedText({ text, expandLabel, collapseLabel }: { text: string; expandLabel: string; collapseLabel: string }) {
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  const preview = useMemo(() => {
    const compact = text.replace(/\s+/g, ' ').trim()
    const characters = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(compact), part => part.segment)
    return characters.length > 80 ? characters.slice(0, 80).join('').trimEnd() + '…' : undefined
  }, [text])
  return <>
    <p id={id} className={css.reason}>{expanded || preview === undefined ? text : preview}</p>
    {preview !== undefined && <Button variant="ghost" size="sm" className={css.planToggle} aria-expanded={expanded} aria-controls={id}
      onClick={() => { setExpanded(value => !value) }}>{expanded ? collapseLabel : expandLabel}</Button>}
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
export function RecommendationCard({ recommendation, useProjection, act, useInfoDismissed, dismissInfo, t }: CardProps) {
  const view = useProjection('creationRecommendations')
  const decision = view?.decisions[recommendation.callId]
  const [selected, setSelected] = useState<LocationChoice>()
  const [custom, setCustom] = useState<string>()
  const [info, setInfo] = useState<boolean>()
  const infoDismissed = useInfoDismissed(value => value)
  const infoId = useId()
  const customId = useId()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<RecommendationKey>()
  const slot = selected !== undefined && selected !== 'custom' ? selected : decision?.slot ?? recommendation.slot
  const location = selected ?? (decision?.customLocation === undefined ? slot : 'custom')
  const customLocation = custom ?? decision?.customLocation ?? ''
  const offer = decision === undefined || decision.phase === 'cancelled' || decision.phase === 'failed' || decision.phase === 'interrupted' || decision.phase === 'unconfirmed'
  const infoOpen = info ?? (offer && !infoDismissed)
  const installed = decision?.phase === 'installed' || decision?.phase === 'kept'
  const run = async (action: 'create' | 'dismiss' | 'keep' | 'undo' | 'cancel') => {
    setPending(true)
    setError(undefined)
    if (action === 'create' || action === 'dismiss') { dismissInfo(); setInfo(false) }
    // Independent optional cards keep their action and receipt handling local.
    /* jscpd:ignore-start */
    try {
      const result = await act(recommendation.callId, action, slot, location === 'custom' ? customLocation.trim() : undefined)
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
      <Tooltip label={t('creationInfo')} side="top" portal disabled={infoOpen}>
        <Button variant="ghost" size="sm" className={css.infoButton} aria-label={t('creationInfo')}
          aria-expanded={infoOpen} aria-controls={infoId} onClick={() => {
            setInfo(!infoOpen)
            if (infoOpen) dismissInfo()
          }}>
          <IconInfoOutlineRegular size={14} />
        </Button>
      </Tooltip>
    </span>
    {decision !== undefined && <span role="status" className={css.phase} data-phase={decision.phase}>{t(decision.phase)}</span>}
    </header>
    {infoOpen && <div id={infoId} role="note" className={css.info}>
      <p>{t('creationMethod')}</p>
      <p><strong>{t('creationCost')}</strong></p>
      <p>{t('creationBackground')}</p>
      {decision?.bundleName !== undefined && <p>{t('sourceRetained')}</p>}
    </div>}
    <div className={css.body}>
      <strong className={css.title}>{recommendation.title}</strong>
      <FoldedText text={recommendation.brief} expandLabel={t('expandPlan')} collapseLabel={t('collapsePlan')} />
      {recommendation.initialContent !== undefined && <div className={css.content}>
        <span className={css.contentLabel}>{t('initialContent')}</span>
        <FoldedText text={recommendation.initialContent} expandLabel={t('expandContent')} collapseLabel={t('collapseContent')} />
      </div>}
      {decision?.application !== undefined && decision.application !== 'applied'
        && <p role="status" className={css.status}>{t(decision.application)}</p>}
      {error !== undefined && <p role="alert" className={css.status}>{t(error)}</p>}
      {offer ? <div className={css.controls}>
        <div className={css.locationRow}>
          <span className={css.locationLabel}>{t('location')}</span>
          <LocationPicker value={location} disabled={pending} onChange={setSelected} t={t} />
        </div>
        {location === 'custom' && <div className={css.customLocation}>
          <label htmlFor={customId} className={css.locationLabel}>{t('customLabel')}</label>
          <textarea id={customId} value={customLocation} rows={2} maxLength={1000} disabled={pending}
            placeholder={t('customPlaceholder')} onChange={(event) => { setCustom(event.target.value) }} />
        </div>}
        <footer className={css.footer}>
          <div className={css.actions}>
            <Button variant="ghost" size="sm" disabled={pending || view === undefined} onClick={() => { void run('dismiss') }}>{t('dismiss')}</Button>
            <Button variant="primary" size="sm" disabled={pending || view === undefined || location === 'custom' && customLocation.trim() === ''} onClick={() => { void run('create') }}>
              {t(pending ? 'starting' : decision === undefined ? 'create' : 'retry')}
            </Button>
          </div>
        </footer>
      </div> : <p className={css.description}>{t('location')} · {location === 'custom' ? customLocation : t(slot)}</p>}
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
    </div>
  </section>
}

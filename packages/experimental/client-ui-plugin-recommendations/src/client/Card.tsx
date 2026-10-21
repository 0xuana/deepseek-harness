/** In-conversation card; catalog text comes from the Host and durable state from the Session projection. */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { LocalizedText } from '@deepseek-ai/dsh-package-manifest'
import type { PluginRecommendation, RecommendationActionResult, RecommendationDetails } from '@deepseek-ai/dsh-experimental-plugin-recommendations/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { RecommendationKey } from './locales.ts'
import type {} from './definition.ts'
import css from './Card.module.css'

/** Session-bound callbacks and language, without a service in the component. */
export interface CardInjected {
  act: (callId: ToolCallId, action: 'enable' | 'dismiss') => Promise<RecommendationActionResult | undefined>
  describe: (callId: ToolCallId) => Promise<RecommendationDetails | undefined>
  openDetails: (packageName: string) => void
  resolveText: (text: LocalizedText) => string
  hooks: { locale: HostObservable<string> }
}

/** Recommendations indexed by their originating Turn. */
export interface RecommendationTailInjected extends CardInjected {
  keyedHooks: { recommendations: (turn: string) => ObservableSnapshot<readonly PluginRecommendation[]> }
}

type CardProps = { recommendation: PluginRecommendation } & Pick<PropsRuntime<'conversation.chat.turnTail'>, 'useProjection'>
  & PropsLocale<'pluginRecommendations'> & InjectFace<CardInjected>

/** Render the recommendation after the completed answer, never during tool execution.
 * @param props - Completed Turn and its indexed proposals.
 * @returns the Turn's first recommendation, or null when none was offered.
 */
// Each optional bundle owns its card and locale contracts until the shared action-card layer owns this tail.
/* jscpd:ignore-start */
export function RecommendationTail({ turn, useRecommendations, ...props }: Pick<PropsRuntime<'conversation.chat.turnTail'>, 'turn' | 'useProjection'>
  & PropsLocale<'pluginRecommendations'> & InjectFace<RecommendationTailInjected>) {
  const recommendation = useRecommendations(String(turn.turn))?.[0]
  const state = props.useProjection('pluginRecommendations')?.decisions[recommendation?.callId ?? '']
  return recommendation === undefined || state === 'suppressed' || turn.end?.data.reason.kind !== 'completed' || turn.data.get('turn-tail')?.closing == null
    ? null : <RecommendationCard {...props} recommendation={recommendation} />
}
/* jscpd:ignore-end */

/** Display one recommendation, its current catalog text, and the persisted outcome of the user's choice.
 * @param props - Session-bound recommendation, actions and locale.
 * @returns the card below its completed answer.
 */
export function RecommendationCard({ recommendation, useProjection, useLocale, act, describe, openDetails, resolveText, t }: CardProps) {
  useLocale(value => value)
  const view = useProjection('pluginRecommendations')
  const state = view?.decisions[recommendation.callId]
  // Undefined while loading; null when the Host could not be reached.
  const [details, setDetails] = useState<RecommendationDetails | null>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<RecommendationKey | undefined>()
  useEffect(() => {
    let current = true
    describe(recommendation.callId).then(
      (value) => { if (current) setDetails(value ?? null) },
      () => { if (current) setDetails(null) },
    )
    return () => { current = false }
  }, [describe, recommendation.callId, state])
  const available = details?.status === 'available' ? details : undefined
  const settled = state ?? (available?.enabled ? 'already-enabled' : undefined)
  const open = available !== undefined && !view?.invalid && (settled === undefined || settled === 'failed' || settled === 'cancelled')
  const run = async (action: 'enable' | 'dismiss') => {
    setPending(true)
    setError(undefined)
    try {
      const result = await act(recommendation.callId, action)
      if (result === undefined) setError('transport')
      else if (result.status !== 'settled') setError(result.reason)
      else if (result.errorCode !== undefined) setError(result.errorCode === 'incompatible-version' ? 'version-error' : 'management-error')
    } catch {
      // The Host operation may have committed before a connection loss; retry is idempotent.
      setError('transport')
    } finally { setPending(false) }
  }
  const title = available === undefined ? recommendation.name : resolveText(available.title)
  return <section className={css.card} aria-label={t('heading')} data-plugin-recommendation={recommendation.callId}>
    <header className={css.header}><span>{t('heading')}</span><span className={css.badge}>{t('official')}</span></header>
    <div className={css.body}>
      <button type="button" className={css.details} onClick={() => { openDetails(recommendation.name) }}
        aria-label={t('detailsFor').replace('{title}', title)}>
        <strong className={css.title}>{title}</strong>
        <span className={css.reason}>{recommendation.reason}</span>
        {available !== undefined && <span className={css.description}>{resolveText(available.description)}</span>}
        <span className={css.detailHint}>{t('detailsHint')}</span>
      </button>
      {settled !== undefined && <p role="status" className={css.status}>{t(settled)}</p>}
      {view?.invalid ? <p role="alert" className={css.status}>{t('invalid-history')}</p>
        : details === null ? <p role="alert" className={css.status}>{t('transport')}</p>
          : details?.status === 'refused' ? <p role="alert" className={css.status}>{t(details.reason)}</p>
            : open && error !== undefined && <p role="alert" className={css.status}>{t(error)}</p>}
      {open && <footer className={css.footer}>
        <span className={css.scope}>{t('scope')}</span>
        <div className={css.actions}>
          <Button variant="ghost" size="sm" disabled={pending || view === undefined} onClick={() => { void run('dismiss') }}>{t('dismiss')}</Button>
          <Button variant="primary" size="sm" disabled={pending || view === undefined} onClick={() => { void run('enable') }}>
            {t(pending ? 'enabling' : settled === undefined ? 'enable' : 'retry')}
          </Button>
        </div>
      </footer>}
    </div>
  </section>
}

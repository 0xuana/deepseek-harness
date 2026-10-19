/** In-conversation card; durable state arrives through the Session projection. */
import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { PluginRecommendation, RecommendationActionResult } from '@deepseek-ai/dsh-experimental-plugin-recommendations/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { RecommendationKey } from './locales.ts'
import type {} from './definition.ts'
import css from './Card.module.css'

/** Session-bound callbacks and language, without a service in the component. */
export interface CardInjected {
  act: (callId: ToolCallId, action: 'enable' | 'dismiss') => Promise<RecommendationActionResult | undefined>
  openDetails: (packageName: string) => void
  hooks: { chinese: HostObservable<boolean> }
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
export function RecommendationTail({ turn, useRecommendations, ...props }: Pick<PropsRuntime<'conversation.chat.turnTail'>, 'turn' | 'useProjection'>
  & PropsLocale<'pluginRecommendations'> & InjectFace<RecommendationTailInjected>) {
  const recommendation = useRecommendations(String(turn.turn))?.[0]
  return recommendation === undefined ? null : <RecommendationCard {...props} recommendation={recommendation} />
}

/** Display one recommendation and the persisted outcome of the user's choice.
 * @param props - Session-bound recommendation, actions and locale.
 * @returns the card below its completed answer.
 */
export function RecommendationCard({ recommendation, useProjection, useChinese, act, openDetails, t }: CardProps) {
  const chinese = useChinese(value => value)
  const decisions = useProjection('pluginRecommendations')
  const outcome = decisions?.decisions[recommendation.callId]
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<RecommendationKey | undefined>()
  const open = outcome === undefined || outcome === 'failed' || outcome === 'cancelled'
  const run = async (action: 'enable' | 'dismiss') => {
    setPending(true)
    setError(undefined)
    try {
      const result = await act(recommendation.callId, action)
      if (result === undefined) setError('transport')
      else if (result.status === 'refused') setError(result.reason)
    } catch {
      // The Host operation may have committed before a connection loss; retry is idempotent.
      setError('transport')
    } finally { setPending(false) }
  }
  return <section className={css.card} aria-label={t('heading')} data-plugin-recommendation={recommendation.callId}>
    <header className={css.header}><span>{t('heading')}</span><span className={css.badge}>{t('official')}</span></header>
    <div className={css.body}>
      <button type="button" className={css.details} onClick={() => { openDetails(recommendation.name) }}
        aria-label={`${t('details')}: ${chinese ? recommendation.titleZh : recommendation.titleEn}`}>
        <strong className={css.title}>{chinese ? recommendation.titleZh : recommendation.titleEn}</strong>
        <span className={css.reason}>{recommendation.reason}</span>
        <span className={css.description}>{chinese ? recommendation.descriptionZh : recommendation.descriptionEn}</span>
        <span className={css.detailHint}>{t('details')} →</span>
      </button>
      {outcome !== undefined && <p role="status" className={css.status}>{t(outcome)}</p>}
      {error !== undefined && <p role="alert" className={css.status}>{t(error)}</p>}
      {open && <footer className={css.footer}>
        <span className={css.scope}>{t('scope')}</span>
        <div className={css.actions}>
          <Button variant="ghost" size="sm" disabled={pending || decisions === undefined} onClick={() => { void run('dismiss') }}>{t('dismiss')}</Button>
          <Button variant="primary" size="sm" disabled={pending || decisions === undefined} onClick={() => { void run('enable') }}>
            {t(pending ? 'enabling' : outcome === undefined ? 'enable' : 'retry')}
          </Button>
        </div>
      </footer>}
    </div>
  </section>
}

/** In-conversation card; catalog text comes from the Host and durable state from the Session projection. */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { LocalizedText } from '@deepseek-ai/dsh-package-manifest'
import type {
  PluginRecommendation, RecommendationActionResult, RecommendationDetails, RecommendationView,
} from '@deepseek-ai/dsh-experimental-plugin-recommendations/types'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { RecommendationKey } from './locales.ts'
import css from './Card.module.css'

/** Catalog text the Host returned for an available plugin. */
export type CatalogDetails = Extract<RecommendationDetails, { readonly status: 'available' }>

/** Session-bound callbacks, language and the plugin-lifetime catalog text, without a service in the component. */
export interface CardInjected {
  act: (callId: ToolCallId, action: 'enable' | 'dismiss') => Promise<RecommendationActionResult | undefined>
  describe: (callId: ToolCallId) => Promise<RecommendationDetails | undefined>
  /** Keep a plugin's catalog text so later cards of the same plugin render it at once. */
  remember: (name: string, details: CatalogDetails) => void
  openDetails: (packageName: string) => void
  resolveText: (text: LocalizedText) => string
  hooks: { locale: HostObservable<string>; catalog: HostObservable<Readonly<Record<string, CatalogDetails>>> }
}

type CardProps = { recommendation: PluginRecommendation } & Pick<PropsRuntime<'conversation.chat.turnTail'>, 'useProjection'>
  & PropsLocale<'pluginRecommendations'> & InjectFace<CardInjected>

/** The projection admits at most one proposal per turn; should several exist, the lowest call id is shown. */
function proposalOf(view: RecommendationView | undefined, turn: number): PluginRecommendation | undefined {
  let found: PluginRecommendation | undefined
  for (const proposal of Object.values(view?.proposals ?? {})) {
    if (proposal.turn === turn && (found === undefined || proposal.callId < found.callId)) found = proposal
  }
  return found
}

/** Place the proposal admitted in a turn after that turn's final answer, once the turn has ended.
 * @param props - Turn location, projection reader and session-bound actions.
 * @returns the recommendation card, or null when none was offered.
 */
// Each optional bundle owns its card and locale contracts until the shared action-card layer owns this tail.
/* jscpd:ignore-start */
export function RecommendationTail({ turn, ...props }: Pick<PropsRuntime<'conversation.chat.turnTail'>, 'turn' | 'useProjection'>
  & PropsLocale<'pluginRecommendations'> & InjectFace<CardInjected>) {
  const view = props.useProjection('pluginRecommendations')
  const recommendation = proposalOf(view, turn.turn)
  const state = view?.decisions[recommendation?.callId ?? '']
  return recommendation === undefined || state === 'suppressed' || turn.end === undefined || turn.data.get('turn-tail')?.closing == null
    ? null : <RecommendationCard {...props} recommendation={recommendation} />
}
/* jscpd:ignore-end */

/** Display one recommendation, its current catalog text, and the persisted outcome of the user's choice.
 * Until the first catalog lookup of a plugin returns, placeholder lines and the disabled actions hold the final layout.
 * @param props - Session-bound recommendation, actions and locale.
 * @returns the card below its completed answer.
 */
export function RecommendationCard({
  recommendation, useProjection, useLocale, useCatalog, act, describe, remember, openDetails, resolveText, t,
}: CardProps) {
  useLocale(value => value)
  const view = useProjection('pluginRecommendations')
  const state = view?.decisions[recommendation.callId]
  const cached = useCatalog(catalog => Object.hasOwn(catalog, recommendation.name) ? catalog[recommendation.name] : undefined)
  // This card's latest lookup: undefined while loading, null when the Host could not be reached.
  const [lookup, setLookup] = useState<RecommendationDetails | null>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<RecommendationKey | undefined>()
  useEffect(() => {
    let current = true
    describe(recommendation.callId).then(
      (value) => {
        if (!current) return
        if (value?.status === 'available') remember(recommendation.name, value)
        setLookup(value ?? null)
      },
      () => { if (current) setLookup(null) },
    )
    return () => { current = false }
  }, [describe, remember, recommendation.callId, recommendation.name, state])
  // Remembered text shows at once; this card's own refusal or lost reply still decides what it offers.
  const details = lookup === null || lookup?.status === 'refused' ? lookup : cached ?? lookup
  const loading = details === undefined
  const available = details?.status === 'available' ? details : undefined
  const settled = state ?? (available?.enabled ? 'already-enabled' : undefined)
  const open = (available !== undefined || loading) && !view?.invalid && (settled === undefined || settled === 'failed' || settled === 'cancelled')
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
  return <section className={css.card} aria-label={t('heading')} aria-busy={loading || undefined} data-plugin-recommendation={recommendation.callId}>
    <header className={css.header}><span>{t('heading')}</span><span className={css.badge}>{t('official')}</span></header>
    <div className={css.body}>
      <button type="button" className={css.details} onClick={() => { openDetails(recommendation.name) }}
        aria-label={t('detailsFor').replace('{title}', title)}>
        <strong className={css.title}>{loading ? <span className={css.placeholder} /> : title}</strong>
        <span className={css.reason}>{recommendation.reason}</span>
        {(loading || available !== undefined) && <span className={css.description}>
          {available === undefined ? <span className={css.placeholder} /> : resolveText(available.description)}
        </span>}
      </button>
      {settled !== undefined && <p role="status" className={css.status}>{t(settled)}</p>}
      {view?.invalid ? <p role="alert" className={css.status}>{t('invalid-history')}</p>
        : details === null ? <p role="alert" className={css.status}>{t('transport')}</p>
          : details?.status === 'refused' ? <p role="alert" className={css.status}>{t(details.reason)}</p>
            : open && error !== undefined && <p role="alert" className={css.status}>{t(error)}</p>}
      {open && <footer className={css.footer}>
        <span className={css.scope}>{t('scope')}</span>
        <div className={css.actions}>
          <Button variant="ghost" size="sm" disabled={pending || loading || view === undefined} onClick={() => { void run('dismiss') }}>{t('dismiss')}</Button>
          <Button variant="primary" size="sm" disabled={pending || loading || view === undefined} onClick={() => { void run('enable') }}>
            {t(pending ? 'enabling' : settled === undefined ? 'enable' : 'retry')}
          </Button>
        </div>
      </footer>}
    </div>
  </section>
}

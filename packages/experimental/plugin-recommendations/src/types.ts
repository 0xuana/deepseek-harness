/** Durable facts for user-requested official plugin recommendations. */
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'
import type { ManagementError } from '@deepseek-ai/dsh-plugin-manager/types'
import type { LocalizedText } from '@deepseek-ai/dsh-package-manifest'

/** A `dsh-action` block naming one official plugin; the card reads the plugin's catalog text from the Host. */
export interface PluginRecommendation {
  readonly callId: ToolCallId
  /** Package name as written in the block; enabling checks it against the current catalog. */
  readonly name: string
  /** Model explanation of how this plugin helps with the user's need. */
  readonly reason: string
}

/** Selection and runtime application are deliberately separate. */
export type RecommendationOutcome = 'dismissed' | 'applied' | 'already-enabled' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'

/** Replacement and suppression are derived from the log, never written as decisions: a later proposal replaces an undecided card;
 * a proposal written while user messages are queued, or after this experiment's card in the same turn, is never offered. */
export type RecommendationCardState = RecommendationOutcome | 'replaced' | 'suppressed'

/** A completed user action. A failure remains retryable from the card. */
export interface RecommendationDecision {
  readonly callId: ToolCallId
  readonly outcome: RecommendationOutcome
}

/** Full-session card states and admitted proposals. */
export interface RecommendationView {
  readonly decisions: Readonly<Record<string, RecommendationCardState>>
  /** Every admitted proposal by call id, with the turn whose answer carried it. */
  readonly proposals: Readonly<Record<string, PluginRecommendation & { readonly turn: number }>>
  /** An unreadable receipt blocks actions without breaking other Session projections. */
  readonly invalid?: true | undefined
}

/** Catalog text for a card, read when it is displayed; a name outside the catalog gets no card text. */
export type RecommendationDetails =
  | { readonly status: 'available'; readonly title: LocalizedText; readonly description: LocalizedText; readonly enabled: boolean }
  | { readonly status: 'refused'; readonly reason: 'unknown' | 'unavailable' | 'not-live-root' | 'closing' }

/** Explicit refusals never change the profile. */
export type RecommendationActionResult =
  | { readonly status: 'settled'; readonly outcome: RecommendationCardState; readonly errorCode?: ManagementError['code'] }
  | { readonly status: 'refused'; readonly reason: 'unknown' | 'unavailable' | 'access-denied' | 'not-live-root' | 'closing' | 'invalid-history' }
  | { readonly status: 'unconfirmed'; readonly reason: 'closing' }

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Informational receipt of a profile change; profile files own the actual configuration. */
    'plugin:plugin-recommendations/decision': RecommendationDecision
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Open-session card states, omitted from session listing summaries. */
    pluginRecommendations: SessionProjectionSummaryExcluded<RecommendationView>
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Status receipt attribution; other readers preserve the recorded text without this plugin.
     * The producer uses through only to acknowledge delivered updates.
     * @persistenceAttribution
     */
    'plugin-recommendations': { kind: 'plugin-recommendations'; through: SessionSeq } & ContextFormed
  }
}

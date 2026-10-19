/** Durable facts for user-requested official plugin recommendations. */
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'

/** Host-owned catalog text captured when a recommendation is made. */
export interface PluginRecommendation {
  readonly callId: ToolCallId
  readonly name: string
  readonly titleEn: string
  readonly titleZh: string
  readonly descriptionEn: string
  readonly descriptionZh: string
  /** The explicit user need this recommendation addresses, including conversational context. */
  readonly request: string
  /** Model explanation of how this plugin helps with that request. */
  readonly reason: string
}

/** Selection and runtime application are deliberately separate. */
export type RecommendationOutcome = 'dismissed' | 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'

/** A completed user action. A failure remains retryable from the card. */
export interface RecommendationDecision {
  readonly callId: ToolCallId
  readonly outcome: RecommendationOutcome
}

/** Full-session decisions; the card itself comes from the tool result. */
export interface RecommendationView {
  readonly decisions: Readonly<Record<string, RecommendationOutcome>>
}

/** Explicit refusals never change the profile. */
export type RecommendationActionResult =
  | { readonly status: 'settled'; readonly outcome: RecommendationOutcome }
  | { readonly status: 'refused'; readonly reason: 'unknown' | 'unavailable' | 'access-denied' | 'not-live-root' | 'closing' }

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Informational receipt of a profile change; profile files own the actual configuration. */
    'plugin:plugin-recommendations/decision': RecommendationDecision
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Open-session card decisions, omitted from session listing summaries. */
    pluginRecommendations: SessionProjectionSummaryExcluded<RecommendationView>
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Host-confirmed activation, queued after the user clicks the card. */
    'plugin-recommendation': { kind: 'plugin-recommendation'; callId: ToolCallId; form: 'notice'; summary: string }
  }
}

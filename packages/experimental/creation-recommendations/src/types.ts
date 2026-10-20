/** Durable recommendations and receipts for newly created interface plugins. */
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'
import type { ChangeResult } from '@deepseek-ai/dsh-plugin-manager/types'

/** Placements: page is a Session view tab; sidebar-left combines a global page and its left entry. */
export type CreationSlot = 'sidebar-right' | 'page' | 'sidebar-left'

/** The explicit need and context passed to the Creator after the user accepts. */
export interface CreationRecommendation {
  readonly callId: ToolCallId
  readonly title: string
  readonly brief: string
  readonly slot: CreationSlot
}

/** Receipts describe the created bundle; profile files own its installation. */
export interface CreationDecision {
  readonly callId: ToolCallId
  readonly phase: 'dismissed' | 'creating' | 'installing' | 'cancelled' | 'installed' | 'kept' | 'removed' | 'failed' | 'interrupted' | 'unconfirmed'
  readonly slot: CreationSlot
  readonly bundleName?: string | undefined
  readonly application?: ChangeResult['application'] | undefined
}

/** Open-session receipts, excluded from session-list summaries. */
export interface CreationView {
  readonly decisions: Readonly<Record<string, CreationDecision>>
}

/** Human actions never accept a package name or installation path from the browser. */
export type CreationActionResult =
  | { readonly status: 'accepted' }
  | { readonly status: 'settled'; readonly decision: CreationDecision }
  | { readonly status: 'refused'; readonly reason: 'unknown' | 'access-denied' | 'not-live-root' | 'closing' | 'unavailable' | 'invalid-location' }
  | { readonly status: 'unconfirmed'; readonly reason: 'closing' }

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** New-plugin creation progress and explicit keep/undo decisions. */
    'plugin:creation-recommendations/decision': CreationDecision
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Persistent creation receipts for the currently open session. */
    creationRecommendations: SessionProjectionSummaryExcluded<CreationView>
  }
}

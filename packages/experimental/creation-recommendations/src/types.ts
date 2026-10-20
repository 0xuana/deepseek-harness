/** Durable recommendations and receipts for newly created interface plugins. */
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'
import type { ChangeResult } from '@deepseek-ai/dsh-plugin-manager/types'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'

/** Placements: page is a Session view tab; sidebar-left combines a global page and its left entry. */
export type CreationSlot = 'sidebar-right' | 'page' | 'sidebar-left'

/** The explicit need and context passed to the Creator after the user accepts. */
export interface CreationRecommendation {
  readonly callId: ToolCallId
  readonly title: string
  readonly brief: string
  readonly slot: CreationSlot
  /** Omitted for a new empty page; otherwise the existing content passed to the Creator, separate from the short brief. */
  readonly initialContent?: string | undefined
}

/** Receipts describe the created bundle; profile files own its installation. */
export interface CreationDecision {
  readonly callId: ToolCallId
  readonly phase: 'dismissed' | 'creating' | 'installing' | 'cancelled' | 'installed' | 'kept' | 'removed' | 'failed' | 'interrupted' | 'unconfirmed'
  readonly slot: CreationSlot
  /** Omitted: use slot. Present: Creator resolves this human-authored placement instead. */
  readonly customLocation?: string | undefined
  readonly bundleName?: string | undefined
  readonly application?: ChangeResult['application'] | undefined
}

/** Expiration is derived from user messages, never written as a plugin decision. */
export type CreationCardState = CreationDecision | (Omit<CreationDecision, 'phase'> & { readonly phase: 'expired' })

/** Open-session receipts, excluded from session-list summaries. */
export interface CreationView {
  readonly decisions: Readonly<Record<string, CreationCardState>>
}

/** Human actions never accept a package name or installation path from the browser. */
export type CreationActionResult =
  | { readonly status: 'accepted' }
  | { readonly status: 'settled'; readonly decision: CreationCardState }
  | { readonly status: 'refused'; readonly reason: 'unknown' | 'access-denied' | 'not-live-root' | 'closing' | 'unavailable' | 'invalid-location' }
  | { readonly status: 'unconfirmed'; readonly reason: 'closing' }

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Status receipt attribution; other readers preserve the recorded text without this plugin.
     * The producer uses through only to acknowledge delivered updates.
     * @persistenceAttribution
     */
    'personalized-pages': { kind: 'personalized-pages'; through: SessionSeq } & ContextFormed
  }
}

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

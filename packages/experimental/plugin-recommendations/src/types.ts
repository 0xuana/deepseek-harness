/** Fields, recorded data and catalog text of `enable_official_plugin` cards. */
import type { ChangeResult, ManagementError } from '@deepseek-ai/dsh-plugin-manager/types'
import type { LocalizedText } from '@deepseek-ai/dsh-package-manifest'

/** Card fields the skill asks the model to write in `details`. */
export interface PluginDetails {
  /** Package name as written in the catalog; enabling checks it against the current catalog. */
  readonly name: string
}

/** Phases a plugin card records besides the shared `dismissed`. */
export type PluginPhase = 'enabled' | 'already-enabled' | 'failed'

/** Data each plugin decision records; profile files own the actual configuration. */
export interface PluginData {
  /** Present when the saved selection did not apply at once (`restart-required`, `overridden`) or the change was `cancelled`. */
  readonly application?: Exclude<ChangeResult['application'], 'applied' | 'failed'> | undefined
  /** Plugin manager error code of a failed change; its diagnostic text is not recorded. */
  readonly errorCode?: ManagementError['code'] | undefined
}

/** Catalog text for a card, read when it is displayed; a name outside the eligible catalog gets no card text. */
export type RecommendationDetails =
  | { readonly status: 'available'; readonly title: LocalizedText; readonly description: LocalizedText; readonly enabled: boolean }
  | { readonly status: 'refused'; readonly reason: 'unknown' | 'unavailable' | 'not-live-root' | 'closing' }

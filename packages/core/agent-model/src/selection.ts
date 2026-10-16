/** Pure comparisons and snapshots shared by the selection service and notice plugin. */
import type { ModelSelection } from '@deepseek-ai/dsh-agent/types'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'

/**
 * Build a detached selection, omitting an absent effort.
 * @param provider - provider route.
 * @param model - provider-owned model id.
 * @param reasoningEffort - explicit effort; omission follows adapter defaults.
 * @returns a detached selection.
 */
export function toSelection(provider: string, model: string, reasoningEffort: ReasoningEffortId | undefined): ModelSelection {
  return { provider, model, ...reasoningEffort === undefined ? {} : { reasoningEffort } }
}

/**
 * Compare provider and model without comparing reasoning effort.
 * @param left - first selection.
 * @param right - second selection.
 * @returns whether both selections name the same route.
 */
export function sameRoute(left: ModelSelection, right: ModelSelection): boolean {
  return left.provider === right.provider && left.model === right.model
}

/**
 * Compare complete selections, treating absent effort as its own value.
 * @param left - first selection, or no recorded selection.
 * @param right - second selection, or no recorded selection.
 * @returns whether both selections agree.
 */
export function sameModelSelection(left: ModelSelection | null, right: ModelSelection | null): boolean {
  return left === right || (left !== null && right !== null
    && sameRoute(left, right) && left.reasoningEffort === right.reasoningEffort)
}

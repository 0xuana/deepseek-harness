/** Validate answer blocks and fold card decisions without scanning session history. */
import { z } from 'zod'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { cardBlocksOf } from '@deepseek-ai/dsh-experimental-creation-recommendations'
import type { PluginRecommendation, RecommendationOutcome } from './types.ts'

const recommendationSchema: z.ZodType<PluginRecommendation> = z.object({
  callId: z.string().min(1).transform(ToolCallId),
  name: z.string().min(1), reason: z.string().min(1),
}).strict()

const outcomeSchema: z.ZodType<RecommendationOutcome> = z.enum([
  'dismissed', 'applied', 'already-enabled', 'restart-required', 'overridden', 'failed', 'cancelled',
])

/** The host retains proposals to validate actions; clients only need card states. */
const viewSchema = z.object({
  decisions: z.record(z.string(), z.union([outcomeSchema, z.enum(['replaced', 'suppressed'])])),
  invalid: z.literal(true).optional(),
})
/** Cache validation for proposals and experimental decision records. */
export const stateSchema = z.object({
  proposals: z.record(z.string(), recommendationSchema),
  view: viewSchema,
  turn: z.number(), firstCall: z.string().nullable(),
  /** Decided cards whose status the model has not received, with the receipt sequence. */
  pendingStatus: z.record(z.string(), z.number()),
  /** User messages still queued for later turns, folded from inbox splices. */
  queued: z.number(),
})

/** Validated proposals, card states and undelivered status receipts. */
export type RecommendationState = z.infer<typeof stateSchema>

/** Card limits the fold needs; the owning service supplies its validated configuration. */
export interface RecommendationLimits { readonly queuedMessageLimit: number }

type Definition = ProjectionDefinition<'pluginRecommendations', RecommendationState>

/** Definition returned by {@link recommendationProjection}: the fold, whose empty state needs no Session metadata, and its view wire. */
export type RecommendationProjectionDefinition = Omit<Definition, 'init' | 'wire'> & {
  readonly init: () => RecommendationState
  readonly wire: NonNullable<Definition['wire']>
}

/** Whole-log fold; late decisions survive card pagination and reconnect, and a later proposal replaces an undecided card.
 * @param limits - validated card limits.
 * @returns the projection definition for this configuration.
 */
export function recommendationProjection(limits: RecommendationLimits): RecommendationProjectionDefinition {
  return {
    key: 'pluginRecommendations', stateVersion: 4, stateSchema,
    init: (): RecommendationState => ({ proposals: {}, view: { decisions: {} }, turn: 0, firstCall: null, pendingStatus: {}, queued: 0 }),
    apply: (state, event) => {
      // Same as personalized pages until the shared action-card layer owns card folds.
      /* jscpd:ignore-start */
      if (event.type === 'turn/start') return { ...state, turn: event.data.turn, firstCall: null }
      if (event.type === 'agent/inbox/spliced') {
        if (event.data.target !== 'next-turn') return state
        return { ...state, queued: Math.max(0, state.queued - (event.data.removedCount ?? 0) + event.data.inserted.length) }
      }
      if (event.type === 'user/message' && event.data.source.kind === 'plugin-recommendations') {
        const through = event.data.source.through
        return { ...state, pendingStatus: Object.fromEntries(Object.entries(state.pendingStatus).filter(([, seq]) => seq > through)) }
      }
      /* jscpd:ignore-end */
      const record = pluginRecordOf(event)
      if (record?.type === 'plugin:plugin-recommendations/decision') {
        const parsed = z.object({ callId: z.string().min(1), outcome: outcomeSchema }).safeParse(record.data)
        if (!parsed.success) return { ...state, view: { ...state.view, invalid: true } }
        const { callId, outcome } = parsed.data
        return { ...state, view: { ...state.view, decisions: { ...state.view.decisions, [callId]: outcome } },
          pendingStatus: { ...state.pendingStatus, [callId]: event.seq } }
      }
      const answer = cardBlocksOf(event)
      if (answer === undefined) return state
      const firstCall = state.firstCall ?? answer.callId
      const last = answer.blocks.filter(block => block.action === 'enable_official_plugin').at(-1)
      if (last === undefined) return firstCall === state.firstCall ? state : { ...state, firstCall }
      const proposal: PluginRecommendation = { callId: answer.callId, name: last.name, reason: last.reason }
      const decisions = { ...state.view.decisions }
      // Another experiment's card holds this answer or turn: the block is logged but never offered.
      const foreignCard = answer.card.action !== 'enable_official_plugin'
        || firstCall !== proposal.callId && state.proposals[firstCall] === undefined
      // One card per turn: a block written after another card in this turn creates nothing.
      if (!foreignCard && firstCall !== proposal.callId) return state
      // Queued user messages mean the user has moved on; the proposal is logged but never offered.
      if (foreignCard || state.queued >= limits.queuedMessageLimit) {
        decisions[proposal.callId] = 'suppressed'
        return { ...state, firstCall, proposals: { ...state.proposals, [proposal.callId]: proposal }, view: { ...state.view, decisions } }
      }
      // A newer proposal supersedes every undecided card; the model owns that choice, so no status notice is queued.
      for (const earlier of Object.values(state.proposals)) {
        if (earlier.callId !== proposal.callId && decisions[earlier.callId] === undefined) decisions[earlier.callId] = 'replaced'
      }
      return { ...state, firstCall, proposals: { ...state.proposals, [proposal.callId]: proposal }, view: { ...state.view, decisions } }
    },
    wire: { summary: false, viewSchema, view: (state: RecommendationState) => state.view },
  }
}

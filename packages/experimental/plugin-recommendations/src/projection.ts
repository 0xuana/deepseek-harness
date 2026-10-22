/** Validate answer blocks and fold card decisions without scanning session history. */
import { z } from 'zod'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { actionBlocksOf } from '@deepseek-ai/dsh-util-action-block'
import type { PluginRecommendation, RecommendationOutcome } from './types.ts'

const proposalSchema = z.object({
  callId: z.string().min(1).transform(ToolCallId),
  name: z.string().min(1), reason: z.string().min(1),
  turn: z.number().int(),
}).strict()

const blockSchema = z.object({
  action: z.literal('enable_official_plugin'), name: z.string().trim().min(1), reason: z.string().trim().min(1),
}).strict()

/** Read a proposal from a logged answer: its last valid official-plugin block. Blocks of other actions are ignored.
 * @param event - logged session event.
 * @returns the proposal, when the event is an answer carrying a valid block.
 */
export function recommendationOf(event: SessionEvent): PluginRecommendation | undefined {
  if (event.type !== 'assistant/message') return undefined
  const text = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  const last = actionBlocksOf(text).flatMap((value) => {
    const parsed = blockSchema.safeParse(value)
    return parsed.success ? [parsed.data] : []
  }).at(-1)
  return last === undefined ? undefined : { callId: ToolCallId(`block:${event.data.message.id}`), name: last.name, reason: last.reason }
}

const outcomeSchema: z.ZodType<RecommendationOutcome> = z.enum([
  'dismissed', 'applied', 'already-enabled', 'restart-required', 'overridden', 'failed', 'cancelled',
])

/** Card states and admitted proposals; the client reads both, and the Host validates actions against the proposals. */
const viewSchema = z.object({
  decisions: z.record(z.string(), z.union([outcomeSchema, z.enum(['replaced', 'suppressed'])])),
  proposals: z.record(z.string(), proposalSchema),
  invalid: z.literal(true).optional(),
})
// Same fold state as personalized pages until the shared action-card layer owns card folds.
/* jscpd:ignore-start */
/** Cache validation for proposals and experimental decision records. */
export const stateSchema = z.object({
  /** Fork-inherited prefix length; inherited events create no proposals or receipts. */
  inheritedEventCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(SessionLogOffset),
  view: viewSchema,
  turn: z.number(), firstCall: z.string().nullable(),
  /** Decided cards whose status the model has not received, with the receipt sequence. */
  pendingStatus: z.record(z.string(), z.number()),
  /** User messages still queued for later turns, folded from inbox splices. */
  queued: z.number(),
})
/* jscpd:ignore-end */

/** Validated proposals, card states and undelivered status receipts. */
export type RecommendationState = z.infer<typeof stateSchema>

/** Card limits the fold needs; the owning service supplies its validated configuration. */
export interface RecommendationLimits { readonly queuedMessageLimit: number }

type Definition = ProjectionDefinition<'pluginRecommendations', RecommendationState>

/** Definition returned by {@link recommendationProjection}: the fold plus its client view wire. */
export type RecommendationProjectionDefinition = Omit<Definition, 'wire'> & {
  readonly wire: NonNullable<Definition['wire']>
}

/** Whole-log fold; late decisions survive card pagination and reconnect, and a later proposal replaces an undecided card.
 * Events inherited by a forked Session create no proposals or receipts.
 * @param limits - validated card limits.
 * @returns the projection definition for this configuration.
 */
export function recommendationProjection(limits: RecommendationLimits): RecommendationProjectionDefinition {
  return {
    key: 'pluginRecommendations', stateVersion: 6, stateSchema,
    init: (_header, inheritedEventCount) => ({
      inheritedEventCount, view: { decisions: {}, proposals: {} }, turn: 0, firstCall: null, pendingStatus: {}, queued: 0,
    }),
    apply: (state, event) => {
      // Same as personalized pages until the shared action-card layer owns card folds.
      /* jscpd:ignore-start */
      if (event.seq < state.inheritedEventCount) return state
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
      const proposal = recommendationOf(event)
      if (proposal === undefined) return state
      const firstCall = state.firstCall ?? proposal.callId
      // One card per turn: this experiment's later block in the same turn creates nothing.
      // Blocks of other actions never displace a plugin card.
      if (firstCall !== proposal.callId) return state
      const decisions = { ...state.view.decisions }
      const proposals = { ...state.view.proposals, [proposal.callId]: { ...proposal, turn: state.turn } }
      // Queued user messages mean the user has moved on; the proposal is logged but never offered.
      if (state.queued >= limits.queuedMessageLimit) {
        decisions[proposal.callId] = 'suppressed'
        return { ...state, firstCall, view: { ...state.view, decisions, proposals } }
      }
      // A newer proposal supersedes every undecided card; the model owns that choice, so no status notice is queued.
      for (const earlier of Object.values(state.view.proposals)) {
        if (earlier.callId !== proposal.callId && decisions[earlier.callId] === undefined) decisions[earlier.callId] = 'replaced'
      }
      return { ...state, firstCall, view: { ...state.view, decisions, proposals } }
    },
    wire: { summary: false, viewSchema, view: (state: RecommendationState) => state.view },
  }
}

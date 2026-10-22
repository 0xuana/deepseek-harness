/** Validate logged proposals and recover creation receipts through replay. */
import { z } from 'zod'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { actionBlocksOf } from '@deepseek-ai/dsh-util-action-block'
import type { CreationRecommendation } from './types.ts'

/** Model and wire values use the same three supported locations. */
export const slotSchema = z.enum(['sidebar-right', 'page', 'sidebar-left'])
/** Human-authored placement is a short instruction, not a package or path. */
export const customLocationSchema = z.string().trim().min(1).max(1000)
const proposalSchema = z.object({
  callId: z.string().min(1).transform(ToolCallId),
  title: z.string().min(1), brief: z.string().min(1), slot: slotSchema,
  initialContent: z.string().optional(),
  turn: z.number().int(),
}).strict()
const decisionSchema = z.object({
  callId: z.string().min(1).transform(ToolCallId),
  phase: z.enum(['dismissed', 'creating', 'installing', 'cancelled', 'installed', 'kept', 'removed', 'failed', 'interrupted', 'unconfirmed']),
  slot: slotSchema, customLocation: customLocationSchema.optional(), bundleName: z.string().optional(),
  application: z.enum(['applied', 'restart-required', 'overridden', 'failed', 'cancelled']).optional(),
})
const viewSchema = z.object({
  decisions: z.record(z.string(), z.union([
    decisionSchema, decisionSchema.extend({ phase: z.enum(['replaced', 'suppressed']) }),
  ])),
  proposals: z.record(z.string(), proposalSchema),
})
const stateSchema = z.object({
  /** Fork-inherited prefix length; inherited events create no proposals or receipts. */
  inheritedEventCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(SessionLogOffset),
  view: viewSchema,
  turn: z.number(),
  /** The first proposal admitted in the current turn; a later block of that turn creates no card. */
  firstCall: z.string().nullable(),
  pendingStatus: z.record(z.string(), z.number()),
  /** User messages still queued for later turns, folded from inbox splices. */
  queued: z.number(),
})

/** Fold state; `view` is also the client wire value. */
export type CreationState = z.infer<typeof stateSchema>

const blockSchema = proposalSchema.omit({ callId: true, turn: true }).extend({
  action: z.literal('create_personalized_page'), title: z.string().trim().min(1), brief: z.string().trim().min(1),
}).strict()

/** Read a proposal from a logged event: the last valid `dsh-action` block of an assistant answer.
 * @param event - logged session event.
 * @returns the proposal identified by its message id, when present.
 */
export function creationOf(event: SessionEvent): CreationRecommendation | undefined {
  if (event.type !== 'assistant/message') return undefined
  const text = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  const last = actionBlocksOf(text).map(value => blockSchema.safeParse(value)).filter(parsed => parsed.success).at(-1)
  if (last === undefined) return undefined
  const { action: _action, ...fields } = last.data
  return { callId: ToolCallId(`block:${event.data.message.id}`), ...fields }
}

/** Card limits the fold needs; the owning service supplies its validated configuration. */
export interface CreationLimits { readonly queuedMessageLimit: number }

/** Definition returned by {@link creationProjection}: the fold plus its client view wire. */
export type CreationProjectionDefinition = Omit<ProjectionDefinition<'creationRecommendations', CreationState>, 'wire'> & {
  readonly wire: NonNullable<ProjectionDefinition<'creationRecommendations', CreationState>['wire']>
}

/** Full-session fold; a later proposal replaces an unstarted card, so one unstarted card exists per conversation.
 * Events inherited by a forked Session create no proposals or receipts.
 * @param limits - validated card limits.
 * @returns the projection definition for this configuration.
 */
export function creationProjection(limits: CreationLimits): CreationProjectionDefinition {
  return {
    key: 'creationRecommendations', stateVersion: 9, stateSchema,
    init: (_header, inheritedEventCount) => ({
      inheritedEventCount, view: { decisions: {}, proposals: {} }, turn: 0, firstCall: null, pendingStatus: {}, queued: 0,
    }),
    apply: (state, event) => {
      if (event.seq < state.inheritedEventCount) return state
      if (event.type === 'turn/start') return { ...state, turn: event.data.turn, firstCall: null }
      if (event.type === 'agent/inbox/spliced') {
        if (event.data.target !== 'next-turn') return state
        return { ...state, queued: Math.max(0, state.queued - (event.data.removedCount ?? 0) + event.data.inserted.length) }
      }
      if (event.type === 'user/message' && event.data.source.kind === 'personalized-pages') {
        const through = event.data.source.through
        return { ...state, pendingStatus: Object.fromEntries(Object.entries(state.pendingStatus).filter(([, seq]) => seq > through)) }
      }
      const record = pluginRecordOf(event)
      if (record?.type === 'plugin:creation-recommendations/decision') {
        // A malformed or newer record is skipped; throwing here would fail every later read of this Session.
        const decision = decisionSchema.safeParse(record.data)
        if (!decision.success) return state
        return { ...state, view: { ...state.view, decisions: { ...state.view.decisions, [decision.data.callId]: decision.data } },
          pendingStatus: { ...state.pendingStatus, [decision.data.callId]: event.seq } }
      }
      const proposal = creationOf(event)
      // One card per turn: a block written after another card in this turn creates nothing.
      if (proposal === undefined || state.firstCall !== null && state.firstCall !== proposal.callId) return state
      const decisions = { ...state.view.decisions }
      // Queued user messages mean the user has moved on; the proposal is logged but never offered.
      if (state.queued >= limits.queuedMessageLimit) {
        decisions[proposal.callId] = { callId: proposal.callId, phase: 'suppressed', slot: proposal.slot }
      } else {
        // A newer proposal supersedes every unstarted card; the model owns that choice, so no status notice is queued.
        for (const earlier of Object.values(state.view.proposals)) {
          if (earlier.callId !== proposal.callId && decisions[earlier.callId] === undefined) {
            decisions[earlier.callId] = { callId: earlier.callId, phase: 'replaced', slot: earlier.slot }
          }
        }
      }
      const proposals = { ...state.view.proposals, [proposal.callId]: { ...proposal, turn: state.turn } }
      return { ...state, firstCall: proposal.callId, view: { decisions, proposals } }
    },
    wire: { summary: false, viewSchema, view: (state: CreationState) => state.view },
  }
}

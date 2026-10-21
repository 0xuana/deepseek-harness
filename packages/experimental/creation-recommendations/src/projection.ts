/** Validate logged proposals and recover creation receipts through replay. */
import { z } from 'zod'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { CreationRecommendation } from './types.ts'
import { actionBlocksOf } from './action-block.ts'
import type {} from '@deepseek-ai/dsh-tool-executor-ptc/types'

/** Model and wire values use the same three supported locations. */
export const slotSchema = z.enum(['sidebar-right', 'page', 'sidebar-left'])
/** Human-authored placement is a short instruction, not a package or path. */
export const customLocationSchema = z.string().trim().min(1).max(1000)
const proposalSchema = z.object({
  callId: z.string().min(1).transform(ToolCallId),
  title: z.string().min(1), brief: z.string().min(1), slot: slotSchema,
  initialContent: z.string().optional(),
}).strict()
const decisionSchema = z.object({
  callId: z.string().min(1).transform(ToolCallId),
  phase: z.enum(['dismissed', 'creating', 'installing', 'cancelled', 'installed', 'kept', 'removed', 'failed', 'interrupted', 'unconfirmed']),
  slot: slotSchema, customLocation: customLocationSchema.optional(), bundleName: z.string().optional(),
  application: z.enum(['applied', 'restart-required', 'overridden', 'failed', 'cancelled']).optional(),
})
const viewSchema = z.object({ decisions: z.record(z.string(), z.union([
  decisionSchema, decisionSchema.extend({ phase: z.enum(['replaced', 'suppressed']) }),
])) })
const stateSchema = z.object({
  proposals: z.record(z.string(), proposalSchema), view: viewSchema,
  turn: z.number(), firstCall: z.string().nullable(),
  pendingStatus: z.record(z.string(), z.number()),
  /** User messages still queued for later turns, folded from inbox splices. */
  queued: z.number(),
})

/** The current turn's reservation also covers official-plugin recommendations. */
export type CreationState = z.infer<typeof stateSchema>

const blockSchema = proposalSchema.omit({ callId: true }).extend({
  action: z.literal('create_personalized_page'), title: z.string().trim().min(1), brief: z.string().trim().min(1),
}).strict()

/** Read a proposal from a logged event: the last valid `dsh-action` block of an assistant answer,
 * or successful native and PTC result metadata written by earlier sessions.
 * @param event - logged session event.
 * @returns admitted proposal, when present.
 */
export function creationOf(event: SessionEvent): CreationRecommendation | undefined {
  if (event.type === 'assistant/message') {
    const text = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    const blocks = actionBlocksOf(text).map(value => blockSchema.safeParse(value)).filter(parsed => parsed.success)
    const last = blocks.at(-1)
    if (last === undefined) return undefined
    const { action: _action, ...fields } = last.data
    return { callId: ToolCallId(`block:${event.data.message.id}`), ...fields }
  }
  const result = settlement(event)
  const parsed = z.union([
    z.object({ actionCard: z.object({ action: z.literal('create_personalized_page'), data: proposalSchema }) })
      .transform(value => value.actionCard.data),
    // Existing experiment sessions retain their original card receipts.
    z.object({ creationRecommendation: proposalSchema }).transform(value => value.creationRecommendation),
  ]).safeParse(result?.meta)
  return parsed.success ? parsed.data : undefined
}

function settlement(event: SessionEvent) {
  const result = event.type === 'tool/result' ? { ...event.data, isError: event.data.message.isError }
    : event.type === 'tool/ptc-dispatch' ? event.data : undefined
  return result?.isError ? undefined : result
}

/** Card limits the fold needs; the owning service supplies its validated configuration. */
export interface CreationLimits { readonly queuedMessageLimit: number }

/** Definition returned by {@link creationProjection}: the fold, whose empty state needs no Session metadata, plus its client view wire. */
export type CreationProjectionDefinition = Omit<ProjectionDefinition<'creationRecommendations', CreationState>, 'init' | 'wire'> & {
  readonly init: () => CreationState
  readonly wire: NonNullable<ProjectionDefinition<'creationRecommendations', CreationState>['wire']>
}

/** Full-session fold; a later proposal replaces an unstarted card, so one unstarted card exists per conversation.
 * @param limits - validated card limits.
 * @returns the projection definition for this configuration.
 */
export function creationProjection(limits: CreationLimits): CreationProjectionDefinition {
  return {
    key: 'creationRecommendations', stateVersion: 8, stateSchema,
    init: (): CreationState => ({ proposals: {}, view: { decisions: {} }, turn: 0, firstCall: null, pendingStatus: {}, queued: 0 }),
    apply: (state, event) => {
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
        const decision = decisionSchema.parse(record.data)
        return { ...state, view: { decisions: { ...state.view.decisions, [decision.callId]: decision } },
          pendingStatus: { ...state.pendingStatus, [decision.callId]: event.seq } }
      }
      const proposal = creationOf(event)
      const foreign = z.union([
        z.object({ pluginRecommendation: z.object({ callId: z.string().min(1) }) }).transform(value => value.pluginRecommendation.callId),
        z.object({ actionCard: z.object({ action: z.string(), callId: z.string().min(1) }) }).transform(value => value.actionCard.callId),
      ]).safeParse(settlement(event)?.meta)
      const firstCall = state.firstCall ?? proposal?.callId ?? (foreign.success ? foreign.data : null)
      if (proposal === undefined) return firstCall === state.firstCall ? state : { ...state, firstCall }
      // One card per turn: a block written after another card in this turn creates nothing.
      if (firstCall !== proposal.callId) return state
      const decisions = { ...state.view.decisions }
      // Queued user messages mean the user has moved on; the proposal is logged but never offered.
      if (state.queued >= limits.queuedMessageLimit) {
        decisions[proposal.callId] = { callId: proposal.callId, phase: 'suppressed', slot: proposal.slot }
        return { ...state, firstCall, proposals: { ...state.proposals, [proposal.callId]: proposal }, view: { decisions } }
      }
      // A newer proposal supersedes every unstarted card; the model owns that choice, so no status notice is queued.
      for (const earlier of Object.values(state.proposals)) {
        if (earlier.callId !== proposal.callId && decisions[earlier.callId] === undefined) {
          decisions[earlier.callId] = { callId: earlier.callId, phase: 'replaced', slot: earlier.slot }
        }
      }
      return { ...state, firstCall, proposals: { ...state.proposals, [proposal.callId]: proposal }, view: { decisions } }
    },
    wire: { summary: false, viewSchema, view: (state: CreationState) => state.view },
  }
}

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
const officialPluginBlockSchema = z.object({
  action: z.literal('enable_official_plugin'), name: z.string().trim().min(1), reason: z.string().trim().min(1),
}).strict()
const cardBlockSchema = z.discriminatedUnion('action', [blockSchema, officialPluginBlockSchema])

/** A valid `dsh-action` block of either official card experiment. */
export type CardBlock = z.infer<typeof cardBlockSchema>

/** Read the valid card blocks of an assistant answer, in order. The last one is the answer's card,
 * so a page block followed by an official-plugin block offers the plugin, and the reverse offers the page.
 * @param event - logged session event.
 * @returns the answer's card id, its valid blocks and its card, when the event is an answer with at least one.
 */
export function cardBlocksOf(event: SessionEvent):
{ readonly callId: ToolCallId; readonly blocks: readonly CardBlock[]; readonly card: CardBlock } | undefined {
  if (event.type !== 'assistant/message') return undefined
  const text = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  const blocks = actionBlocksOf(text).flatMap((value) => {
    const parsed = cardBlockSchema.safeParse(value)
    return parsed.success ? [parsed.data] : []
  })
  const card = blocks.at(-1)
  return card === undefined ? undefined : { callId: ToolCallId(`block:${event.data.message.id}`), blocks, card }
}

/** Read a proposal from a logged event: the last valid page block of an assistant answer,
 * or successful native and PTC result metadata written by earlier sessions.
 * @param event - logged session event.
 * @returns admitted proposal, when present.
 */
export function creationOf(event: SessionEvent): CreationRecommendation | undefined {
  if (event.type === 'assistant/message') {
    const answer = cardBlocksOf(event)
    const last = answer?.blocks.filter(block => block.action === 'create_personalized_page').at(-1)
    if (answer === undefined || last === undefined) return undefined
    const { action: _action, ...fields } = last
    return { callId: answer.callId, ...fields }
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
    key: 'creationRecommendations', stateVersion: 9, stateSchema,
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
      const answer = cardBlocksOf(event)
      if (proposal === undefined) {
        const foreign = z.union([
          z.object({ pluginRecommendation: z.object({ callId: z.string().min(1) }) }).transform(value => value.pluginRecommendation.callId),
          z.object({ actionCard: z.object({ action: z.string(), callId: z.string().min(1) }) }).transform(value => value.actionCard.callId),
        ]).safeParse(settlement(event)?.meta)
        const firstCall = state.firstCall ?? answer?.callId ?? (foreign.success ? foreign.data : null)
        return firstCall === state.firstCall ? state : { ...state, firstCall }
      }
      const firstCall = state.firstCall ?? proposal.callId
      const decisions = { ...state.view.decisions }
      // Another experiment's card holds this answer or turn: the page block is logged but never offered.
      const foreignCard = answer?.card.action === 'enable_official_plugin'
        || firstCall !== proposal.callId && state.proposals[firstCall] === undefined
      // One card per turn: a block written after another card in this turn creates nothing.
      if (!foreignCard && firstCall !== proposal.callId) return state
      // Queued user messages mean the user has moved on; the proposal is logged but never offered.
      if (foreignCard || state.queued >= limits.queuedMessageLimit) {
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

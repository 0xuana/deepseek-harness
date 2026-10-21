/** Validate logged proposals and recover creation receipts through replay. */
import { z } from 'zod'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { CreationRecommendation } from './types.ts'
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
  decisionSchema, decisionSchema.extend({ phase: z.literal('expired') }),
])) })
const stateSchema = z.object({
  proposals: z.record(z.string(), proposalSchema), view: viewSchema,
  turn: z.number(), firstCall: z.string().nullable(),
  pendingStatus: z.record(z.string(), z.number()),
})

/** The current turn's reservation also covers official-plugin recommendations. */
export type CreationState = z.infer<typeof stateSchema>

/** Read only successful native and PTC result metadata.
 * @param event - logged session event.
 * @returns admitted creation metadata, when present.
 */
export function creationOf(event: SessionEvent): CreationRecommendation | undefined {
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

/** Full-session fold; later explicit needs may offer another card in another turn. */
export const creationProjection = {
  key: 'creationRecommendations', stateVersion: 6, stateSchema,
  init: (): CreationState => ({ proposals: {}, view: { decisions: {} }, turn: 0, firstCall: null, pendingStatus: {} }),
  apply: (state, event) => {
    if (event.type === 'turn/start') return { ...state, turn: event.data.turn, firstCall: null }
    const humanMessage = event.type === 'agent/inbox/spliced'
      ? event.data.inserted.some(message => message.source.kind === 'user')
      : event.type === 'user/message' && event.data.source.kind === 'user'
    if (humanMessage) {
      const pending = Object.values(state.proposals).filter(proposal => state.view.decisions[proposal.callId] === undefined)
      if (pending.length === 0) return state
      const decisions = { ...state.view.decisions }
      const pendingStatus = { ...state.pendingStatus }
      for (const proposal of pending) {
        decisions[proposal.callId] = { callId: proposal.callId, phase: 'expired', slot: proposal.slot }
        pendingStatus[proposal.callId] = event.seq
      }
      return { ...state, view: { decisions }, pendingStatus }
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
    return proposal === undefined ? firstCall === state.firstCall ? state : { ...state, firstCall }
      : { ...state, firstCall, proposals: { ...state.proposals, [proposal.callId]: proposal } }
  },
  wire: { summary: false, viewSchema, view: (state: CreationState) => state.view },
} satisfies ProjectionDefinition<'creationRecommendations', CreationState>

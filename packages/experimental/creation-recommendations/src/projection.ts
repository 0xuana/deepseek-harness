/** Validate logged proposals and recover creation receipts through replay. */
import { z } from 'zod'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { CreationRecommendation } from './types.ts'
import type {} from '@deepseek-ai/dsh-tools/types'

/** Model and wire values use the same three supported locations. */
export const slotSchema = z.enum(['sidebar-right', 'page', 'sidebar-left'])
const proposalSchema = z.object({
  callId: z.string().min(1).transform(ToolCallId),
  title: z.string().min(1), brief: z.string().min(1), slot: slotSchema,
}).strict()
const decisionSchema = z.object({
  callId: z.string().min(1).transform(ToolCallId),
  phase: z.enum(['dismissed', 'creating', 'installing', 'cancelled', 'installed', 'kept', 'removed', 'failed', 'interrupted', 'unconfirmed']),
  slot: slotSchema, bundleName: z.string().optional(),
  application: z.enum(['applied', 'restart-required', 'overridden', 'failed', 'cancelled']).optional(),
})
const viewSchema = z.object({ decisions: z.record(z.string(), decisionSchema) })
const stateSchema = z.object({
  proposals: z.record(z.string(), proposalSchema), view: viewSchema,
  turn: z.number(), firstCall: z.string().nullable(),
})

/** The current turn's reservation also covers official-plugin recommendations. */
export type CreationState = z.infer<typeof stateSchema>

/** Read only successful native and PTC result metadata.
 * @param event - logged session event.
 * @returns admitted creation metadata, when present.
 */
export function creationOf(event: SessionEvent): CreationRecommendation | undefined {
  const result = settlement(event)
  const parsed = z.object({ creationRecommendation: proposalSchema }).safeParse(result?.meta)
  return parsed.success ? parsed.data.creationRecommendation : undefined
}

function settlement(event: SessionEvent) {
  const result = event.type === 'tool/result' ? { ...event.data, isError: event.data.message.isError }
    : event.type === 'tool/ptc-dispatch' ? event.data : undefined
  return result?.isError ? undefined : result
}

/** Full-session fold; later explicit needs may offer another card in another turn. */
export const creationProjection = {
  key: 'creationRecommendations', stateVersion: 2, stateSchema,
  init: (): CreationState => ({ proposals: {}, view: { decisions: {} }, turn: 0, firstCall: null }),
  apply: (state, event) => {
    if (event.type === 'turn/start') return { ...state, turn: event.data.turn, firstCall: null }
    const record = pluginRecordOf(event)
    if (record?.type === 'plugin:creation-recommendations/decision') {
      const decision = decisionSchema.parse(record.data)
      return { ...state, view: { decisions: { ...state.view.decisions, [decision.callId]: decision } } }
    }
    const proposal = creationOf(event)
    const foreign = z.object({ pluginRecommendation: z.object({ callId: z.string().min(1) }) }).safeParse(settlement(event)?.meta)
    const firstCall = state.firstCall ?? proposal?.callId ?? (foreign.success ? foreign.data.pluginRecommendation.callId : null)
    return proposal === undefined ? firstCall === state.firstCall ? state : { ...state, firstCall }
      : { ...state, firstCall, proposals: { ...state.proposals, [proposal.callId]: proposal } }
  },
  wire: { summary: false, viewSchema, view: (state: CreationState) => state.view },
} satisfies ProjectionDefinition<'creationRecommendations', CreationState>

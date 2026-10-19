/** Validate tool facts and fold decisions without scanning session history. */
import { z } from 'zod'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { PluginRecommendation, RecommendationOutcome } from './types.ts'
import type {} from '@deepseek-ai/dsh-tools/types'

const recommendationSchema: z.ZodType<PluginRecommendation> = z.object({
  callId: z.string().min(1).transform(ToolCallId),
  name: z.string().min(1),
  titleEn: z.string(), titleZh: z.string(),
  descriptionEn: z.string(), descriptionZh: z.string(),
  request: z.string().min(1), reason: z.string().min(1),
}).strict()

const outcomeSchema: z.ZodType<RecommendationOutcome> = z.enum([
  'dismissed', 'applied', 'restart-required', 'overridden', 'failed', 'cancelled',
])

/** The host retains proposals to validate actions; clients only need decisions. */
const viewSchema = z.object({ decisions: z.record(z.string(), outcomeSchema) })
/** Cache validation for proposals and experimental decision records. */
export const stateSchema = z.object({
  proposals: z.record(z.string(), recommendationSchema),
  view: viewSchema,
})

/** Validated proposals and durable card decisions. */
export type RecommendationState = z.infer<typeof stateSchema>

/** Reject unrelated, failed, or malformed native and PTC tool settlements.
 * @param event - persisted Session event.
 * @returns a validated proposal when the tool supplied its presentation metadata.
 */
export function recommendationOf(event: SessionEvent): PluginRecommendation | undefined {
  const result = event.type === 'tool/result' ? { ...event.data, isError: event.data.message.isError }
    : event.type === 'tool/ptc-dispatch' ? event.data : undefined
  if (result === undefined || result.isError) return undefined
  const parsed = z.object({ pluginRecommendation: recommendationSchema }).safeParse(result.meta)
  return parsed.success ? parsed.data.pluginRecommendation : undefined
}

/** Whole-log fold; late decisions survive card pagination and reconnect. */
export const recommendationProjection = {
  key: 'pluginRecommendations',
  stateVersion: 1,
  stateSchema,
  init: (): RecommendationState => ({ proposals: {}, view: { decisions: {} } }),
  apply: (state, event) => {
    const record = pluginRecordOf(event)
    if (record?.type === 'plugin:plugin-recommendations/decision') {
      const decision = z.object({ callId: z.string().min(1), outcome: outcomeSchema }).parse(record.data)
      return { ...state, view: { decisions: { ...state.view.decisions, [decision.callId]: decision.outcome } } }
    }
    const recommendation = recommendationOf(event)
    return recommendation === undefined ? state
      : { ...state, proposals: { ...state.proposals, [recommendation.callId]: recommendation } }
  },
  wire: {
    summary: false,
    viewSchema,
    view: (state: RecommendationState) => state.view,
  },
} satisfies ProjectionDefinition<'pluginRecommendations', RecommendationState>

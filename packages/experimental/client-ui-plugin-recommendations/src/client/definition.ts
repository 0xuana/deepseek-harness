/** Turn-indexed recommendations derived from validated native or PTC results. */
import type { PluginRecommendation } from '@deepseek-ai/dsh-experimental-plugin-recommendations/types'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap { 'plugin-recommendation': PluginRecommendation }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Older or malformed metadata stays with the ordinary tool renderer.
 * @param event - native or PTC settlement from the transcript.
 * @returns the validated recommendation, if present.
 */
export function recommendationOf(event: { readonly type: string; readonly data: unknown }): PluginRecommendation | undefined {
  if (!record(event.data)) return undefined
  const result = event.type === 'tool/result' && record(event.data.message) ? { ...event.data, isError: event.data.message.isError }
    : event.type === 'tool/ptc-dispatch' ? event.data : undefined
  if (!record(result) || result.isError || !record(result.meta)) return undefined
  const value = result.meta.pluginRecommendation
  if (!record(value)) return undefined
  if (typeof value.callId !== 'string' || typeof value.name !== 'string'
    || typeof value.titleEn !== 'string' || typeof value.titleZh !== 'string'
    || typeof value.descriptionEn !== 'string' || typeof value.descriptionZh !== 'string'
    || typeof value.request !== 'string' || typeof value.reason !== 'string') return undefined
  if (value.callId === '' || value.name === '' || value.request === '' || value.reason === '') return undefined
  return {
    callId: value.callId as ToolCallId, name: value.name, titleEn: value.titleEn, titleZh: value.titleZh,
    descriptionEn: value.descriptionEn, descriptionZh: value.descriptionZh, request: value.request, reason: value.reason,
  }
}

/** Retain proposal data without rendering a card inside the tool sequence. */
export const recommendationDefinition = {
  kind: 'plugin-recommendation', target: 'chat',
  match: (event) => {
    const value = recommendationOf(event)
    return value === undefined ? null : { id: value.callId, role: 'start' }
  },
  start: (_context, match) => recommendationOf(match.event) as PluginRecommendation,
  update: context => context.state,
  buildViewNode: (context) => {
    const start = context.start
    if (context.state === undefined || start === undefined) return null
    return {
      key: context.key, kind: 'plugin-recommendation', id: context.id, target: 'chat',
      anchorSeq: start.event.seq, location: start.location, visibility: 'hidden', data: context.state,
    } satisfies ChatNode<'plugin-recommendation'>
  },
} satisfies ConversationNodeDefinition<PluginRecommendation>

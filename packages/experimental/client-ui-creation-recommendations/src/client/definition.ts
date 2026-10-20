/** Turn-indexed creation proposals from native and PTC results. */
import type { CreationRecommendation } from '@deepseek-ai/dsh-experimental-creation-recommendations/types'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap { 'creation-recommendation': CreationRecommendation }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Leave malformed or failed metadata with the ordinary tool renderer.
 * @param event - Persisted native or PTC result.
 * @returns validated creation proposal, if present.
 */
export function recommendationOf(event: { readonly type: string; readonly data: unknown }): CreationRecommendation | undefined {
  if (!record(event.data)) return undefined
  const result = event.type === 'tool/result' && record(event.data.message) ? { ...event.data, isError: event.data.message.isError }
    : event.type === 'tool/ptc-dispatch' ? event.data : undefined
  if (!record(result) || result.isError || !record(result.meta)) return undefined
  const value = result.meta.creationRecommendation
  if (!record(value) || typeof value.callId !== 'string' || value.callId === ''
    || typeof value.title !== 'string' || value.title === '' || typeof value.brief !== 'string' || value.brief === ''
    || value.slot !== 'sidebar-right' && value.slot !== 'page' && value.slot !== 'sidebar-left') return undefined
  return { callId: value.callId as ToolCallId, title: value.title, brief: value.brief, slot: value.slot }
}

/** Retain proposal data without rendering inside the tool sequence. */
export const recommendationDefinition = {
  kind: 'creation-recommendation', target: 'chat',
  match: (event) => {
    const value = recommendationOf(event)
    return value === undefined ? null : { id: value.callId, role: 'start' }
  },
  start: (_context, match) => recommendationOf(match.event) as CreationRecommendation,
  update: context => context.state,
  buildViewNode: (context) => {
    const start = context.start
    if (context.state === undefined || start === undefined) return null
    return {
      key: context.key, kind: 'creation-recommendation', id: context.id, target: 'chat',
      anchorSeq: start.event.seq, location: start.location, visibility: 'hidden', data: context.state,
    } satisfies ChatNode<'creation-recommendation'>
  },
} satisfies ConversationNodeDefinition<CreationRecommendation>

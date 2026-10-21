/** Turn-indexed official-plugin proposals read from answer blocks. */
import type { PluginRecommendation } from '@deepseek-ai/dsh-experimental-plugin-recommendations/types'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { actionBlocksOf } from '@deepseek-ai/dsh-experimental-creation-recommendations/action-block'

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap { 'plugin-recommendation': PluginRecommendation }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a proposal from a logged answer: its last valid official-plugin `dsh-action` block.
 * The Host card state decides whether another card holds the answer or turn.
 * @param event - Persisted assistant message.
 * @returns validated proposal, if present.
 */
export function recommendationOf(event: { readonly type: string; readonly data: unknown }): PluginRecommendation | undefined {
  if (event.type !== 'assistant/message' || !record(event.data)) return undefined
  const message = event.data.message
  if (!record(message) || !Array.isArray(message.content) || typeof message.id !== 'string' || message.id === '') return undefined
  const text = message.content.flatMap(block => record(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n')
  const last = actionBlocksOf(text).flatMap(value => record(value) && value.action === 'enable_official_plugin'
    && Object.keys(value).length === 3 && typeof value.name === 'string' && value.name.trim() !== ''
    && typeof value.reason === 'string' && value.reason.trim() !== '' ? [{ name: value.name.trim(), reason: value.reason.trim() }] : []).at(-1)
  return last === undefined ? undefined : { callId: `block:${message.id}` as ToolCallId, ...last }
}

/** Retain proposal data without rendering inside the answer. */
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

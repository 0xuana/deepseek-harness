/** Turn-indexed creation proposals from native and PTC results. */
import type { CreationRecommendation } from '@deepseek-ai/dsh-experimental-creation-recommendations/types'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { actionBlocksOf } from '@deepseek-ai/dsh-util-action-block'

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap { 'creation-recommendation': CreationRecommendation }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function proposalFields(value: unknown): Omit<CreationRecommendation, 'callId'> | undefined {
  if (!record(value) || typeof value.title !== 'string' || value.title.trim() === '' || typeof value.brief !== 'string' || value.brief.trim() === ''
    || value.slot !== 'sidebar-right' && value.slot !== 'page' && value.slot !== 'sidebar-left'
    || value.initialContent !== undefined && typeof value.initialContent !== 'string') return undefined
  return {
    title: value.title.trim(), brief: value.brief.trim(), slot: value.slot,
    ...value.initialContent === undefined ? {} : { initialContent: value.initialContent },
  }
}

/** Read a proposal from a logged event: the last valid `dsh-action` block of an assistant answer,
 * or earlier sessions' tool result metadata.
 * @param event - Persisted assistant message, native or PTC result.
 * @returns validated creation proposal, if present.
 */
export function recommendationOf(event: { readonly type: string; readonly data: unknown }): CreationRecommendation | undefined {
  if (!record(event.data)) return undefined
  if (event.type === 'assistant/message') {
    const message = event.data.message
    if (!record(message) || !Array.isArray(message.content) || typeof message.id !== 'string' || message.id === '') return undefined
    const text = message.content.flatMap(block => record(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n')
    const blocks = actionBlocksOf(text).flatMap(value => record(value) && value.action === 'create_personalized_page' ? [proposalFields(value)] : [])
      .filter((fields): fields is Omit<CreationRecommendation, 'callId'> => fields !== undefined)
    const last = blocks.at(-1)
    return last === undefined ? undefined : { callId: `block:${message.id}` as ToolCallId, ...last }
  }
  const result = event.type === 'tool/result' && record(event.data.message) ? { ...event.data, isError: event.data.message.isError }
    : event.type === 'tool/ptc-dispatch' ? event.data : undefined
  if (!record(result) || result.isError || !record(result.meta)) return undefined
  const card = result.meta.actionCard
  const value = record(card) && card.action === 'create_personalized_page' ? card.data : result.meta.creationRecommendation
  if (!record(value) || typeof value.callId !== 'string' || value.callId === '') return undefined
  const fields = proposalFields(value)
  return fields === undefined ? undefined : { callId: value.callId as ToolCallId, ...fields }
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

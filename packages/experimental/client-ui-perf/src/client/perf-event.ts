/** Non-step event rows: request admission, prompt/tool changes, and model-free prunes. */

import type {
  ConversationLocation, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-compaction/types'
import type {} from '@deepseek-ai/dsh-tools'
import type { LlmRetryEventData } from '@deepseek-ai/dsh-llm-retry/types'
import type {} from '@deepseek-ai/dsh-user-approval/types'
import type { SessionEventMap } from '@deepseek-ai/dsh-session/types'
import type { PerfEventMetrics } from './perf-contract.ts'

/** Event shape a Conversation Definition receives. */
type MatchEvent = Parameters<ConversationNodeDefinition['match']>[0]

/** Payload of an event whose type is known to the caller. */
function dataOf<T>(event: MatchEvent): T {
  return (event as MatchEvent & { data: T }).data
}

/** Turn and step a Location resolves, or null when the window lost them. */
function locationTurnStep(
  location: ConversationLocation | undefined,
): { readonly turn: number; readonly step: number | null } | null {
  if (location === undefined) return null
  if (location.kind === 'turn') return { turn: location.turn.turn, step: null }
  if (location.kind === 'step') return { turn: location.turn.turn, step: location.step.step }
  return null
}

/** Text characters of a message content list. */
function contentChars(content: readonly { readonly type: string; readonly text?: string }[]): number {
  let chars = 0
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') chars += block.text.length
  }
  return chars
}

/** Tool names added or removed by one developer message. */
function toolChanges(
  content: readonly { readonly type: string; readonly toolName?: string }[],
): { added: string[]; removed: string[] } {
  const added: string[] = []
  const removed: string[] = []
  for (const block of content) {
    if (typeof block.toolName !== 'string') continue
    if (block.type === 'tool-addition') added.push(block.toolName)
    else if (block.type === 'tool-removal') removed.push(block.toolName)
  }
  return { added, removed }
}

/**
 * Normalize one non-step event into row values.
 * @param event - a session event seen by the Definition match.
 * @param location - engine Location of the event, for turn and step.
 * @returns row metrics, or null for events the table does not explain.
 */
export function eventMetrics(event: MatchEvent, location: ConversationLocation | undefined): PerfEventMetrics | null {
  const located = locationTurnStep(location)
  const base = {
    turn: located?.turn ?? null,
    step: located?.step ?? null,
    time: event.time,
    reason: null,
    series: false,
    provider: null,
    model: null,
    toolCount: null,
    surfaceOp: null,
    chars: null,
    added: [] as string[],
    removed: [] as string[],
    shadowedTokens: null,
    status: null,
    retry: null,
    delayMs: null,
    error: null,
    label: null,
  } satisfies Omit<PerfEventMetrics, 'kind'>
  if (event.type === 'request/header') {
    const header = event.data.header
    return {
      ...base,
      kind: 'request-header',
      reason: event.data.reason,
      series: event.data.startsSeries === true,
      provider: header.config.provider,
      model: header.config.model,
      toolCount: header.tools?.length ?? null,
    }
  }
  if (event.type === 'system/message') {
    const chars = contentChars(event.data.message.content)
    const action = event.surfaceOp === 'append'
      ? 'append'
      : chars === 0 ? 'clear' : 'replace'
    return { ...base, kind: 'system-prompt', surfaceOp: action, chars }
  }
  if (event.type === 'developer/message') {
    if (event.data.message.source.kind !== 'tool-registry') return null
    const changes = toolChanges(event.data.message.content)
    if (changes.added.length === 0 && changes.removed.length === 0) return null
    return { ...base, kind: 'tool-set', ...changes }
  }
  if (event.type === 'compaction/prune') {
    return { ...base, kind: 'context-prune', shadowedTokens: event.data.shadowedTokenCount }
  }
  const eventType: string = event.type
  if (eventType === 'request/context') {
    const data = dataOf<SessionEventMap['request/context']>(event)
    return {
      ...base,
      kind: 'request-context',
      provider: data.provider,
      model: data.model,
      status: data.systemPromptUpdate ?? null,
      chars: data.contextWindow ?? null,
    }
  }
  if (eventType === 'llm/retry') {
    const data = dataOf<LlmRetryEventData>(event)
    return {
      ...base,
      kind: 'model-retry',
      turn: data.turn,
      step: data.step,
      provider: data.provider,
      status: data.mode,
      retry: data.retry,
      delayMs: data.delayMs,
      error: data.failure.message,
    }
  }
  if (eventType === 'assistant/attempt') {
    const data = dataOf<{ turn: number; step: number }>(event)
    return {
      ...base,
      kind: 'model-attempt',
      turn: data.turn,
      step: data.step,
      status: 'attempt',
    }
  }
  if (eventType === 'user/message') {
    const data = dataOf<{
      source: { kind: string }
      content: readonly { type: string; text?: string }[]
    }>(event)
    if (data.source.kind !== 'runtime-context' && data.source.kind !== 'time-context') return null
    return {
      ...base,
      kind: 'context-refresh',
      status: data.source.kind,
      chars: contentChars(data.content),
    }
  }
  if (eventType === 'approval/asked') {
    const data = dataOf<{ toolName: string; reason?: string }>(event)
    return {
      ...base,
      kind: 'approval',
      status: 'asked',
      label: data.toolName,
      error: data.reason ?? null,
    }
  }
  if (eventType === 'approval/decided') {
    const data = dataOf<{ outcome: string }>(event)
    return { ...base, kind: 'approval', status: data.outcome }
  }
  return null
}

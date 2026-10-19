/**
 * Conversation Definitions producing the performance target's nodes: one step
 * context per `step/start`, one prompt marker per turn, one end marker per turn.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationLocation, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PerfStepState, PerfViewNode } from './perf-contract.ts'
import {
  currentTurnOf, fallbackState, foldEvent, newState, ptcStepOf, stepMetrics,
} from './perf-fold.ts'

/** Target name shared by every Definition and the view builder. */
export const TARGET = 'perf'

/** Definition kind of one measured step. */
const STEP_KIND = 'perf-step'

/** Definition kind of a turn's prompt marker. */
const PROMPT_KIND = 'perf-prompt'

/** Definition kind of a turn's end marker. */
const END_KIND = 'perf-turn-end'

/** Marker ids never collide with a step number. */
const PROMPT_STEP = 0
const END_STEP = 100_000

/** Wrap one contribution in the target's node envelope. */
function perfNode(
  context: ConversationNodeContext<PerfStepState>,
  anchorSeq: number,
  data: PerfViewNode['data'],
): PerfViewNode {
  const location: ConversationLocation = context.start?.location
    ?? context.matches.at(-1)?.location
    ?? { kind: 'unresolved' }
  return {
    key: context.key,
    kind: context.kind,
    id: context.id,
    target: TARGET,
    anchorSeq,
    location,
    data,
  }
}

/** State a step context folds from the matches a trimmed window still holds. */
function stepState(context: ConversationNodeContext<PerfStepState>): PerfStepState | undefined {
  return context.state ?? fallbackState(context.matches)
}

/** One measured step per `step/start`, updated by its stream, tools, and end. */
const stepDefinition: ConversationNodeDefinition<PerfStepState> = {
  kind: STEP_KIND,
  target: TARGET,
  match: (event) => {
    switch (event.type) {
      case 'step/start':
        return { id: `${event.data.turn}:${event.data.step}`, role: 'start' }
      case 'step/end':
      case 'assistant/live-chunk':
      case 'assistant/attempt':
      case 'assistant/message':
      case 'llm/retry':
      case 'tool/call':
      case 'tool/result':
        return { id: `${event.data.turn}:${event.data.step}`, role: 'update' }
      case 'tool/ptc-dispatch':
      case 'tool/ptc-dispatch-start': {
        const id = ptcStepOf(event.data.rootCallId)
        return id === null ? null : { id, role: 'update' }
      }
      default:
        return null
    }
  },
  start: (_context, match) => {
    if (match.event.type !== 'step/start') {
      throw new Error('perf-step start requires step/start')
    }
    return { ...newState(match.event.data.turn, match.event.data.step), startSeq: match.event.seq, startTime: match.event.time }
  },
  update: (context, match) => foldEvent(context.state, match.event) ?? context.state,
  publication: (match) => {
    if (match.event.type === 'step/start') return 'none'
    // Stream deltas drive no column of this table; the settled message does.
    if (match.event.type === 'assistant/live-chunk' || match.event.type === 'assistant/attempt') return 'none'
    return 'immediate'
  },
  buildViewNode: (context) => {
    const state = stepState(context)
    if (state === undefined) return null
    return perfNode(context, state.startSeq ?? context.start?.event.seq ?? 0, {
      kind: 'step',
      metrics: stepMetrics(state),
    })
  },
}

/** The user question of one turn; `user/message` carries no turn of its own. */
const promptDefinition: ConversationNodeDefinition<PerfStepState> = {
  kind: PROMPT_KIND,
  target: TARGET,
  match: (event) => {
    if (event.type === 'turn/start') {
      return { id: `${event.data.turn}:${PROMPT_STEP}`, role: 'start' }
    }
    if (event.type !== 'user/message') return null
    const turn = currentTurnOf()
    const source: unknown = event.data.source
    if (turn === null || typeof source !== 'object' || source === null) return null
    return (source as { kind?: unknown }).kind === 'user'
      ? { id: `${turn}:${PROMPT_STEP}`, role: 'update' }
      : null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') {
      throw new Error('perf-prompt start requires turn/start')
    }
    return foldEvent(undefined, match.event) ?? newState(match.event.data.turn, PROMPT_STEP, 'prompt')
  },
  update: (context, match) => foldEvent(context.state, match.event) ?? context.state,
  publication: match => (match.event.type === 'turn/start' ? 'none' : 'immediate'),
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined) return null
    return perfNode(context, context.start?.event.seq ?? 0, {
      kind: 'prompt',
      turn: state.turn,
      prompt: state.prompt,
      images: state.images,
    })
  },
}

/** Closes a turn, including an interrupted tail whose last step never ended. */
const endDefinition: ConversationNodeDefinition<PerfStepState> = {
  kind: END_KIND,
  target: TARGET,
  match: event => (event.type === 'turn/end'
    ? { id: `${event.data.turn}:${END_STEP}`, role: 'start' }
    : null),
  start: (_context, match) => {
    if (match.event.type !== 'turn/end') {
      throw new Error('perf-turn-end start requires turn/end')
    }
    const reason = match.event.data.reason
    const closeKind = 'kind' in reason && typeof reason.kind === 'string' ? reason.kind : null
    return {
      ...newState(match.event.data.turn, END_STEP, 'end'),
      ended: true,
      endTime: match.event.time,
      closed: true,
      closeKind,
    }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined) return null
    return perfNode(context, context.start?.event.seq ?? 0, {
      kind: 'end',
      turn: state.turn,
      closeKind: state.closeKind,
      endTime: state.endTime,
    })
  },
}

/**
 * Register the three Definitions. Each registration rides the caller's fiber
 * effect, so unloading the plugin removes the nodes with it.
 * @param ctx - client root context.
 */
export function registerPerfDefinitions(ctx: Context): void {
  ctx.uiConversation.events.register(stepDefinition)
  ctx.uiConversation.events.register(promptDefinition)
  ctx.uiConversation.events.register(endDefinition)
}

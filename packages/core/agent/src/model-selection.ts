/**
 * Session model selection: the `modelSelection` projection fold, which the
 * Agent registry registers as the only selection state, plus the helpers
 * runtime entry points use to read it, record `model/selection` events, and
 * announce a route switch to the model.
 * @module @deepseek-ai/dsh-agent/model-selection
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  boundContextSummary,
  createUserMessage,
  ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import type { EpochHeader } from '@deepseek-ai/dsh-session'
import type SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type { AgentOptions, PreStepDecision } from './runtime-types.ts'
import type { Agent, ModelSelection, ModelSelectionProjectionState } from './types.ts'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'model-selection': { kind: 'model-selection' } & ContextFormed
  }
}

/** Projection reader the selection helpers require. */
type ModelSelectionProjections = Pick<SessionProjectionRegistry, 'stateOf'>

/** Build a selection, omitting an absent effort. */
function toSelection(provider: string, model: string, reasoningEffort: ReasoningEffortId | undefined): ModelSelection {
  return { provider, model, ...reasoningEffort === undefined ? {} : { reasoningEffort } }
}

/** Compare two complete selections, treating an absent effort as its own value. */
function sameModelSelection(left: ModelSelection | null, right: ModelSelection | null): boolean {
  return left === right || (left !== null && right !== null
    && sameRoute(left, right) && left.reasoningEffort === right.reasoningEffort)
}

/** Selection a recorded request used, omitting an effort the adapter defaulted. */
function selectionOfHeader({ config, adapterDefaults }: EpochHeader): ModelSelection {
  return toSelection(config.provider, config.model, adapterDefaults?.reasoningEffort === true ? undefined : config.reasoningEffort)
}

const selectionSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).transform(ReasoningEffortId).exactOptional(),
}).nullable()

/**
 * Projection fold registered by the Agent registry: recorded selections become
 * the pending choice, and each request header retires a matching one.
 */
export const modelSelectionProjectionDefinition = {
  key: 'modelSelection',
  stateVersion: 3,
  stateSchema: z.object({ lastUsed: selectionSchema, pending: selectionSchema }),
  init: () => ({ lastUsed: null, pending: null }),
  apply: (state, event) => {
    if (event.type === 'model/selection') {
      return sameModelSelection(state.pending, event.data) ? state : { ...state, pending: { ...event.data } }
    }
    if (event.type !== 'request/header') return state
    const lastUsed = selectionOfHeader(event.data.header)
    const pending = sameModelSelection(state.pending, lastUsed) ? null : state.pending
    return sameModelSelection(state.lastUsed, lastUsed) && pending === state.pending ? state : { lastUsed, pending }
  },
  wire: {
    viewSchema: z.object({ lastUsed: selectionSchema, next: selectionSchema }),
    view: state => ({ lastUsed: state.lastUsed, next: state.pending ?? state.lastUsed }),
  },
} satisfies ProjectionDefinition<'modelSelection', ModelSelectionProjectionState>

/**
 * Read the selection the Agent's next model step uses: the latest recorded
 * selection, then the latest request's selection, then the route in
 * `agent.options`. A step that already started keeps its own snapshot.
 * @param projections - registry carrying the `modelSelection` projection.
 * @param agent - Agent whose Session is read.
 * @returns a detached selection, or undefined when no source names both provider and model.
 * @throws when the `modelSelection` projection is not registered.
 */
export function currentModelSelection(
  projections: ModelSelectionProjections,
  agent: Agent,
): ModelSelection | undefined {
  const state = projections.stateOf(agent.session, 'modelSelection')
  if (state === undefined) {
    throw new Error(`agent "${agent.id}": the modelSelection projection is not registered; mount dsh-session-projection`)
  }
  const recorded = state.pending ?? state.lastUsed
  if (recorded !== null) return { ...recorded }
  const { provider, model, reasoningEffort } = agent.options
  return provider && model ? toSelection(provider, model, reasoningEffort) : undefined
}

/**
 * Record the selection the Agent's next model step uses. A selection equal to
 * {@link currentModelSelection} records nothing; callers validate the route first.
 * @param projections - registry carrying the `modelSelection` projection.
 * @param agent - Agent whose Session receives the `model/selection` event.
 * @param selection - complete provider, model, and optional reasoning effort.
 */
export function recordModelSelection(
  projections: ModelSelectionProjections,
  agent: Agent,
  selection: ModelSelection,
): void {
  if (sameModelSelection(currentModelSelection(projections, agent) ?? null, selection)) return
  agent.session.append('model/selection', toSelection(selection.provider, selection.model, selection.reasoningEffort))
}

/**
 * Record a route declared by deployment configuration. The declared provider
 * and model replace the current selection; a declaration without an effort
 * keeps the current explicit effort for the same route and otherwise leaves
 * the adapter default.
 * @param projections - registry carrying the `modelSelection` projection.
 * @param agent - Agent whose selection is recorded.
 * @param declared - configured options; a declaration without both provider and model changes nothing.
 */
export function recordDeclaredRoute(
  projections: ModelSelectionProjections,
  agent: Agent,
  declared: AgentOptions,
): void {
  const { provider, model } = declared
  if (!provider || !model) return
  const current = currentModelSelection(projections, agent)
  const inherited = current !== undefined && sameRoute(current, { provider, model }) ? current.reasoningEffort : undefined
  recordModelSelection(projections, agent, toSelection(provider, model, declared.reasoningEffort ?? inherited))
}

function sameRoute(left: ModelSelection, right: ModelSelection): boolean {
  return left.provider === right.provider && left.model === right.model
}

function routeLabel(route: ModelSelection, other: ModelSelection): string {
  return route.provider === other.provider ? route.model : `${route.provider}/${route.model}`
}

function modelSwitchNotice(previous: ModelSelection, selected: ModelSelection) {
  const from = routeLabel(previous, selected)
  const to = routeLabel(selected, previous)
  return createUserMessage({
    content: [{
      type: 'text' as const,
      text: `[model changed: assistant turns above this point were generated by ${from}; the session continues with ${to}]`,
    }],
    source: {
      kind: 'model-selection',
      form: 'notice',
      summary: boundContextSummary(`${from} → ${to}`),
    },
  })
}

/**
 * Append a model-switch notice when the step's fixed route differs from the
 * last request header. Effort-only changes and empty no-request decisions add
 * no notice; a failure before header persistence repeats it on the next step.
 * @param agentCtx - The selected Agent's scoped context.
 * @returns Disposer for the scoped pre-step listener.
 */
export function installModelSwitchNotice(agentCtx: Context): () => void {
  return agentCtx.on(
    'agent/pre-step',
    async ({ agent, messages, signal, step, callConfig }, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted) return decision
      // The loop skips an empty first step and an emptied offered continuation.
      if (decision.messages.length === 0 && (step === 1 || messages.length > 0)) return decision
      const previous = agent.session.requestHeader()?.config
      if (previous === undefined || sameRoute(callConfig, previous)) return decision
      return { ...decision, messages: [...decision.messages, modelSwitchNotice(previous, callConfig)] }
    },
    { prepend: true },
  )
}

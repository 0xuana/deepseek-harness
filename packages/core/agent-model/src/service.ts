/** Session selection operations; the provider owns projection registration. */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent/types'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import type {} from './types.ts'
import { sameModelSelection, sameRoute, toSelection } from './selection.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Session model selection for steps that have not begun preparation. */
    agentModel: AgentModel
  }
}

/** Read and record Session model choices without resolving adapter defaults. */
export class AgentModel extends Service {
  static inject = ['sessionProjections']

  /**
   * Provider-bound projection reader, usable while dependent callers drain. The
   * plain holder keeps Cordis from re-tracing it through each caller's context.
   */
  private readonly runtime: { projections: SessionProjectionRegistry }

  constructor(ctx: Context) {
    super(ctx, 'agentModel')
    this.runtime = { projections: ctx.sessionProjections }
  }

  /**
   * Resolve the choice for the next step to begin preparation. Recorded choices
   * take precedence over the last request and then the Agent's live options.
   * This read neither starts a step nor changes an already-prepared step.
   * @param agent - Agent whose Session and fallback options are read.
   * @returns a detached choice, or undefined when no source names both provider and model.
   */
  resolveForNextStep(agent: Agent): Readonly<ModelSelection> | undefined {
    const recorded = this.recordedSelection(agent)
    if (recorded !== null) return { ...recorded }
    const { provider, model, reasoningEffort } = agent.options
    return provider && model ? toSelection(provider, model, reasoningEffort) : undefined
  }

  /**
   * Replace the next step's complete selection. Omitted effort follows adapter
   * defaults. An equal recorded choice is a no-op; an options-only fallback is
   * always recorded. Callers own model availability and capability validation.
   * The append uses the Session's existing persistence and failure guarantees.
   * @param agent - Agent whose Session receives the model/selection event.
   * @param selection - complete provider, model, and optional explicit effort.
   */
  select(agent: Agent, selection: Readonly<ModelSelection>): void {
    if (sameModelSelection(this.recordedSelection(agent), selection)) return
    agent.session.append('model/selection', toSelection(selection.provider, selection.model, selection.reasoningEffort))
  }

  /**
   * Apply an explicit deployment route, including on Session resume. An omitted
   * effort inherits the current explicit effort only for the same route;
   * otherwise it follows adapter defaults. Call only when the entry point
   * explicitly overrides recorded selection, not for ordinary resume fallback.
   * @param agent - Agent whose Session receives the configured choice.
   * @param selection - complete configured provider/model and optional effort.
   */
  applyConfiguredRoute(agent: Agent, selection: Readonly<ModelSelection>): void {
    const current = this.resolveForNextStep(agent)
    const inherited = current !== undefined && sameRoute(current, selection) ? current.reasoningEffort : undefined
    this.select(agent, toSelection(selection.provider, selection.model, selection.reasoningEffort ?? inherited))
  }

  private recordedSelection(agent: Agent): ModelSelection | null {
    const state = this.runtime.projections.stateOf(agent.session, 'modelSelection')
    if (state === undefined) throw new Error('agent-model: used after its provider unloaded the modelSelection projection')
    return state.pending ?? state.lastUsed
  }
}

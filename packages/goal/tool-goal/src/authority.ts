/** Execution-time authority checks for the model-facing goal tools. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { GoalId, type GoalView } from '@deepseek-ai/dsh-goal'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ProjectionDefinition, ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { z as zod } from 'zod'

const turnAuthoritySchema = zod.object({
  open: zod.boolean(),
  directHuman: zod.boolean(),
  goalRounds: zod.array(zod.object({
    goalId: zod.string().transform(GoalId),
    revision: zod.number().int().positive(),
    round: zod.number().int().positive(),
  })),
})

/** Accepted input authority for the currently open turn, reset at both turn boundaries. */
type TurnAuthority = zod.infer<typeof turnAuthoritySchema>

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Input sources admitted in the current turn for goal-tool authorization. */
    goalToolAuthority: TurnAuthority
  }
}

const turnAuthorityProjection = {
  key: 'goalToolAuthority',
  stateVersion: 1,
  stateSchema: turnAuthoritySchema,
  init: (): TurnAuthority => ({ open: false, directHuman: false, goalRounds: [] }),
  apply: (state, event) => {
    if (event.type === 'turn/start' || event.type === 'turn/end') {
      return { open: event.type === 'turn/start', directHuman: false, goalRounds: [] }
    }
    if (!state.open || event.type !== 'user/message') return state
    const source = event.data.source
    if (source.kind === 'user') return state.directHuman ? state : { ...state, directHuman: true }
    if (source.kind === 'goal') {
      const { goalId, revision, round } = source
      return { ...state, goalRounds: [...state.goalRounds, { goalId, revision, round }] }
    }
    // Other message producers do not grant goal-tool authority.
    return state
  },
} satisfies ProjectionDefinition<'goalToolAuthority', TurnAuthority>

/** The authenticated caller and immutable authority facts captured for one tool call. */
export interface GoalToolExecution {
  readonly agent: Agent
  readonly authority: TurnAuthority
}

/** Hard authority granted to one state-changing call. */
export type GoalToolAuthority =
  | { readonly kind: 'direct-human' }
  | { readonly kind: 'goal-round'; readonly goal: GoalView }

/** Throw one structured tool-policy failure. */
function reject(message: string, code = 'GOAL_TOOL_AUTHORITY_REQUIRED'): never {
  throw new HarnessError(message, code)
}

/** Resolves goal-tool authority from the live driver and its committed turn. */
export class GoalToolExecutionResolver {
  private authority!: ProjectionHandle<TurnAuthority>

  /** @param ctx - Context carrying the live agent registry and session projections. */
  constructor(private readonly ctx: Context) {}

  /**
   * Acquire projection readers before exposing dependent operations.
   * @returns when all required registrations are ready.
   */
  async initialize(): Promise<void> {
    this.authority = await this.ctx.sessionProjections.register(turnAuthorityProjection)
  }

  /**
   * Authenticate the caller and capture its current turn's accepted input sources.
   * @param exec - Tool execution carrying the live calling agent.
   * @returns the caller and projected authority facts.
   */
  resolve(exec: ToolRunContext): GoalToolExecution {
    const agent = exec.agent
    if (agent === undefined) {
      return reject('goal tools require a calling agent', 'GOAL_TOOL_AGENT_REQUIRED')
    }
    if (this.ctx.agents.get(agent.id) !== agent || agent.status !== 'running'
      || this.ctx.agents.currentInitiator() !== agent) {
      return reject(
        'goal tools require the exact live calling agent inside its active driver',
        'GOAL_TOOL_DRIVER_REQUIRED',
      )
    }
    const authority = this.authority.stateOf(agent.session)
    if (!authority.open) {
      reject('goal tools require an open model turn', 'GOAL_TOOL_DRIVER_REQUIRED')
    }
    return { agent, authority }
  }
}

/**
 * Whether host-attested human input appears in the current root-agent turn.
 * An omitted `Agent.followup()` / `steer()` source resolves to `user`, so non-human
 * producers must supply their own source rather than inheriting this authority.
 */
function hasDirectHumanInput(ctx: Context, execution: GoalToolExecution): boolean {
  if (!ctx.agents.roots().includes(execution.agent)) return false
  return execution.authority.directHuman
}

/** Whether this turn is the current goal's exact admitted round. */
function isMatchingGoalRound(execution: GoalToolExecution, goal: GoalView): boolean {
  return execution.authority.goalRounds.some(round => round.goalId === goal.id
    && round.revision === goal.revision
    && round.round === goal.roundsStarted)
}

/**
 * Require authority originating in a human message accepted by a runtime root.
 * @param ctx - Context carrying the live agent graph.
 * @param execution - Authenticated current tool execution.
 */
export function requireDirectHuman(ctx: Context, execution: GoalToolExecution): void {
  if (hasDirectHumanInput(ctx, execution)) return
  reject('this goal operation requires a direct human turn on a top-level agent')
}

/**
 * Resolve completion authority from either direct human input or the exact goal round.
 * @param ctx - Context carrying live agents and goal state.
 * @param execution - Authenticated current tool execution.
 * @returns The direct-human or exact-goal-round authority grant.
 */
export function completionAuthority(ctx: Context, execution: GoalToolExecution): GoalToolAuthority {
  if (hasDirectHumanInput(ctx, execution)) return { kind: 'direct-human' }
  const goal = ctx.goals.get(execution.agent)
  if (goal !== undefined && isMatchingGoalRound(execution, goal)) {
    return { kind: 'goal-round', goal }
  }
  return reject('complete and blocked require a direct human turn or the current goal round')
}

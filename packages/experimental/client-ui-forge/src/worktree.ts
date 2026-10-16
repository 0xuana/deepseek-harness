/** The worktree a Session requests before it starts: its record, its projection, and its creation. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { AdmissionDecision } from '@deepseek-ai/dsh-agent-controller'
import { generatedWorktreeName } from '@deepseek-ai/dsh-experimental-worktree'
import type { CreatedWorktree, CreateWorktreePhase } from '@deepseek-ai/dsh-experimental-worktree'
import { appendPluginRecord, pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition, ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { z } from 'zod'
import type {
  ForgeAdmissionRefusal, ForgeSessionWorktree, ForgeWorktreeCreation, ForgeWorktreeFailure, ForgeWorktreeState, WorktreeRecord,
} from './types.ts'

/** Plugin record type of worktree requests, withdrawals, and creations. */
export const WORKTREE_RECORD = 'plugin:client-ui-forge/worktree'

const EMPTY: ForgeWorktreeState = { request: null, created: null, locked: false, stepped: false }

const worktreeSchema: z.ZodType<ForgeSessionWorktree> = z.object({
  path: z.string().min(1),
  branch: z.string().min(1),
  from: z.string().min(1).nullable(),
  baseCommit: z.string().min(1),
  repositoryRoot: z.string().min(1),
}).strict()

const recordSchema: z.ZodType<WorktreeRecord> = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request'), from: z.string().min(1).nullable() }).strict(),
  z.object({ action: z.literal('cancel') }).strict(),
  z.object({ action: z.literal('created'), worktree: worktreeSchema }).strict(),
])

const stateSchema: z.ZodType<ForgeWorktreeState> = z.object({
  request: z.object({ from: z.string().min(1).nullable() }).strict().nullable(),
  created: worktreeSchema.nullable(),
  locked: z.boolean(),
  stepped: z.boolean(),
}).strict()

/**
 * The host-only `forgeWorktree` unit. `request` and `cancel` records change
 * the request until the first `turn/start` or creation; the first `created`
 * record of an open request applies until the first `step/start`. Records
 * outside those periods leave the state unchanged.
 */
export const forgeWorktreeProjection = {
  key: 'forgeWorktree',
  stateVersion: 2,
  stateSchema,
  init: () => EMPTY,
  apply,
} satisfies ProjectionDefinition<'forgeWorktree', ForgeWorktreeState>

function apply(state: ForgeWorktreeState, event: SessionEvent): ForgeWorktreeState {
  switch (event.type) {
    case 'turn/start':
      return state.locked ? state : { ...state, locked: true }
    case 'step/start':
      return state.stepped ? state : { ...state, stepped: true }
    // Every other event type, including plugin records, which sit outside SessionEventMap.
    default:
      return applyRecord(state, event)
  }
}

function applyRecord(state: ForgeWorktreeState, event: SessionEvent): ForgeWorktreeState {
  const record = pluginRecordOf(event)
  if (record?.type !== WORKTREE_RECORD) return state
  const parsed = recordSchema.safeParse(record.data)
  if (!parsed.success) return state
  const data = parsed.data
  const settled = state.created !== null
  switch (data.action) {
    case 'request':
      return state.locked || settled ? state : { ...state, request: { from: data.from } }
    case 'cancel':
      return state.locked || settled || state.request === null ? state : { ...state, request: null }
    case 'created':
      return settled || state.stepped || state.request === null ? state : { ...state, created: data.worktree }
    /* v8 ignore next -- closed WorktreeRecord action union exhaustiveness guard */
    default: return assertNever(data, 'WorktreeRecord.action')
  }
}

/**
 * Reject a message at Agent admission.
 * @param reason - why the panel rejects it.
 * @param message - text the sender shows when no panel does.
 * @param presented - whether a panel shows the rejection to the sender.
 * @returns the decision that keeps the message out of the inbox.
 */
export function refusal(reason: ForgeAdmissionRefusal, message: string, presented: boolean): AdmissionDecision {
  return { kind: 'reject', reason, message, presented }
}

/** A failed attempt to create a requested worktree; `cause` holds the worktree service's error. */
export class CreationFailure extends Error {
  /**
   * @param branch - branch the attempt created.
   * @param phase - step that failed.
   * @param reason - the worktree service's failure text.
   * @param cause - the worktree service's error.
   */
  constructor(readonly branch: string, readonly phase: CreateWorktreePhase, readonly reason: string, cause: unknown) {
    super(`The requested worktree ${branch} could not be created`, { cause })
    this.name = 'CreationFailure'
  }
}

/**
 * Creates requested worktrees, one attempt with a new branch name per call:
 * through {@link WorktreeCreations.admit}, which holds a Session's first
 * message at Agent admission until its worktree exists, and at the first step
 * proposal of a Session whose request is still open, which covers a message
 * that entered without admission. The worktree service enters the created
 * checkout and queues its directory notice. At a step proposal the notice
 * joins the proposed messages so the first request already names the new
 * directory; a proposal without messages leaves it queued, and a failure ends
 * the turn with the request still open. A failed attempt may leave its branch
 * or checkout behind.
 */
export class WorktreeCreations {
  private readonly live = new Map<Session, ForgeWorktreeCreation>()
  private readonly failures = new Map<Session, ForgeWorktreeFailure>()
  private readonly stops = new Map<Session, AbortController>()

  /**
   * @param ctx - context that optionally provides `worktrees`.
   * @param states - reads the `forgeWorktree` projection of a Session.
   * @param prefix - branch name prefix that `generatedWorktreeName` combines with the Session id and random digits.
   * @param changed - called after the creation of a Session starts, changes phase, or ends, and after its failure changes.
   */
  constructor(
    private readonly ctx: Context,
    private readonly states: ProjectionHandle<ForgeWorktreeState>,
    private readonly prefix: string,
    private readonly changed: (session: Session) => void,
  ) {
    ctx.on('agent/pre-step', async ({ agent, step, signal }, next): Promise<PreStepDecision> => await this.preStep(agent, step, signal, next))
  }

  /**
   * Read the running creation of a Session.
   * @param session - Session to read.
   * @returns the running creation, or null.
   */
  of(session: Session): ForgeWorktreeCreation | null {
    return this.live.get(session) ?? null
  }

  /**
   * Read the failed attempt that returned a Session's last message to its sender.
   * @param session - Session to read.
   * @returns the failure, or null.
   */
  failureOf(session: Session): ForgeWorktreeFailure | null {
    return this.failures.get(session) ?? null
  }

  /**
   * Forget the failure of a Session whose request changes or is withdrawn; the record of that change republishes the panel.
   * @param session - Session whose failure no longer applies.
   */
  forget(session: Session): void {
    this.failures.delete(session)
  }

  /**
   * Create a Session's requested worktree for a message that waits at Agent
   * admission, as maintenance of the Session's Agent. A failure is kept for
   * {@link WorktreeCreations.failureOf} until another attempt starts or the
   * request changes; the message then goes back to its sender, which may send
   * it again for another attempt. {@link WorktreeCreations.stop} and the
   * Agent's cancellation also return the message.
   * @param agent - Agent of the Session.
   * @param from - base branch, or null for HEAD of the current checkout.
   * @param signal - the sender's cancellation, whose reason passes through unchanged.
   * @param presented - whether a panel shows a rejection to the sender.
   * @returns undefined once the worktree exists, or a decision that rejects the message with
   * `forge/worktree-creation-failed` or `forge/worktree-creation-stopped`.
   * @throws the sender's cancellation reason once `signal` aborts.
   */
  async admit(agent: Agent, from: string | null, signal: AbortSignal, presented: boolean): Promise<AdmissionDecision | undefined> {
    const session = agent.session
    const stop = new AbortController()
    let work: AbortSignal | undefined
    this.stops.set(session, stop)
    try {
      await agent.runMaintenance(async (maintenance) => {
        work = maintenance
        await this.create(agent, from, AbortSignal.any([signal, stop.signal, maintenance]), true)
      })
    } catch (error) {
      signal.throwIfAborted()
      if (stop.signal.aborted || work?.aborted === true) return refusal('forge/worktree-creation-stopped', 'The worktree creation was stopped', presented)
      const failure: ForgeWorktreeFailure = error instanceof CreationFailure
        ? { branch: error.branch, from, phase: error.phase, message: error.reason }
        : { branch: null, from, phase: 'prepare', message: error instanceof Error ? error.message : String(error) }
      this.failures.set(session, failure)
      this.changed(session)
      return refusal('forge/worktree-creation-failed', `The worktree could not be created: ${failure.message}`, presented)
    } finally {
      this.stops.delete(session)
    }
    return undefined
  }

  /**
   * Stop the creation that holds a message of a Session at admission; the
   * message goes back to its sender and the request stays open. Without such a
   * creation the Session is unchanged.
   * @param session - Session whose creation stops.
   */
  stop(session: Session): void {
    this.stops.get(session)?.abort(new Error('The worktree creation was stopped'))
  }

  /**
   * Create a Session's requested worktree with a new branch name, enter it, and
   * record it on the Session. The running creation is readable through
   * {@link WorktreeCreations.of} until the record exists or the attempt fails.
   * @param agent - Agent of the Session.
   * @param from - base branch, or null for HEAD of the current checkout.
   * @param signal - cancellation of the attempt.
   * @param held - whether a message waits for the creation at admission.
   * @returns the created worktree.
   * @throws {@link CreationFailure} when the attempt fails; the cancellation reason once `signal` aborts.
   */
  async create(agent: Agent, from: string | null, signal: AbortSignal, held: boolean): Promise<CreatedWorktree> {
    const worktrees = this.ctx.get('worktrees')
    if (worktrees === undefined) throw new Error('No worktree service is mounted')
    const session = agent.session
    let status: ForgeWorktreeCreation = { phase: 'prepare', branch: generatedWorktreeName(this.prefix, session.id), from, held }
    this.failures.delete(session)
    this.live.set(session, status)
    this.changed(session)
    try {
      let created: CreatedWorktree
      try {
        created = await worktrees.create(agent, { name: status.branch, ...from === null ? {} : { from } }, signal, (phase) => {
          status = { ...status, phase }
          this.live.set(session, status)
          this.changed(session)
        })
      } catch (error) {
        signal.throwIfAborted()
        throw new CreationFailure(status.branch, status.phase, error instanceof Error ? error.message : String(error), error)
      }
      const worktree: ForgeSessionWorktree = {
        path: created.path, branch: created.branch, from, baseCommit: created.baseCommit, repositoryRoot: created.repositoryRoot,
      }
      appendPluginRecord(session, WORKTREE_RECORD, { action: 'created', worktree })
      return created
    } finally {
      // After the record, so a follower never sees the creation end without its result.
      this.live.delete(session)
      this.changed(session)
    }
  }

  private async preStep(agent: Agent, step: number, signal: AbortSignal, next: () => Promise<PreStepDecision>): Promise<PreStepDecision> {
    const state = this.states.stateOf(agent.session)
    if (step !== 1 || state.request === null || state.created !== null || state.stepped) return await next()
    await this.create(agent, state.request.from, signal, false)
    const decision = await next()
    if (decision.kind === 'reject' || decision.messages.length === 0) return decision
    const notices = agent.inbox.nextStep.filter(message => message.source.kind === 'working-directory')
    for (const notice of notices) agent.inbox.remove(notice.id)
    return notices.length === 0 ? decision : { ...decision, messages: [...decision.messages, ...notices] }
  }
}

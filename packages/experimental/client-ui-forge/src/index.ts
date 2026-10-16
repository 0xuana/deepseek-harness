/** Host Remote of the forge panel: checkout, code host, sign-in, change request, and worktree state per Session. */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AdmissionDecision } from '@deepseek-ai/dsh-agent-controller'
import type { ChangeRequestRef, ForgeActionFailure, MergeMethod } from '@deepseek-ai/dsh-experimental-forge'
import type {} from '@deepseek-ai/dsh-experimental-forge-session'
import type {} from '@deepseek-ai/dsh-experimental-worktree'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { listBranches } from './git.ts'
import { missingWorktree, SessionPanel } from './panel.ts'
import type { PanelConfig } from './panel.ts'
import type { Config, ForgeBranches, ForgeMissingWorktree, ForgePanelState, ForgeSessionWorktree, ForgeWorktreeState } from './types.ts'
import { forgeWorktreeProjection, refusal, WORKTREE_RECORD, WorktreeCreations } from './worktree.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Remote that serves the forge panel of the GUI. */
    forgePanel: ForgePanelController
  }
}

/** Panel limits plus the branch listing limit and the worktree branch prefix. */
type ControllerConfig = PanelConfig & { readonly maxBranches: number; readonly worktreePrefix: string }

/**
 * Serves the forge panel. Following a Session inspects the checkout of its
 * current directory read-only in the Session's execution world, recognizes the
 * code host of the upstream remote or `origin`, probes sign-in for that host,
 * and polls the Session's bound change requests through `ctx.forge` until the
 * last follower of that Session leaves. A worktree request makes the panel
 * create a branch and checkout through an optional `ctx.worktrees` and enter
 * it: at Agent admission of the Session's first message, which waits for the
 * worktree, or at the first step proposal of a message that entered without
 * admission. A failed or stopped creation returns the message to its sender.
 * Admission also refuses messages while the worktree the Session works in is
 * gone; that worktree can be checked out again or left for the source
 * checkout. Changes to a Session's checkout run as Agent maintenance, so a
 * message that arrives meanwhile waits for them.
 */
export class ForgePanelController extends TypertRemoteService {
  static inject = [
    'forge', 'forgeSession', 'sessionProjections', 'workingDirectory', 'fs', 'subprocess', 'sandbox', 'sandboxPolicy', 'agents',
  ]

  static Config: z<Config> = z.object({
    gitCommand: z.string().default('git'),
    gitTimeoutMs: z.number().default(10_000),
    graceMs: z.number().default(1_000),
    maxOutputBytes: z.number().default(1_048_576),
    readinessTimeoutMs: z.number().default(15_000),
    maxBranches: z.number().default(50),
    worktreePrefix: z.string().default('dsh-'),
  })

  private readonly home: Context
  private readonly config: ControllerConfig
  private readonly panels = new Map<Session, SessionPanel>()
  private worktreeStates!: ProjectionHandle<ForgeWorktreeState>
  private creations!: WorktreeCreations

  constructor(ctx: Context, config: Config) {
    super(ctx, 'forgePanel')
    const resolved = config as Required<Config>
    if (resolved.gitCommand.trim().length === 0) throw new Error('forge-panel: gitCommand must not be empty')
    for (const key of ['gitTimeoutMs', 'graceMs', 'maxOutputBytes', 'readinessTimeoutMs'] as const) {
      const value = resolved[key]
      if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
        throw new Error(`forge-panel: ${key} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
      }
    }
    if (!Number.isSafeInteger(resolved.maxBranches) || resolved.maxBranches <= 0) {
      throw new Error('forge-panel: maxBranches must be a positive integer')
    }
    if (!branchPrefix(resolved.worktreePrefix)) throw new Error('forge-panel: worktreePrefix must start a valid Git branch name')
    this.home = ctx
    this.config = resolved
    ctx.effect(() => async () => {
      const panels = [...this.panels.values()]
      this.panels.clear()
      await Promise.allSettled(panels.map(panel => panel.dispose()))
    }, 'forge-panel: stop panels')
  }

  protected async [Service.init](): Promise<void> {
    const ctx = this.home
    this.worktreeStates = await ctx.sessionProjections.register(forgeWorktreeProjection)
    // Admission, step proposals, and Session events read the worktree state, so they start once its reader is ready.
    this.creations = new WorktreeCreations(ctx, this.worktreeStates, this.config.worktreePrefix, (session) => {
      this.panels.get(session)?.updateWorktree()
    })
    ctx.on('agent-controller/admission', async ({ agent, signal }, next) => {
      const rejection = await this.admit(agent, signal)
      return rejection ?? await next()
    })
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      this.panels.get(session)?.observe(event)
    })
    ctx.on('internal/service', (name: string) => {
      if (name !== 'worktrees') return
      for (const panel of this.panels.values()) panel.updateWorktree()
    })
  }

  /**
   * Stream the panel state of a Session: the current state first, then each
   * later state. Intermediate states may be skipped when the reader is slower
   * than the updates. The stream ends when `signal` aborts or the Remote stops.
   * @param session - Session to follow.
   * @param signal - ends the stream.
   * @returns panel states in publication order.
   */
  @Remote({ mode: 'stream' })
  async *follow(session: Session, signal: AbortSignal): AsyncIterable<ForgePanelState> {
    yield* this.panelOf(session).follow(signal)
  }

  /**
   * List the local branches that can start a worktree of the Session's current checkout.
   * @param session - Session whose current directory is listed.
   * @param signal - request cancellation.
   * @returns the checked-out branch and at most `maxBranches` local branches, the checked-out one first.
   * @throws when the current directory is not inside a checkout or Git fails.
   */
  @Remote
  async branches(session: Session, signal: AbortSignal): Promise<ForgeBranches> {
    return await listBranches(this.home, this.config, session, this.home.workingDirectory.get(session), this.config.maxBranches, signal)
  }

  /* oxlint-disable typescript/require-await -- async keeps a refused or cancelled request a rejection, as Remote callers expect */
  /**
   * Bind a change request to a Session by URL, or restore a dismissed binding.
   * @param session - Session that receives the binding.
   * @param url - web URL of the change request.
   * @param signal - request cancellation.
   * @throws `forgePanel/unrecognized-url` when no registered provider serves the URL.
   */
  @Remote
  async track(session: Session, url: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.home.forge.changeRequestFromUrl(url) === undefined) {
      throw new RemoteError('forgePanel/unrecognized-url', 'No code host provider recognizes the change request URL', {})
    }
    this.home.forgeSession.track(session, url)
  }

  /**
   * Hide a visible binding of a Session; other URLs leave the Session unchanged.
   * @param session - Session that owns the binding.
   * @param url - web URL of the change request.
   * @param signal - request cancellation.
   */
  @Remote
  async dismiss(session: Session, url: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    this.home.forgeSession.dismiss(session, url)
  }

  /**
   * Reinspect a followed Session's checkout, probe sign-in again, and poll its
   * change requests at once; an unfollowed Session is unchanged.
   * @param session - Session whose panel refreshes.
   * @param signal - request cancellation.
   */
  @Remote
  async refresh(session: Session, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    this.panels.get(session)?.refresh()
  }

  /**
   * Mark a draft change request of a Session ready for review; the change
   * request is polled again once the host answers.
   * @param session - Session the change request is bound to.
   * @param url - binding URL of the change request.
   * @param signal - request cancellation.
   * @throws `forgePanel/not-bound` unless the URL is a visible binding of the Session that a provider serves;
   * `forgePanel/action-failed` with the host's reason when the host refuses or cannot be reached.
   */
  @Remote
  async markReady(session: Session, url: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const failure = await this.home.forge.markReady(this.boundRef(session, url), signal)
    if (failure !== undefined) throw actionError(failure)
  }

  /**
   * Merge a change request of a Session while its head is still `headSha`;
   * the change request is polled again once the host answers.
   * @param session - Session the change request is bound to.
   * @param url - binding URL of the change request.
   * @param method - how the commits enter the base branch.
   * @param headSha - head commit the user confirmed.
   * @param signal - request cancellation.
   * @throws `forgePanel/not-bound` unless the URL is a visible binding of the Session that a provider serves;
   * `forgePanel/stale-head` when the head moved past `headSha`; `forgePanel/action-failed` with the host's
   * reason when the host refuses otherwise or cannot be reached.
   */
  @Remote
  async merge(session: Session, url: string, method: MergeMethod, headSha: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const failure = await this.home.forge.merge(this.boundRef(session, url), { method, headSha }, signal)
    if (failure !== undefined) throw actionError(failure)
  }

  /**
   * Ask for a new worktree before the Session's first turn, replacing an open
   * request and forgetting a failed attempt. Admission of the next message, or
   * else the first step proposal, creates a branch from `from`, or from HEAD of
   * the current checkout when it is null, and enters its checkout.
   * @param session - Session without a started turn.
   * @param from - local base branch, or null for HEAD.
   * @param signal - request cancellation.
   * @throws `forgePanel/invalid-branch` when `from` is empty; `forgePanel/worktrees-unavailable`
   * without a worktree service; `forgePanel/session-started` after a turn started or the worktree was
   * created; `forgePanel/session-busy` while the worktree is being created.
   */
  @Remote
  async requestWorktree(session: Session, from: string | null, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (from?.length === 0) throw new RemoteError('forgePanel/invalid-branch', 'The base branch name is empty', {})
    this.editableWorktree(session)
    this.creations.forget(session)
    appendPluginRecord(session, WORKTREE_RECORD, { action: 'request', from })
  }

  /**
   * Withdraw the open worktree request of a Session with its failed attempt; without a request the Session is unchanged.
   * @param session - Session without a started turn.
   * @param signal - request cancellation.
   * @throws `forgePanel/worktrees-unavailable` without a worktree service; `forgePanel/session-started`
   * after a turn started or the worktree was created; `forgePanel/session-busy` while the worktree is
   * being created.
   */
  @Remote
  async cancelWorktree(session: Session, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.editableWorktree(session).request === null) return
    this.creations.forget(session)
    appendPluginRecord(session, WORKTREE_RECORD, { action: 'cancel' })
  }

  /**
   * Stop the creation that holds a message of the Session at admission; the
   * message goes back to its sender and the request stays open. Without such a
   * creation the Session is unchanged.
   * @param session - Session whose creation stops.
   * @param signal - request cancellation.
   */
  @Remote
  async stopCreation(session: Session, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    this.creations.stop(session)
  }

  /**
   * Check out the created worktree of a Session again at its recorded
   * directory when that directory is gone: its branch when the branch still
   * exists, otherwise a new branch of the same name at the base commit. Changes
   * that were never committed are not recovered. Runs as Agent maintenance;
   * without a missing directory the Session is unchanged.
   * @param session - Session whose worktree directory is gone.
   * @param signal - request cancellation, which aborts the restoration.
   * @throws `forgePanel/no-worktree` without a created worktree; `forgePanel/worktrees-unavailable`
   * without a worktree service; `forgePanel/session-busy` while the Session's Agent is not loaded or
   * has other work; `forgePanel/restore-failed` when Git fails.
   */
  @Remote
  async restoreWorktree(session: Session, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const created = this.createdWorktree(session)
    const worktrees = this.home.get('worktrees')
    if (worktrees === undefined) throw new RemoteError('forgePanel/worktrees-unavailable', 'No worktree service is mounted', {})
    await this.maintain(session, async (agent, work) => {
      const operation = AbortSignal.any([signal, work])
      if (await this.home.fs.lstat(created.path, undefined, operation) !== undefined) return
      try {
        await worktrees.restore(agent, created, operation)
      } catch (error) {
        operation.throwIfAborted()
        throw new RemoteError('forgePanel/restore-failed', error instanceof Error ? error.message : String(error), {}, { cause: error })
      }
    })
    this.panels.get(session)?.reinspect()
  }

  /**
   * Move a Session from its created worktree to the source checkout the
   * worktree came from; the Session no longer works in the worktree. Runs as
   * Agent maintenance.
   * @param session - Session with a created worktree.
   * @param signal - request cancellation.
   * @throws `forgePanel/no-worktree` without a created worktree; `forgePanel/session-busy` while the
   * Session's Agent is not loaded or has other work; the working-directory service's error when the
   * source checkout no longer exists.
   */
  @Remote
  async continueInProject(session: Session, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const created = this.createdWorktree(session)
    await this.maintain(session, async (agent, work) => {
      await this.home.workingDirectory.set(agent, created.repositoryRoot, AbortSignal.any([signal, work]))
    })
  }

  /* oxlint-enable typescript/require-await */

  /**
   * Hold a message at Agent admission while the Session's requested worktree
   * is created, and reject it while the worktree the Session works in is gone.
   * A check that cannot answer lets the message pass.
   * @returns a decision that rejects the message, or undefined to pass it on.
   */
  private async admit(agent: Agent, signal: AbortSignal): Promise<AdmissionDecision | undefined> {
    const session = agent.session
    const presented = this.panels.has(session)
    const state = this.worktreeState(session)
    if (state.request !== null && state.created === null && !state.locked) {
      return await this.creations.admit(agent, state.request.from, signal, presented)
    }
    const panel = this.panels.get(session)
    let missing: ForgeMissingWorktree | null
    try {
      missing = panel === undefined
        ? await missingWorktree(this.home, this.config, session, state.created, this.home.workingDirectory.get(session), signal)
        : await panel.checkMissing(signal)
    } catch (_error) {
      // Without an answer from the filesystem or Git the panel offers no restoration, so the message passes.
      signal.throwIfAborted()
      return undefined
    }
    return missing === null
      ? undefined
      : refusal('forge/worktree-missing', 'The worktree this Session works in was removed; restore it before sending', presented)
  }

  /** The provider reference of a visible binding of the Session, which actions are limited to. */
  private boundRef(session: Session, url: string): ChangeRequestRef {
    const ref = this.home.forgeSession.changeRequests(session).find(entry => entry.url === url)?.ref ?? null
    if (ref === null) throw new RemoteError('forgePanel/not-bound', 'The change request is not bound to this Session or no provider serves it', {})
    return ref
  }

  private worktreeState(session: Session): ForgeWorktreeState {
    return this.worktreeStates.stateOf(session)
  }

  private editableWorktree(session: Session): ForgeWorktreeState {
    if (this.home.get('worktrees') === undefined) {
      throw new RemoteError('forgePanel/worktrees-unavailable', 'No worktree service is mounted', {})
    }
    const state = this.worktreeState(session)
    if (state.locked || state.created !== null) {
      throw new RemoteError('forgePanel/session-started', 'The Session has started, so its worktree can no longer change', {})
    }
    // A creation records its worktree only for the request it started from.
    if (this.creations.of(session) !== null) throw new RemoteError('forgePanel/session-busy', 'The worktree is being created', {})
    return state
  }

  private createdWorktree(session: Session): ForgeSessionWorktree {
    const created = this.worktreeState(session).created
    if (created === null) throw new RemoteError('forgePanel/no-worktree', 'The Session has no created worktree', {})
    return created
  }

  /** Run work as maintenance of the Session's Agent, which refuses while the Agent has other work. */
  private async maintain(session: Session, work: (agent: Agent, signal: AbortSignal) => Promise<void>): Promise<void> {
    const agent = this.home.agents.get(session.id)
    if (agent === undefined) throw new RemoteError('forgePanel/session-busy', 'The Session is not loaded', {})
    let running: Promise<void>
    try {
      running = agent.runMaintenance(async (signal) => { await work(agent, signal) })
    } catch (error) {
      throw new RemoteError('forgePanel/session-busy', 'The Session is busy', {}, { cause: error })
    }
    await running
  }

  private panelOf(session: Session): SessionPanel {
    let panel = this.panels.get(session)
    if (panel === undefined) {
      const created: SessionPanel = new SessionPanel(this.home, this.config, session, this.worktreeStates, this.creations, () => {
        if (this.panels.get(session) !== created) return
        this.panels.delete(session)
        void created.dispose()
      })
      panel = created
      this.panels.set(session, panel)
    }
    return panel
  }
}

/**
 * Report a failed change request action, separating a head that moved since the user confirmed it.
 * @param failure - the provider's failure.
 * @returns the Remote error to throw.
 */
function actionError(failure: ForgeActionFailure): RemoteError {
  return new RemoteError(failure.code === 'stale' ? 'forgePanel/stale-head' : 'forgePanel/action-failed', failure.message, {})
}

/**
 * Whether `prefix` followed by hexadecimal digits is a branch name that Git
 * accepts: no leading `-` or `/`, no empty component, no component that
 * starts with `.` or ends with `.lock`, and none of `..`, `@{`, whitespace,
 * control characters, `~`, `^`, `:`, `?`, `*`, `[`, or `\`.
 * @param prefix - configured worktree branch prefix.
 * @returns whether every generated name passes `git check-ref-format --branch`.
 */
function branchPrefix(prefix: string): boolean {
  const name = `${prefix}0`
  if (name.startsWith('-') || name.includes('..') || name.includes('@{')) return false
  for (const char of name) {
    if (char <= ' ' || char === '\x7f' || '~^:?*[\\'.includes(char)) return false
  }
  return name.split('/').every(part => part.length > 0 && !part.startsWith('.') && !part.endsWith('.lock'))
}

export default ForgePanelController

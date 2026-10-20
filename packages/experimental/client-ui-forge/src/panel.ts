/** Live panel state of one followed Session, shared by all of its followers. */

import { isAbsolute, relative, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ChangeRequestSnapshot, ForgeReadiness, ForgeRepository } from '@deepseek-ai/dsh-experimental-forge'
import type { SessionChangeRequest } from '@deepseek-ai/dsh-experimental-forge-session'
import type {} from '@deepseek-ai/dsh-experimental-worktree'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { deadline } from '@deepseek-ai/dsh-timeout'
import type {} from '@deepseek-ai/dsh-working-directory'
import { hasBranch, inspectCheckout } from './git.ts'
import type { GitConfig, Inspection } from './git.ts'
import { remoteOrder } from './parse.ts'
import type {
  ForgeCheckoutState, ForgeMissingWorktree, ForgePanelChangeRequest, ForgePanelState, ForgePanelWorktree, ForgeSessionWorktree,
  ForgeWorktreeBlocker, ForgeWorktreeState,
} from './types.ts'
import { WORKTREE_RECORD } from './worktree.ts'
import type { WorktreeCreations } from './worktree.ts'

/** Git limits plus the sign-in probe deadline. */
export interface PanelConfig extends GitConfig {
  /** Deadline in milliseconds for one provider sign-in probe. */
  readonly readinessTimeoutMs: number
}

/**
 * Panel state of one Session. Construction starts the first checkout
 * inspection and watches the Session's change requests. Inspections run one at
 * a time; a request that arrives during one runs once more after it, and a
 * result for a directory the Session has since left is dropped. A sign-in
 * probe runs when an inspection recognizes a new code host and on `refresh`;
 * a probe result for a host the panel no longer shows is dropped. Each change
 * request keeps the latest snapshot a poll returned while later polls fail. The
 * worktree facts follow the `forgeWorktree` projection, the live creation, and the last failed one;
 * each inspection also decides whether the Session's sandbox can write the
 * checkout and its shared Git directory, which a new worktree needs, and
 * whether the worktree the Session created and works in is gone.
 */
export class SessionPanel {
  private current: ForgePanelState
  private readonly followers = new Set<() => void>()
  private readonly lifetime = new AbortController()
  private readonly tasks = new Set<Promise<void>>()
  private readonly stopWatching: () => void
  private readonly snapshots = new Map<string, ChangeRequestSnapshot>()
  private blocker: ForgeWorktreeBlocker | null = null
  private missing: ForgeMissingWorktree | null = null
  private inspecting = false
  private inspectAgain = false

  /**
   * @param ctx - service context that provides the forge, Session, directory, and process services.
   * @param config - Git limits and the sign-in probe deadline.
   * @param session - Session the panel describes.
   * @param worktreeStates - reads the `forgeWorktree` projection of the Session.
   * @param creations - reads the running creation and the last failed one of the Session.
   * @param onIdle - called when the last follower leaves.
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: PanelConfig,
    readonly session: Session,
    private readonly worktreeStates: ProjectionHandle<ForgeWorktreeState>,
    private readonly creations: Pick<WorktreeCreations, 'of' | 'failureOf'>,
    private readonly onIdle: () => void,
  ) {
    this.current = {
      directory: ctx.workingDirectory.get(session),
      checkout: { state: 'pending' },
      repository: null,
      readiness: null,
      changeRequests: this.entries(ctx.forgeSession.changeRequests(session)),
      worktree: this.worktree(),
    }
    this.stopWatching = ctx.forgeSession.watch(session, (changeRequests) => {
      this.publish({ ...this.current, changeRequests: this.entries(changeRequests) })
    })
    this.inspect()
  }

  /**
   * Yield the current state, then each later state, until `signal` aborts or the panel stops.
   * @param signal - ends this follower.
   * @returns the states in publication order; intermediate states may be skipped.
   */
  async *follow(signal: AbortSignal): AsyncGenerator<ForgePanelState> {
    let wake: (() => void) | undefined
    const notify = (): void => { wake?.() }
    this.followers.add(notify)
    signal.addEventListener('abort', notify)
    this.lifetime.signal.addEventListener('abort', notify)
    try {
      let delivered: ForgePanelState | undefined
      while (!signal.aborted && !this.lifetime.signal.aborted) {
        if (this.current !== delivered) {
          delivered = this.current
          yield delivered
          continue
        }
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
      }
    } finally {
      this.followers.delete(notify)
      signal.removeEventListener('abort', notify)
      this.lifetime.signal.removeEventListener('abort', notify)
      if (this.followers.size === 0) this.onIdle()
    }
  }

  /**
   * React to one committed event of the Session: a directory change moves the
   * panel and reinspects; a tool result reinspects, because the tool may have
   * changed the checkout; a sandbox mode change reinspects, because it decides
   * whether a worktree can be created; the first turn, the first step, and
   * worktree records update the worktree facts.
   * @param event - committed Session event.
   */
  observe(event: SessionEvent): void {
    if (event.type === 'working-directory/change') {
      this.publish({ ...this.current, directory: event.data.cwd, checkout: { state: 'pending' } })
      this.inspect()
    } else if (event.type === 'tool/result' || event.type === 'sandbox/mode') {
      this.inspect()
    } else if (event.type === 'turn/start' || event.type === 'step/start' || pluginRecordOf(event)?.type === WORKTREE_RECORD) {
      this.updateWorktree()
    }
  }

  /** Republish the worktree facts when they changed, such as after a creation moved or a worktree service appeared or left. */
  updateWorktree(): void {
    const worktree = this.worktree()
    if (!sameWorktree(worktree, this.current.worktree)) this.publish({ ...this.current, worktree })
  }

  /** Reinspect the checkout, such as after its directory was created again. */
  reinspect(): void {
    this.inspect()
  }

  /**
   * Check again whether the worktree the Session works in is gone, publishing a change.
   * @param signal - cancellation of the check.
   * @returns the missing worktree, or null while it exists or the Session works elsewhere.
   * @throws when the filesystem or Git cannot answer.
   */
  async checkMissing(signal: AbortSignal): Promise<ForgeMissingWorktree | null> {
    const directory = this.current.directory
    const created = this.worktreeStates.stateOf(this.session).created
    const missing = await missingWorktree(
      this.ctx, this.config, this.session, created, directory, AbortSignal.any([signal, this.lifetime.signal]),
    )
    if (this.current.directory === directory) {
      this.missing = missing
      this.updateWorktree()
    }
    return missing
  }

  /** Reinspect the checkout, probe sign-in again, and poll every bound change request at once. */
  refresh(): void {
    this.inspect()
    if (this.current.repository !== null) this.probe(this.current.repository)
    for (const entry of this.current.changeRequests) {
      if (entry.ref !== null) this.ctx.forge.refresh(entry.ref)
    }
  }

  /**
   * Stop inspections, probes, and the change request watch, end every follower, and wait for pending work.
   * @returns settles once pending inspections and probes have ended.
   */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    this.stopWatching()
    await Promise.allSettled(this.tasks)
  }

  private entries(changeRequests: readonly SessionChangeRequest[]): ForgePanelChangeRequest[] {
    return changeRequests.map((entry) => {
      if (entry.update !== null && 'snapshot' in entry.update) this.snapshots.set(entry.url, entry.update.snapshot)
      return { ...entry, snapshot: this.snapshots.get(entry.url) ?? null }
    })
  }

  private worktree(): ForgePanelWorktree {
    const state = this.worktreeStates.stateOf(this.session)
    return {
      editable: this.ctx.get('worktrees') !== undefined && !state.locked && state.created === null,
      blocker: this.blocker,
      request: state.request,
      created: state.created,
      creation: this.creations.of(this.session),
      failure: this.creations.failureOf(this.session),
      missing: this.missing,
    }
  }

  private publish(next: ForgePanelState): void {
    this.current = next
    for (const notify of [...this.followers]) notify()
  }

  private run(task: Promise<void>): void {
    this.tasks.add(task)
    const settle = (): void => { this.tasks.delete(task) }
    void task.then(settle, settle)
  }

  private inspect(): void {
    if (this.lifetime.signal.aborted) return
    if (this.inspecting) {
      this.inspectAgain = true
      return
    }
    this.inspecting = true
    this.run(this.inspectOnce().finally(() => {
      this.inspecting = false
      if (!this.inspectAgain) return
      this.inspectAgain = false
      this.inspect()
    }))
  }

  private async inspectOnce(): Promise<void> {
    const directory = this.current.directory
    let checkout: ForgeCheckoutState
    let repository: ForgeRepository | null = null
    let blocker: ForgeWorktreeBlocker | null = null
    try {
      const inspection = await inspectCheckout(this.ctx, this.config, this.session, directory, this.lifetime.signal)
      if (inspection === undefined) {
        checkout = { state: 'none' }
        blocker = 'not-git'
      } else {
        checkout = { state: 'ready', checkout: inspection.checkout }
        repository = this.recognize(inspection)
        blocker = await this.blockerOf(inspection)
      }
    } catch (error) {
      checkout = { state: 'failed', message: error instanceof Error ? error.message : String(error) }
    }
    let missing: ForgeMissingWorktree | null = null
    try {
      const created = this.worktreeStates.stateOf(this.session).created
      missing = await missingWorktree(this.ctx, this.config, this.session, created, directory, this.lifetime.signal)
    } catch (_error) {
      // Without an answer from the filesystem or Git the panel offers no restoration.
    }
    if (this.lifetime.signal.aborted || this.current.directory !== directory) return
    this.blocker = blocker
    this.missing = missing
    const sameHost = repository !== null && this.current.repository !== null && hostOf(repository) === hostOf(this.current.repository)
    this.publish({ ...this.current, checkout, repository, readiness: sameHost ? this.current.readiness : null, worktree: this.worktree() })
    if (repository !== null && !sameHost) this.probe(repository)
  }

  /** Decide whether the Session's sandbox lets the worktree service write the checkout and its shared Git directory. */
  private async blockerOf(inspection: Inspection): Promise<ForgeWorktreeBlocker | null> {
    const policy = this.ctx.sandboxPolicy.resolve({ session: this.session })
    if (policy.mode === 'danger-full-access') return null
    if (policy.mode === 'read-only') return 'read-only'
    const root = this.ctx.fs.processPath(await this.ctx.fs.resolve(policy.workspaceRoot, { signal: this.lifetime.signal }))
    return within(root, inspection.checkout.root) && within(root, inspection.commonDir) ? null : 'outside-writable-root'
  }

  private recognize(inspection: Inspection): ForgeRepository | null {
    for (const remote of remoteOrder(inspection.upstream, inspection.remotes)) {
      for (const url of remote.urls) {
        const repository = this.ctx.forge.repositoryFromRemote(url)
        if (repository !== undefined) return repository
      }
    }
    return null
  }

  private probe(repository: ForgeRepository): void {
    const host = hostOf(repository)
    this.run((async () => {
      let readiness: ForgeReadiness
      try {
        using timeout = deadline(this.lifetime.signal, this.config.readinessTimeoutMs, 'FORGE_PANEL_READINESS_TIMEOUT')
        readiness = await this.ctx.forge.readiness(repository, timeout.signal)
      } catch (error) {
        readiness = { state: 'unavailable', message: error instanceof Error ? error.message : String(error) }
      }
      if (this.lifetime.signal.aborted || this.current.repository === null || hostOf(this.current.repository) !== host) return
      this.publish({ ...this.current, readiness })
    })())
  }
}

function sameWorktree(left: ForgePanelWorktree, right: ForgePanelWorktree): boolean {
  return left.editable === right.editable && left.blocker === right.blocker && left.request === right.request
    && left.created === right.created && left.creation === right.creation && left.failure === right.failure
    && left.missing?.branchExists === right.missing?.branchExists
}

/**
 * Decide whether a Session works inside the worktree it created while that
 * worktree's directory is gone, and whether its branch still exists.
 * @param ctx - context that provides `fs` and the process services.
 * @param config - Git limits.
 * @param session - Session to check.
 * @param created - the worktree the Session created, or null.
 * @param directory - the Session's current directory.
 * @param signal - cancellation of the check.
 * @returns the missing worktree, or null while it exists or the Session works elsewhere.
 * @throws when the filesystem or Git cannot answer.
 */
export async function missingWorktree(
  ctx: Context,
  config: GitConfig,
  session: Session,
  created: ForgeSessionWorktree | null,
  directory: string,
  signal: AbortSignal,
): Promise<ForgeMissingWorktree | null> {
  if (created === null || !within(created.path, directory)) return null
  if (await ctx.fs.lstat(created.path, undefined, signal) !== undefined) return null
  return { branchExists: await hasBranch(ctx, config, session, created.repositoryRoot, created.branch, signal) }
}

/** Whether `path` is `root` or lies below it. */
function within(root: string, path: string): boolean {
  const rest = relative(root, path)
  return rest === '' || (rest !== '..' && !rest.startsWith(`..${sep}`) && !isAbsolute(rest))
}

function hostOf(repository: ForgeRepository): string {
  return `${repository.forge}:${repository.host}`
}

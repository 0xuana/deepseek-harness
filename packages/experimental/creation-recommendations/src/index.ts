/** Explicit interface needs become independently installed plugins after a click. */
import { randomUUID } from 'node:crypto'
import { cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { FiberState, Service, type Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { HarnessError, type ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { appendPluginRecord, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-skill'
import { registerCreationSkill } from './skill.ts'
import { registerActionCard } from './action-cards.ts'
import { creationProjection, customLocationSchema, slotSchema, type CreationState } from './projection.ts'
import { validateGeneratedBundle } from './generated-bundle.ts'
import type { CreationActionResult, CreationDecision, CreationRecommendation, CreationSlot } from './types.ts'
export type * from './types.ts'

export const name = 'creation-recommendations'

declare module '@deepseek-ai/cordis' {
  interface Context { creationRecommendations: CreationRecommendations }
}

interface CreationJob {
  readonly parent: Agent
  readonly childId: SessionId
  readonly decision: CreationDecision
  readonly abort: AbortController
  readonly done: Promise<void>
}

/** Invalid proposals never start a child or change the profile. */
export class CreationRecommendationError extends HarnessError {}

/** Internal Remote and effect owner assembled by the personalized-pages plugin. */
export class CreationRecommendations extends TypertRemoteService {
  static inject = ['tools', 'pluginManager', 'agents', 'sessionProjections', 'remoteAccess', 'subagents', 'profileContext', 'skills']
  private projection!: ProjectionHandle<CreationState>
  private readonly actions = new Map<string, Promise<CreationActionResult>>()
  private readonly jobs = new Map<string, CreationJob>()
  private readonly reservations = new Map<string, { turn: number; callId: ToolCallId }>()
  private readonly stopped = Promise.withResolvers<undefined>()
  private closing = false
  private readonly owner: Context['fiber']

  constructor(ctx: Context) {
    super(ctx, 'creationRecommendations')
    this.owner = ctx.fiber
  }

  protected async [Service.init](): Promise<void> {
    this.projection = await this.ctx.sessionProjections.register(creationProjection)
    registerCreationSkill(this.ctx)
    this.ctx.effect(() => async () => {
      this.closing = true
      this.stopped.resolve(undefined)
      for (const job of this.jobs.values()) job.abort.abort()
      await Promise.allSettled([...this.actions.values()])
      await Promise.allSettled([...this.jobs.values()].map(job => job.done))
    }, 'creation-recommendations: drain creation')
    this.ctx.on('agent/created', async ({ agent }) => { await this.recoverOnOpen(agent) })
    this.ctx.on('agent/disposed', ({ agent }) => {
      this.reservations.delete(agent.id)
      for (const job of this.jobs.values()) if (job.parent === agent
        && this.projection.stateOf(agent.session).view.decisions[job.decision.callId]?.phase !== 'installing') {
        job.abort.abort()
        this.record(agent, { ...job.decision, phase: 'interrupted' })
      }
    })
    this.ctx.tools.guard((exec) => {
      if (exec.agent === undefined) return undefined
      const creator = [...this.jobs.values()].some(job => job.childId === exec.agent?.id)
      if (creator && exec.name === 'plugin_manager' && !z.object({ action: z.enum(['list_plugins', 'list_bundles', 'list_version_exemptions']) }).safeParse(exec.arguments).success) {
        return 'Generate the new bundle files only. The caller installs them after validation.'
      }
      if (exec.name !== 'suggest_action' && exec.name !== 'suggest_plugin') return undefined
      const state = this.projection.stateOf(exec.agent.session)
      const reserved = this.reservations.get(exec.agent.id)
      const first = state.firstCall ?? (reserved?.turn === state.turn ? reserved.callId : undefined)
      if (first !== undefined && first !== exec.callId) return 'This turn already has a recommendation. This call created no card. Finish using successful results only; do not promise an automatic later card.'
      this.reservations.set(exec.agent.id, { turn: state.turn, callId: exec.callId })
      return undefined
    })
    this.ctx.on('tools/result', (exec, result) => {
      if (result.isError && exec.agent !== undefined && this.reservations.get(exec.agent.id)?.callId === exec.callId) {
        this.reservations.delete(exec.agent.id)
      }
    })
    registerActionCard(this.ctx, {
      name: 'create_personalized_page',
      description: 'Offer an optional plan for a reusable page or interactive tool. Load personalized-pages to plan it and check for existing capabilities; do not use this action for questions about existing features. At most one recommendation per turn. The user starts background creation from the card.',
      parameters: {
        title: { type: 'string', required: true, description: 'Short name in the user’s language.' },
        brief: { type: 'string', required: true, description: 'One to three concise sentences in the user’s language: requested purpose, interactions, known input and persistence scope. Include only requested or essential behavior; do not add optional features or link unrelated wishes. Ask only when a missing fact changes the outcome; leave implementation details to the Creator. Shown on the card and passed to the Creator.' },
        slot: { type: 'string', enum: ['sidebar-right', 'page', 'sidebar-left'], required: true, description: 'Location selected using the personalized-pages skill: sidebar-right for Session viewers/editors, page for Session streaming tabs, sidebar-left for a global main-area page with a left entry. Honor an explicit user choice.' },
      },
      prepare: (args, callId) => {
        if (args.title.trim() === '' || args.brief.trim() === '') {
          throw new CreationRecommendationError('Describe the user need and the proposed interface.', 'CREATION_NEED')
        }
        return { callId, title: args.title.trim(), brief: args.brief.trim(), slot: slotSchema.parse(args.slot) }
      },
    })
    for (const agent of this.ctx.agents.roots()) await this.recoverOnOpen(agent)
  }

  /** Apply a human decision to a logged proposal.
   * @param agent - Live root resolved from the displayed session.
   * @param callId - Logged proposal id.
   * @param action - Create, cancel generation, dismiss, confirm retention, or remove the owned bundle.
   * @param slot - Location chosen by the user when creating or dismissing.
   * @param customLocation - Omitted: use slot. Present: Creator resolves this human-authored placement instead.
   * @returns acceptance for background work, a durable receipt, or a refusal.
   */
  @Remote
  act(agent: Agent, callId: ToolCallId, action: 'create' | 'dismiss' | 'keep' | 'undo' | 'cancel', slot: CreationSlot, customLocation?: string): Promise<CreationActionResult> {
    if ((action === 'create' || action === 'undo') && !this.ctx.remoteAccess.allows({ kind: 'global' })) return Promise.resolve({ status: 'refused', reason: 'access-denied' })
    if (this.isStopping()) return Promise.resolve({ status: 'refused', reason: 'closing' })
    if (!this.ctx.agents.roots().includes(agent)) return Promise.resolve({ status: 'refused', reason: 'not-live-root' })
    const custom = customLocationSchema.optional().safeParse(customLocation)
    if (action === 'create' && (!slotSchema.safeParse(slot).success || !custom.success)) return Promise.resolve({ status: 'refused', reason: 'invalid-location' })
    const key = JSON.stringify([agent.id, callId])
    const existing = this.actions.get(key)
    if (existing !== undefined) return existing
    const operation = this.ctx.agents.withInitiator(agent, () => this.decide(
      agent, callId, action, slot, key, custom.success ? custom.data : undefined,
    ))
      .finally(() => { this.actions.delete(key) })
    this.actions.set(key, operation)
    return operation
  }

  private record(agent: Agent, decision: CreationDecision): void {
    appendPluginRecord(agent.session, 'plugin:creation-recommendations/decision', decision)
  }

  private async recover(agent: Agent): Promise<void> {
    for (const decision of Object.values(this.projection.stateOf(agent.session).view.decisions)) {
      if (!['creating', 'installing', 'interrupted', 'cancelled', 'failed', 'unconfirmed'].includes(decision.phase) || this.jobs.has(JSON.stringify([agent.id, decision.callId]))) continue
      const installed = (await this.ctx.pluginManager.listBundles()).find(bundle => bundle.name === decision.bundleName && bundle.installed)
      if (installed !== undefined) this.record(agent, {
        callId: decision.callId, slot: decision.slot, phase: 'installed', bundleName: installed.name,
        ...(decision.customLocation === undefined ? {} : { customLocation: decision.customLocation }),
        ...(installed.error === undefined && installed.enabled ? {} : { application: 'failed' }),
      })
      else if (decision.phase === 'creating' || decision.phase === 'installing' || decision.phase === 'unconfirmed') this.record(agent, { ...decision, phase: 'interrupted' })
    }
  }

  private async recoverOnOpen(agent: Agent): Promise<void> {
    try { await this.recover(agent) }
    catch (error) {
      this.ctx.logger.warn('Cannot confirm created plugins for session %s: %s. Card retries recheck the profile before creating anything.', agent.id, String(error))
      for (const decision of Object.values(this.projection.stateOf(agent.session).view.decisions)) {
        if (['creating', 'installing', 'interrupted', 'cancelled', 'failed'].includes(decision.phase) && !this.jobs.has(JSON.stringify([agent.id, decision.callId]))) {
          this.record(agent, { ...decision, phase: 'unconfirmed' })
        }
      }
    }
  }

  /** Parent disposal starts before its child effects drain. */
  private isStopping(): boolean {
    let owner = this.owner
    while (true) {
      if (owner.uid === null || owner.state === FiberState.UNLOADING) return true
      const parent = owner.parent.fiber
      if (parent === owner) return this.closing
      owner = parent
    }
  }

  private async decide(agent: Agent, callId: ToolCallId, action: 'create' | 'dismiss' | 'keep' | 'undo' | 'cancel', slot: CreationSlot, key: string, customLocation?: string): Promise<CreationActionResult> {
    try { await this.recover(agent) }
    catch (error) {
      this.ctx.logger.warn('Cannot confirm creation before card action: %s', String(error))
      return { status: 'refused', reason: 'unavailable' }
    }
    const state = this.projection.stateOf(agent.session)
    const proposal = state.proposals[callId]
    if (proposal === undefined) return { status: 'refused', reason: 'unknown' }
    if (this.isStopping()) return { status: 'refused', reason: 'closing' }
    if (!this.ctx.agents.roots().includes(agent)) return { status: 'refused', reason: 'not-live-root' }
    const previous = state.view.decisions[callId]
    const job = this.jobs.get(key)
    if (job !== undefined) {
      if (action === 'cancel' && previous?.phase !== 'installing') {
        job.abort.abort('cancelled')
        await job.done
      }
      return { status: 'accepted' }
    }
    if (previous?.phase === 'installed' || previous?.phase === 'kept') {
      if (action !== 'keep' && action !== 'undo') return { status: 'settled', decision: previous }
      if (previous.bundleName === undefined) return { status: 'refused', reason: 'unavailable' }
      let decision: CreationDecision = { ...previous, phase: 'kept' }
      if (action === 'undo') {
        const bundle = (await this.ctx.pluginManager.listBundles()).find(item => item.name === previous.bundleName && item.installed)
        if (this.isStopping()) return { status: 'refused', reason: 'closing' }
        const result = bundle === undefined ? undefined : await Promise.race([
          this.ctx.pluginManager.removeBundle(previous.bundleName), this.stopped.promise,
        ])
        if (this.isStopping()) return { status: 'unconfirmed', reason: 'closing' }
        decision = result === undefined ? { ...previous, phase: 'removed', application: 'applied' }
          : { ...previous, phase: result.application === 'applied' ? 'removed' : previous.phase, application: result.application }
      }
      this.record(agent, decision)
      return { status: 'settled', decision }
    }
    if (previous?.phase === 'dismissed' || previous?.phase === 'removed' || action === 'cancel' && previous !== undefined) return { status: 'settled', decision: previous }
    if (action === 'dismiss') {
      const decision: CreationDecision = { callId, phase: 'dismissed', slot: slotSchema.safeParse(slot).success ? slot : proposal.slot,
        ...(customLocation === undefined ? {} : { customLocation }) }
      this.record(agent, decision)
      return { status: 'settled', decision }
    }
    if (action !== 'create') return { status: 'refused', reason: 'unavailable' }
    const id = randomUUID()
    const directory = join(this.ctx.profileContext.dir, 'created-plugins', id)
    // Spawn preserves the parent's workspace-write boundary even with a different cwd.
    const sourceDirectory = join(agent.session.header.cwd ?? this.ctx.profileContext.cwd, '.dsh-created-plugins', id)
    const bundleName = '@dsh-local/view-' + id
    const decision: CreationDecision = { callId, phase: 'creating', slot, bundleName,
      ...(customLocation === undefined ? {} : { customLocation }) }
    this.record(agent, decision)
    const abort = new AbortController()
    const childId = SessionId(randomUUID())
    const done = this.generate(agent, childId, proposal, decision, sourceDirectory, directory, bundleName, abort.signal)
      .finally(() => { this.jobs.delete(key) })
    this.jobs.set(key, { parent: agent, childId, decision, abort, done })
    return { status: 'accepted' }
  }

  private async generate(
    agent: Agent, childId: SessionId, proposal: CreationRecommendation, decision: CreationDecision,
    sourceDirectory: string, directory: string, bundleName: string, signal: AbortSignal,
  ): Promise<void> {
    try {
      signal.throwIfAborted()
      await mkdir(sourceDirectory, { recursive: true, mode: 0o700 })
      signal.throwIfAborted()
      const activation = await this.ctx.subagents.startActivation({
        provider: 'spawn', label: proposal.title, delivery: 'caller', signal, childId,
        request: {
          parent: agent, agentPreset: 'cordis', cwd: sourceDirectory,
          prompt: [{ type: 'text', text: JSON.stringify({
            task: 'Create one new independently removable DSH interface plugin. Read and use the cordis-plugin-development skill. Generate and build the package only; the caller validates and installs it. Do not install, enable, remove, or edit any existing plugin or profile configuration.',
            title: proposal.title, brief: proposal.brief,
            location: decision.customLocation === undefined ? decision.slot : { request: decision.customLocation },
            directory: sourceDirectory, packageName: bundleName,
            packaging: 'Write a package.json with the exact reserved name, version, and dsh.bundle.patch="./cordis.patch.yml". Write cordis.patch.yml as a plain YAML or JSON array containing only {insert:[...]} operations. Do not use groups, aliases, custom tags or includes. Every inserted id must start with the package name plus a colon, and each module name must be this package or one of its exports. Use existing DSH slots and theme tokens. Build and export all runtime entry points before reporting ready. Symlinks must be relative and remain inside this package; the installed copy must work without the source directory.',
            ...(decision.customLocation === undefined ? {
              uiReference: fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-experimental-creation-recommendations/references/'
                + { 'sidebar-right': 'sidebar-right.md', page: 'session-tab.md', 'sidebar-left': 'sidebar-entry.md' }[decision.slot])),
              locationPolicy: 'location and uiReference are the user’s final choice in the card. They override any earlier location described in brief; preserve the requested behavior and data scope while adapting the interface to this chosen location.',
            } : {
              uiReferences: ['sidebar-right.md', 'session-tab.md', 'sidebar-entry.md'].map(file => fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-experimental-creation-recommendations/references/' + file))),
              locationPolicy: 'location.request is the user’s final placement instruction, overriding earlier placement in brief. Resolve it using existing documented DSH extension points; the references describe common placements, not a new custom slot. Preserve the requested behavior and data scope. Do not change the application shell or install anything outside this removable plugin. If the placement cannot be implemented, report ready:false instead of silently substituting another location.',
            }),
            lifecycle: 'Read the relevant absolute uiReference or uiReferences bundled with this plugin before implementation; they supplement the cordis-plugin-development skill. Follow their registration, persistence and teardown guidance. Unloading must remove only this plugin’s UI and tabs, preserving unrelated content. Generate and build only; the caller installs and validates the live result.',
            completion: 'After the package and required checks are complete, finish by calling structured_output with {"ready":true}. Do not send a final prose report: only that tool call hands the package back for installation. If the package cannot be completed, call structured_output with {"ready":false}.',
          }) }],
          outputSchema: { type: 'object', properties: { ready: { type: 'boolean' } }, required: ['ready'], additionalProperties: false },
        },
      })
      let disposing: Promise<void> | undefined
      const stop = () => {
        disposing ??= activation.dispose()
        void disposing.catch((error: unknown) => { this.ctx.logger.warn('Creator cleanup failed: %s', String(error)) })
      }
      signal.addEventListener('abort', stop, { once: true })
      try {
        if (signal.aborted) stop()
        const result = await activation.result
        signal.throwIfAborted()
        if (result.stopReason !== 'completed' || !z.object({ ready: z.literal(true) }).safeParse(result.structured).success) {
          throw new CreationRecommendationError('The Creator did not finish the plugin.', 'CREATION_INCOMPLETE')
        }
      } finally {
        signal.removeEventListener('abort', stop)
        await (disposing ?? activation.dispose())
      }
      await validateGeneratedBundle(sourceDirectory, bundleName)
      if ((await this.ctx.pluginManager.listBundles()).some(bundle => bundle.name === bundleName)) {
        throw new CreationRecommendationError('The reserved package name is already in use.', 'CREATION_EXISTS')
      }
      signal.throwIfAborted()
      await cp(sourceDirectory, directory, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true })
      await validateGeneratedBundle(directory, bundleName)
      signal.throwIfAborted()
      this.record(agent, { ...decision, phase: 'installing' })
      // PluginManager owns the accepted installation, which can itself reload us.
      // Stop local follow-up on unload and reconcile its outcome when reopened.
      const result = await Promise.race([this.ctx.pluginManager.installBundle(directory), this.stopped.promise])
      if (result === undefined || this.isStopping()) return
      const installed = (await this.ctx.pluginManager.listBundles()).some(bundle => bundle.name === bundleName && bundle.installed)
      const current = this.ctx.agents.roots().find(root => root.id === agent.id)
      if (current !== undefined) this.record(current, {
        ...decision, phase: installed ? 'installed' : 'failed', application: result.application,
      })
    } catch (error) {
      this.ctx.logger.warn('Interface creation failed: %s', String(error))
      const current = this.ctx.agents.roots().find(root => root.id === agent.id)
      const phase = signal.aborted ? signal.reason === 'cancelled' ? 'cancelled' : 'interrupted' : 'failed'
      if (current !== undefined) this.record(current, { ...decision, phase })
    }
  }
}

/**
 * Assemble the feature-owned Remote; disposing the feature also disposes its effects.
 * @param ctx - Owning feature context.
 */
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(CreationRecommendations)
}

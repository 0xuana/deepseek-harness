/** Explicit-need official plugin recommendations: an answer's dsh-action block proposes, and only a human card action enables. */
import { z } from 'zod'
import { FiberState, Service, type Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { createUserMessage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { ManagementError } from '@deepseek-ai/dsh-plugin-manager/types'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import type {} from '@deepseek-ai/dsh-skill'
import { eligible, registerOfficialPluginsSkill } from './skill.ts'
import { recommendationProjection, type RecommendationState } from './projection.ts'
import type { RecommendationActionResult, RecommendationDetails, RecommendationOutcome } from './types.ts'
export type * from './types.ts'

export const name = 'plugin-recommendations'

/** Deployment-tunable limits for offering cards. */
export const Config = z.object({
  /** Queued next-turn messages at or above which a proposal written in the current turn is never offered. */
  queuedMessageLimit: z.number().int().min(1).default(2),
}).prefault({})
/** Validated card limits after schema defaults. */
export type Config = z.infer<typeof Config>

declare module '@deepseek-ai/cordis' {
  interface Context { pluginRecommendations: PluginRecommendations }
}

/** Internal Remote and effect owner assembled by the plugin-recommendation feature. */
export class PluginRecommendations extends TypertRemoteService {
  static inject = ['pluginManager', 'agents', 'sessionProjections', 'remoteAccess', 'skills']
  private projection!: ProjectionHandle<RecommendationState>
  private readonly operations = new Map<string, Promise<RecommendationActionResult>>()
  private readonly stopped = Promise.withResolvers<undefined>()
  private closing = false
  private readonly owner: Context['fiber']

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'pluginRecommendations')
    this.owner = ctx.fiber
  }

  protected async [Service.init](): Promise<void> {
    this.projection = await this.ctx.sessionProjections.register(recommendationProjection(this.config))
    registerOfficialPluginsSkill(this.ctx)
    // Same as personalized pages until the shared action-card layer owns status notices.
    /* jscpd:ignore-start */
    this.ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted || this.isStopping()) return decision
      const state = this.projection.stateOf(agent.session)
      const pending = Object.entries(state.pendingStatus)
      if (pending.length === 0) return decision
      const updates = pending.map(([callId]) => ({ plugin: state.proposals[callId]?.name, outcome: state.view.decisions[callId] }))
      return { ...decision, messages: [...decision.messages, createUserMessage({
        source: { kind: 'plugin-recommendations', through: SessionSeq(Math.max(...pending.map(([, seq]) => seq))),
          form: 'notice', summary: 'Official plugin status updated' },
        content: [{ type: 'text', text: 'Latest official plugin card status from the user’s clicks. These are status facts, not a request for more work. '
          + 'applied means the plugin is enabled now; restart-required means it is saved and takes effect after DSH restarts; overridden means another configuration keeps it off; '
          + 'failed or cancelled means it is not enabled and can be retried from its card; already-enabled means it was on already; dismissed means the user declined it, so do not offer it again in this conversation. '
          + 'Enabling a plugin authorizes nothing beyond it. Continue with the user’s current request.\n' + JSON.stringify(updates) }],
      })] }
    }, { prepend: true })
    /* jscpd:ignore-end */
    this.ctx.effect(() => async () => {
      this.closing = true
      this.stopped.resolve(undefined)
      await Promise.allSettled([...this.operations.values()])
    }, 'plugin-recommendations: drain card actions')
  }

  /**
   * Read the current catalog text for a logged proposal's card.
   * @param agent - Exact live root resolved by the Gateway from the Session id.
   * @param callId - Proposal id from the answer block, never a package supplied by the browser.
   * @returns the plugin's title, description and selection, or a refusal when the block names no available official plugin.
   */
  @Remote
  async describe(agent: Agent, callId: ToolCallId): Promise<RecommendationDetails> {
    if (this.isStopping()) return { status: 'refused', reason: 'closing' }
    if (!this.ctx.agents.roots().includes(agent)) return { status: 'refused', reason: 'not-live-root' }
    const proposal = this.projection.stateOf(agent.session).proposals[callId]
    if (proposal === undefined) return { status: 'refused', reason: 'unknown' }
    const bundle = (await this.ctx.pluginManager.listBundles()).find(item => item.name === proposal.name)
    if (bundle === undefined || !eligible(bundle)) return { status: 'refused', reason: 'unavailable' }
    return { status: 'available', title: bundle.meta?.title ?? bundle.name,
      description: bundle.meta?.description ?? bundle.description ?? '', enabled: bundle.enabled }
  }

  /**
   * Decide one logged recommendation. Concurrent actions on the same card share
   * one operation; a settled success or dismissal never enables twice. Failed
   * activation remains retryable. Profile selection survives session disposal.
   * @param agent - Exact live root resolved by the Gateway from the Session id.
   * @param callId - Proposal id from the answer block, never a package supplied by the browser.
   * @param action - Human choice.
   * @returns An observed outcome, a refusal before mutation, or an unconfirmed result if reload interrupts the wait.
   */
  @Remote
  act(agent: Agent, callId: ToolCallId, action: 'enable' | 'dismiss'): Promise<RecommendationActionResult> {
    // The Agent lookup covers the Session. Enabling also touches the whole profile.
    if (action === 'enable' && !this.ctx.remoteAccess.allows({ kind: 'global' })) return Promise.resolve({ status: 'refused', reason: 'access-denied' })
    if (this.isStopping()) return Promise.resolve({ status: 'refused', reason: 'closing' })
    if (!this.ctx.agents.roots().includes(agent)) return Promise.resolve({ status: 'refused', reason: 'not-live-root' })
    const key = JSON.stringify([agent.id, callId])
    const running = this.operations.get(key)
    if (running !== undefined) return running
    const operation = this.ctx.agents.withInitiator(agent, () => this.decide(agent, callId, action))
      .finally(() => { this.operations.delete(key) })
    this.operations.set(key, operation)
    return operation
  }

  /** Parent disposal starts before its child effects drain. */
  // Each optional bundle owns its lifetime check until the shared action-card layer owns card actions.
  /* jscpd:ignore-start */
  private isStopping(): boolean {
    let owner = this.owner
    while (true) {
      if (owner.uid === null || owner.state === FiberState.UNLOADING) return true
      const parent = owner.parent.fiber
      if (parent === owner) return this.closing
      owner = parent
    }
  }
  /* jscpd:ignore-end */

  private async decide(agent: Agent, callId: ToolCallId, action: 'enable' | 'dismiss'): Promise<RecommendationActionResult> {
    const state = this.projection.stateOf(agent.session)
    if (state.view.invalid) return { status: 'refused', reason: 'invalid-history' }
    const proposal = state.proposals[callId]
    if (proposal === undefined) return { status: 'refused', reason: 'unknown' }
    const previous = state.view.decisions[callId]
    if (previous !== undefined && previous !== 'failed' && previous !== 'cancelled') return { status: 'settled', outcome: previous }
    let outcome: RecommendationOutcome = 'dismissed'
    let errorCode: ManagementError['code'] | undefined
    if (action === 'enable') {
      const bundle = (await this.ctx.pluginManager.listBundles()).find(item => item.name === proposal.name)
      if (bundle === undefined || !eligible(bundle)) return { status: 'refused', reason: 'unavailable' }
      if (this.isStopping()) return { status: 'refused', reason: 'closing' }
      if (!this.ctx.agents.roots().includes(agent)) return { status: 'refused', reason: 'not-live-root' }
      if (bundle.enabled) outcome = 'already-enabled'
      else {
        // PluginManager owns the accepted profile mutation. HMR may unload this
        // consumer before it finishes, so only our receipt wait is cancelled.
        const result = await Promise.race([this.ctx.pluginManager.setBundleEnabled(bundle.name, true), this.stopped.promise])
        if (result === undefined || this.isStopping()) return { status: 'unconfirmed', reason: 'closing' }
        outcome = result.application
        errorCode = result.error?.code
      }
    }
    // Profile files own the configuration; this receipt owns the card's decision and the model's status notice.
    appendPluginRecord(agent.session, 'plugin:plugin-recommendations/decision', { callId, outcome })
    return { status: 'settled', outcome, ...errorCode === undefined ? {} : { errorCode } }
  }
}

/**
 * Assemble the feature-owned Remote; disposing the feature also disposes its effects.
 * @param ctx - Owning feature context.
 * @param config - Validated card limits; the Loader supplies them, and direct composition gets the schema defaults.
 */
export async function apply(ctx: Context, config: Config = Config.parse({})): Promise<void> {
  await ctx.plugin(PluginRecommendations, config)
}

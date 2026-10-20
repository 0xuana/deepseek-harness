/** Explicit-need recommendations; only a human card action enables a plugin. */
import { FiberState, Service, type Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { createUserMessage, boundContextSummary, HarnessError, type ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { BundleInfo, ManagementError } from '@deepseek-ai/dsh-plugin-manager/types'
import type { LocalizedText } from '@deepseek-ai/dsh-package-manifest'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import { recommendationProjection, type RecommendationState } from './projection.ts'
import type { PluginRecommendation, RecommendationActionResult, RecommendationOutcome } from './types.ts'
export type * from './types.ts'

export const name = 'plugin-recommendations'

declare module '@deepseek-ai/cordis' {
  interface Context { pluginRecommendations: PluginRecommendations }
}

/** Shipped optional plugins only; no arbitrary install target is accepted. */
function eligible(bundle: BundleInfo): boolean {
  return bundle.official && bundle.optional && bundle.availability !== 'missing'
    && bundle.readOnlyReason === undefined && bundle.error === undefined
}

function localized(text: LocalizedText | undefined, language: 'en' | 'zh', fallback: string): string {
  return typeof text === 'string' ? text : text?.[language] ?? text?.en ?? fallback
}

/** Tool refusals have stable identities and cause no profile mutation. */
export class PluginRecommendationError extends HarnessError {}

/** Internal Remote and effect owner assembled by the plugin-recommendation feature. */
export class PluginRecommendations extends TypertRemoteService {
  static inject = ['tools', 'pluginManager', 'agents', 'sessionProjections', 'remoteAccess', 'systemPrompt']
  private projection!: ProjectionHandle<RecommendationState>
  private readonly operations = new Map<string, Promise<RecommendationActionResult>>()
  private readonly proposals = new Map<string, { turn: number; callId: ToolCallId }>()
  private readonly stopped = Promise.withResolvers<undefined>()
  private closing = false
  private readonly owner: Context['fiber']

  constructor(ctx: Context) {
    super(ctx, 'pluginRecommendations')
    this.owner = ctx.fiber
  }

  protected async [Service.init](): Promise<void> {
    this.projection = await this.ctx.sessionProjections.register(recommendationProjection)
    this.ctx.systemPrompt.section({
      name: 'recommendations:official-plugins',
      order: this.ctx.systemPrompt.getSectionOrder('TOOL_PLUGIN_RECOMMENDATIONS'),
      text: ({ agent }) => agent !== undefined && this.ctx.agents.roots().includes(agent)
        && this.ctx.tools.get('list_official_plugins', agent) !== undefined
        && this.ctx.tools.get('suggest_plugin', agent) !== undefined
        ? 'Recommendation eligibility comes first: for discussion-only requests, declined recommendations, quoted wishes and ordinary tasks, do not call discovery or recommendation tools or skills. For an eligible DSH product-use need, reuse the current catalog already supplied this turn by personalized-pages or list_official_plugins. Call list_official_plugins only when that catalog is absent or installation state has changed; a different need in the same turn is not a state change. This includes the language or readability of displayed thinking, input methods and finding past work. A wish to use DSH differently is not an instruction to develop DSH, even when runtime context includes its checkout. Do not read source, files or configuration for discovery. Match the desired outcome using catalog descriptions; display translation can address readability without changing reasoning generation, so explain that limit. For an enabled match, explain how to use it without a card. For a disabled match, call suggest_plugin and stop discovery; do not load page-creation skills for an existing-plugin recommendation. Consider ALL independent needs before selecting one card. Follow explicit priority; otherwise prefer a suitable existing plugin, even if a creation wish is mentioned first or described in more detail. If creation is selected and no existing capability fits it, load the available personalized-pages skill. Briefly acknowledge other needs without another lookup, invented connections or a promised later card. Answer in the user’s language; leave the detailed plan on the card. Do not claim installation before the user acts, or ask for a reply or refresh afterward. Skip discovery for ordinary tasks, quoted or vague wishes and declined recommendations. Available creation guidance may allow an optional page for a clearly reusable result already obtained. Explicit requests to implement or debug source may use development tools.'
        : '',
    })
    this.ctx.on('agent/disposed', ({ agent }) => { this.proposals.delete(agent.id) })
    this.ctx.on('tools/result', (exec, result) => {
      if (result.isError && exec.agent !== undefined && this.proposals.get(exec.agent.id)?.callId === exec.callId) {
        this.proposals.delete(exec.agent.id)
      }
    })
    this.ctx.effect(() => async () => {
      this.closing = true
      this.stopped.resolve(undefined)
      await Promise.allSettled([...this.operations.values()])
    }, 'plugin-recommendations: drain card actions')
    this.ctx.tools.register(defineTool({
      name: 'list_official_plugins',
      description: 'Skip this tool for declined recommendations, discussion-only requests, quotes and ordinary tasks. Also skip when personalized-pages or this tool already supplied the current catalog this turn; use those names and descriptions directly, without a confirmation lookup. Otherwise read built-in optional DSH plugins and their enabled state for an explicit product-use need, before inspecting source, configuration or instruction files. Re-query only after installation state changes. Catalog descriptions are sufficient; do not research implementation or setup steps. Match the desired user outcome semantically and explain any material limit. For a suitable disabled entry use suggest_plugin; for an enabled entry explain that it is already enabled and how to use it, without another card. This is read-only and enables nothing. Skip ordinary tasks, quoted wishes, declined or unrelated needs.',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async (_args, exec) => {
        const bundles = await this.ctx.pluginManager.listBundles()
        exec.signal.throwIfAborted()
        return JSON.stringify(bundles.filter(eligible).map(bundle => ({
          name: bundle.name,
          title: bundle.meta?.title ?? bundle.name,
          description: bundle.meta?.description ?? bundle.description ?? '',
          enabled: bundle.enabled,
        })))
      },
    }))
    this.ctx.tools.register(defineTool({
      name: 'suggest_plugin',
      description: 'Propose one disabled built-in official plugin for an explicit user need. Use an exact name from the current catalog supplied by list_official_plugins or personalized-pages; do not repeat discovery in the same turn. Select ONE recommendation per turn across suggest_plugin and suggest_action, even if multiple cards are requested; never batch recommendations. Honor explicit priority; otherwise prefer an existing plugin over creating an interface. Explain remaining independent needs in the answer without another recommendation call or a promise of an automatic later card. Clarify missing requirements; do not invent connections between needs. Do not call for vague, unexpressed or declined needs, already enabled plugins, or third-party packages. Call before the final answer, then answer concisely in the user’s language using only successful results. A rejected call created no card. The card appears below the completed answer. This only proposes: the user must click Enable. Never enable through another tool or claim it is enabled. Clicking Enable applies the plugin and automatically sends confirmation; never ask the user to report back, refresh or reopen. Include only setup requirements stated in the catalog; do not invent installation steps or inspect source to add them. The card reports any actual restart requirement. Enabling authorizes this plugin only, not another recommendation or unrelated work. The user can later disable or remove it from its details page.',
      parameters: {
        name: { type: 'string', required: true, description: 'Exact official catalog name.' },
        request: { type: 'string', required: true, description: 'Only the selected explicit need this plugin addresses and its relevant context; keep other independent wishes separate.' },
        reason: { type: 'string', required: true, description: 'Brief benefit tied to that need, in the user\'s language.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify({ status: 'offered', name: (JSON.parse(value) as PluginRecommendation).name }) }],
        presentationMeta: (_args, value) => ({ pluginRecommendation: { ...(JSON.parse(value) as PluginRecommendation) } }),
      },
      execute: async (args, exec) => {
        const agent = exec.agent
        if (agent === undefined || !this.ctx.agents.roots().includes(agent)) {
          throw new PluginRecommendationError('Plugin recommendations require a live root conversation.', 'RECOMMENDATION_CALLER')
        }
        const request = args.request.trim()
        if (request === '' || args.reason.trim() === '') {
          throw new PluginRecommendationError('Describe the explicit user need and explain how the plugin helps.', 'RECOMMENDATION_NEED')
        }
        const state = this.projection.stateOf(agent.session)
        if (state.view.invalid) throw new PluginRecommendationError('This conversation contains an unreadable recommendation receipt. Update DSH or use a new conversation.', 'RECOMMENDATION_HISTORY')
        const pending = this.proposals.get(agent.id)
        const first = state.firstCall ?? (pending?.turn === state.turn ? pending.callId : undefined)
        if (first !== undefined && first !== exec.callId) {
          throw new PluginRecommendationError('This turn already has a recommendation. This call created no card. Finish using successful results only; do not promise an automatic later card.', 'RECOMMENDATION_LIMIT')
        }
        const reservation = { turn: state.turn, callId: exec.callId }
        this.proposals.set(agent.id, reservation)
        try {
          const bundle = (await this.ctx.pluginManager.listBundles()).find(item => item.name === args.name)
          exec.signal.throwIfAborted()
          if (bundle === undefined || !eligible(bundle) || bundle.enabled) {
            throw new PluginRecommendationError('This plugin is not an available, disabled built-in official plugin. Read list_official_plugins again.', 'RECOMMENDATION_UNAVAILABLE')
          }
          const recommendation: PluginRecommendation = {
            callId: exec.callId, name: bundle.name, request, reason: args.reason.trim(),
            titleEn: localized(bundle.meta?.title, 'en', bundle.name),
            titleZh: localized(bundle.meta?.title, 'zh', bundle.name),
            descriptionEn: localized(bundle.meta?.description, 'en', bundle.description ?? ''),
            descriptionZh: localized(bundle.meta?.description, 'zh', bundle.description ?? ''),
          }
          return JSON.stringify(recommendation)
        } catch (error) {
          if (this.proposals.get(agent.id) === reservation) this.proposals.delete(agent.id)
          throw error
        }
      },
    }))
  }

  /**
   * Decide one logged recommendation. Concurrent actions on the same card share
   * one operation; a settled success or dismissal never enables twice. Failed
   * activation remains retryable. Profile selection survives session disposal.
   * @param agent - Exact live root resolved by the Gateway from the Session id.
   * @param callId - Proposal stored by suggest_plugin, never a package supplied by the browser.
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
  private isStopping(): boolean {
    let owner = this.owner
    while (true) {
      if (owner.uid === null || owner.state === FiberState.UNLOADING) return true
      const parent = owner.parent.fiber
      if (parent === owner) return this.closing
      owner = parent
    }
  }

  private async decide(agent: Agent, callId: ToolCallId, action: 'enable' | 'dismiss'): Promise<RecommendationActionResult> {
    const state = this.projection.stateOf(agent.session)
    if (state.view.invalid) return { status: 'refused', reason: 'invalid-history' }
    const proposal = state.proposals[callId]
    if (proposal === undefined) return { status: 'refused', reason: 'unknown' }
    const previous = state.view.decisions[callId]
    if (previous !== undefined && previous !== 'failed' && previous !== 'cancelled') return { status: 'settled', outcome: previous }
    let outcome: RecommendationOutcome = 'dismissed'
    let notify = false
    let errorCode: ManagementError['code'] | undefined
    if (action === 'enable') {
      const bundle = (await this.ctx.pluginManager.listBundles()).find(item => item.name === proposal.name)
      if (bundle === undefined || !eligible(bundle)) return { status: 'refused', reason: 'unavailable' }
      if (this.isStopping()) return { status: 'refused', reason: 'closing' }
      if (!this.ctx.agents.roots().includes(agent)) return { status: 'refused', reason: 'not-live-root' }
      if (bundle.enabled) outcome = 'already-enabled'
      else {
        // PluginManager owns the accepted profile mutation. HMR may unload this
        // consumer before it finishes, so only our receipt/notification wait is cancelled.
        const result = await Promise.race([this.ctx.pluginManager.setBundleEnabled(bundle.name, true), this.stopped.promise])
        if (result === undefined || this.isStopping()) return { status: 'unconfirmed', reason: 'closing' }
        outcome = result.application
        errorCode = result.error?.code
        notify = outcome === 'applied' && result.changed
      }
    }
    // Profile files own the configuration; this receipt owns the card's decision.
    appendPluginRecord(agent.session, 'plugin:plugin-recommendations/decision', { callId, outcome })
    if (notify) {
      agent.steer(createUserMessage({
        source: { kind: 'plugin-recommendation', callId, form: 'notice', summary: boundContextSummary(`Enabled ${proposal.titleEn}`) },
        content: [{ type: 'text', text: JSON.stringify({
          plugin: proposal.name, status: 'enabled', userRequest: proposal.request,
          instruction: 'The user clicked Enable, which only enables this plugin. First re-read the original user message, not just userRequest above: preserve explicit limits such as "only recommend", "do not execute", or "not yet" even when the request also describes a desired task. In those cases, or when the user only asked to find or enable a plugin, briefly confirm activation and stop without calling tools or asking for another message. Otherwise continue only work already requested, using the available capability. Enabling is not permission for new account-wide searches, bulk edits, or other scope changes.',
        }) }],
      }))
    }
    return { status: 'settled', outcome, ...errorCode === undefined ? {} : { errorCode } }
  }
}

/**
 * Assemble the feature-owned Remote; disposing the feature also disposes its effects.
 * @param ctx - Owning feature context.
 */
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(PluginRecommendations)
}

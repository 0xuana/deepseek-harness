/** Explicit-need recommendations; only a human card action enables a plugin. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { createUserMessage, boundContextSummary, HarnessError, type ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { BundleInfo, ManagementError } from '@deepseek-ai/dsh-plugin-manager/types'
import type { LocalizedText } from '@deepseek-ai/dsh-package-manifest'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import { recommendationProjection, type RecommendationState } from './projection.ts'
import type { PluginRecommendation, RecommendationActionResult, RecommendationOutcome } from './types.ts'
export type * from './types.ts'

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

/** Owns the catalog tools, durable decisions, and idempotent card actions. */
export default class PluginRecommendations extends TypertRemoteService {
  static inject = ['tools', 'pluginManager', 'agents', 'sessionProjections', 'remoteAccess']
  private projection!: ProjectionHandle<RecommendationState>
  private readonly operations = new Map<string, Promise<RecommendationActionResult>>()
  private readonly proposals = new Map<string, { turn: number; callId: ToolCallId }>()
  private readonly stopped = Promise.withResolvers<undefined>()
  private closing = false

  constructor(ctx: Context) { super(ctx, 'pluginRecommendations') }

  protected async [Service.init](): Promise<void> {
    this.projection = await this.ctx.sessionProjections.register(recommendationProjection)
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
      description: 'Read the built-in optional DSH plugins that can help with a current explicit user need. This is read-only and does not enable anything. Match the user request semantically against these descriptions. Do not discover unexpressed needs or recommend unrelated plugins.',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async (_args, exec) => {
        const bundles = await this.ctx.pluginManager.listBundles()
        exec.signal.throwIfAborted()
        return JSON.stringify(bundles.filter(bundle => eligible(bundle) && !bundle.enabled).map(bundle => ({
          name: bundle.name,
          title: bundle.meta?.title ?? bundle.name,
          description: bundle.meta?.description ?? bundle.description ?? '',
        })))
      },
    }))
    this.ctx.tools.register(defineTool({
      name: 'suggest_plugin',
      description: 'Offer one built-in official plugin in a conversation card for the current explicit user need. Read list_official_plugins first; use an exact catalog name, summarize the expressed need using conversation context, and explain the benefit in the user\'s language. Do not call for vague needs that require clarification, an explicit request not to recommend, unexpressed needs, already enabled plugins, or third-party packages. This only proposes: the user must click Enable. Do not enable it through another tool or claim it is enabled. Offer at most one plugin per response. Call this tool before your final response, then give one concise answer and finish; do not repeat the answer around the tool call. The card appears below the completed answer. Refer to its actions in the user’s language. Clicking Enable completes activation and automatically sends you confirmation. Never ask the user to type a follow-up, tell you when it is enabled, or refresh the page. Describe the button as the complete activation action. The user can later turn off or remove the plugin from its details page.',
      parameters: {
        name: { type: 'string', required: true, description: 'Exact official catalog name.' },
        request: { type: 'string', required: true, description: 'Explicit user need this capability addresses, including relevant conversation context.' },
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
          throw new PluginRecommendationError('This turn already has a recommendation. Finish the answer.', 'RECOMMENDATION_LIMIT')
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

  /** Read live lifecycle state after awaits rather than narrowing it to a stale value. */
  private isStopping(): boolean { return this.closing }

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

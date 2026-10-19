/** Explicit-need recommendations; only a human card action enables a plugin. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { createUserMessage, boundContextSummary, HarnessError, type ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { BundleInfo } from '@deepseek-ai/dsh-plugin-manager/types'
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
  private closing = false

  constructor(ctx: Context) { super(ctx, 'pluginRecommendations') }

  protected async [Service.init](): Promise<void> {
    this.projection = await this.ctx.sessionProjections.register(recommendationProjection)
    this.ctx.effect(() => async () => {
      this.closing = true
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
      description: 'Offer one built-in official plugin in a conversation card for the current explicit user need. Read list_official_plugins first; use an exact catalog name, summarize the expressed need using conversation context, and explain the benefit in the user\'s language. Do not call for vague needs that require clarification, an explicit request not to recommend, unexpressed needs, already enabled plugins, or third-party packages. This only proposes: the user must click Enable. Do not enable it through another tool or claim it is enabled. Offer at most one plugin per response. Call this tool before your final response, then give one concise answer and finish; do not repeat the answer around the tool call. The card appears below the completed answer. Refer to its actions in the user’s language. Clicking Enable applies the change through hot reload and automatically sends you confirmation. Never ask the user to type a follow-up, tell you when it is enabled, or refresh the page. Describe the button as the complete activation action. Only mention a restart if the actual operation reports restart-required. The user can later turn off or remove the plugin from its Plugins details page.',
      parameters: {
        name: { type: 'string', required: true, description: 'Exact official catalog name.' },
        request: { type: 'string', required: true, description: 'Explicit user need this capability addresses, including relevant conversation context.' },
        reason: { type: 'string', required: true, description: 'Brief benefit tied to that need, in the user\'s language.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
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
   * @returns The observed application outcome or a refusal with no profile mutation.
   */
  @Remote
  act(agent: Agent, callId: ToolCallId, action: 'enable' | 'dismiss'): Promise<RecommendationActionResult> {
    // The Agent lookup covers the Session. Enabling also touches the whole profile.
    if (!this.ctx.remoteAccess.allows({ kind: 'global' })) return Promise.resolve({ status: 'refused', reason: 'access-denied' })
    if (this.closing) return Promise.resolve({ status: 'refused', reason: 'closing' })
    if (!this.ctx.agents.roots().includes(agent)) return Promise.resolve({ status: 'refused', reason: 'not-live-root' })
    const key = JSON.stringify([agent.id, callId])
    const running = this.operations.get(key)
    if (running !== undefined) return running
    const operation = this.ctx.agents.withInitiator(agent, () => this.decide(agent, callId, action))
      .finally(() => { this.operations.delete(key) })
    this.operations.set(key, operation)
    return operation
  }

  private async decide(agent: Agent, callId: ToolCallId, action: 'enable' | 'dismiss'): Promise<RecommendationActionResult> {
    const state = this.projection.stateOf(agent.session)
    const proposal = state.proposals[callId]
    if (proposal === undefined) return { status: 'refused', reason: 'unknown' }
    const previous = state.view.decisions[callId]
    if (previous !== undefined && previous !== 'failed' && previous !== 'cancelled') return { status: 'settled', outcome: previous }
    let outcome: RecommendationOutcome = 'dismissed'
    if (action === 'enable') {
      const bundle = (await this.ctx.pluginManager.listBundles()).find(item => item.name === proposal.name)
      if (bundle === undefined || !eligible(bundle)) return { status: 'refused', reason: 'unavailable' }
      const result = await this.ctx.pluginManager.setBundleEnabled(bundle.name, true)
      outcome = result.application
    }
    // Profile files own the configuration; this receipt owns the card's decision.
    appendPluginRecord(agent.session, 'plugin:plugin-recommendations/decision', { callId, outcome })
    if (outcome === 'applied') {
      agent.steer(createUserMessage({
        source: { kind: 'plugin-recommendation', callId, form: 'notice', summary: boundContextSummary(`Enabled ${proposal.titleEn}`) },
        content: [{ type: 'text', text: JSON.stringify({
          plugin: proposal.name, status: 'enabled', userRequest: proposal.request,
          instruction: 'The user enabled this plugin from the recommendation card. Continue their original request using the available capability.',
        }) }],
      }))
    }
    return { status: 'settled', outcome }
  }
}

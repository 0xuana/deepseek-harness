/** Plugin-local construction of an optional action card. */
import type { Context } from '@deepseek-ai/cordis'
import { HarnessError, type ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferArgs, ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-agent'

/** Preparing a proposal must not execute the action; its owner supplies the click handler and card renderer. */
export interface ActionCardDefinition<S extends ParameterSchemaSpec> {
  readonly name: string
  readonly description: string
  readonly parameters: S
  /** Validate domain requirements and return the durable card data.
   * @param args - Validated fields supplied by the model.
   * @param callId - Identity of this proposal.
   * @returns JSON data consumed by the owning card renderer and click handler.
   */
  prepare(args: InferArgs<S>, callId: ToolCallId): JsonValue
}

/** Register this plugin's proposal tool without introducing a Context service.
 * @param ctx - Owning plugin context with Tools and Agents injected.
 * @param definition - Typed proposal fields and preparation callback; never starts the action.
 * @returns an effect-owned disposer that withdraws the tool and rejects stale calls.
 */
export function registerActionCard<const S extends ParameterSchemaSpec>(
  ctx: Context,
  definition: ActionCardDefinition<S>,
): () => Promise<void> {
  if ('action' in definition.parameters) throw new Error('Action card fields must not redefine action.')
  return ctx.effect(() => {
    let active = true
    const removeTool = ctx.tools.register(defineTool({
      name: 'suggest_action',
      description: 'Propose an optional action card, displayed after your final answer. Follow the selected action’s skill for eligibility and planning. Submission saves a proposal only; the user must click its card to start. Do not execute or claim execution from a proposal. A successful result supplies the card; a rejection creates none.',
      parameters: { request: {
        type: 'object', additionalProperties: false, description: definition.description, required: true,
        properties: { action: { type: 'string', const: definition.name, required: true }, ...definition.parameters },
      } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          action: { type: 'string', required: true }, callId: { type: 'string', required: true }, data: { type: 'json', required: true },
        } },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) + '\nProposal saved. No action has started. The user can start it from the card.' }],
        presentationMeta: (_args, value) => ({ actionCard: value }),
      },
      execute: (args, exec) => {
        if (!active) throw new HarnessError('This action is no longer available.', 'ACTION_CARD_UNAVAILABLE')
        if (exec.agent === undefined || !ctx.agents.roots().includes(exec.agent)) {
          throw new HarnessError('Action cards require a live root conversation.', 'ACTION_CARD_CALLER')
        }
        // defineTool has validated the action discriminator and contributed fields.
        const { action, ...fields } = args.request as Record<string, JsonValue> & { action: string }
        return Promise.resolve({ action, callId: exec.callId, data: definition.prepare(fields as InferArgs<S>, exec.callId) })
      },
    }))
    return () => { active = false; removeTool() }
  }, 'action-card: ' + definition.name)
}

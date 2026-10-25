/** Compose a blank headless Session through repeated preset selections. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'

export const name = 'parent-agent-preset'
export const inject = ['agentPresets']

/**
 * Register the root Session's initial preset selection.
 * @param ctx - Snapshot composition context with the preset roster.
 */
export function apply(ctx: Context): void {
  ctx.on('agent/created', async ({ agent }) => {
    if (agent.session.header.parentSession !== undefined) return
    for (const preset of ['parent', 'reviewer', 'parent', 'reviewer', 'parent']) {
      await ctx.agentPresets.select(agent, preset)
    }
  }, { prepend: true })
}

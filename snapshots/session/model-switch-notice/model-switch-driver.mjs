/** Test-only driver that selects another model after the first step's tool call. */

import { recordModelSelection } from '@deepseek-ai/dsh-agent'

const SELECTED = { provider: 'deepseek-official', model: 'deepseek-v4-pro' }

export const name = 'model-switch-driver'
export const inject = ['tools', 'sessionProjections']

/**
 * Record a different model after `todo_write`; headless installs switch notices.
 * @param {import('@deepseek-ai/cordis').Context} ctx - composition context.
 */
export function apply(ctx) {
  ctx.on('tools/execute', async (exec, next) => {
    const result = await next()
    if (exec.name === 'todo_write' && !result.isError) {
      if (exec.agent === undefined) throw new Error('model-switch driver requires a calling Agent')
      recordModelSelection(ctx.sessionProjections, exec.agent, SELECTED)
    }
    return result
  })
}

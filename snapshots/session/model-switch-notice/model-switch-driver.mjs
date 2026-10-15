/** Test-only explicit initial selection and model switch after the first step's tool call. */

import { currentModelSelection, recordModelSelection } from '@deepseek-ai/dsh-agent'

const SELECTED = { provider: 'deepseek-official', model: 'deepseek-v4-pro' }

export const name = 'model-switch-driver'
export const inject = ['tools', 'sessionProjections']

/**
 * Record an explicit initial choice and a switch after `todo_write`.
 * @param {import('@deepseek-ai/cordis').Context} ctx - composition context.
 */
export function apply(ctx) {
  ctx.on('agent/created', ({ agent }) => {
    const initial = currentModelSelection(ctx.sessionProjections, agent)
    if (initial === undefined) throw new Error('model-switch driver requires an initial route')
    recordModelSelection(ctx.sessionProjections, agent, initial)
    recordModelSelection(ctx.sessionProjections, agent, initial)
  })
  ctx.on('tools/execute', async (exec, next) => {
    const result = await next()
    if (exec.name === 'todo_write' && !result.isError) {
      if (exec.agent === undefined) throw new Error('model-switch driver requires a calling Agent')
      recordModelSelection(ctx.sessionProjections, exec.agent, SELECTED)
    }
    return result
  })
}

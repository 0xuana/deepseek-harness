/** Test-only driver that selects another model after the first step's tool call. */

const SELECTED = { provider: 'deepseek-official', model: 'deepseek-v4-pro' }
const switched = new WeakSet()

export const name = 'model-switch-driver'
export const inject = ['agents']

/**
 * Change the step model after `todo_write`; headless owns the selection notice.
 * @param {import('@deepseek-ai/cordis').Context} ctx - composition context.
 */
export function apply(ctx) {
  ctx.on('session/event', (session, event) => {
    if (event.type === 'todo/write') switched.add(session)
  })
  ctx.on('agent/model', async ({ agent }, next) => {
    const proposed = await next()
    return switched.has(agent.session) ? SELECTED : proposed
  })
}

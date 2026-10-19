/** Reject one scheduler preparation to exercise the terminal internal-failure path. */
import { NativeToolExecutor } from '@deepseek-ai/dsh-tool-executor-native'

export const inject = ['tools']

/** @param {import('@deepseek-ai/cordis').Context} ctx - Scenario-owned runtime. */
export function apply(ctx) {
  ctx.on('agent/created', ({ agent }) => {
    const executor = new NativeToolExecutor(agent.ctx)
    const scheduler = executor.pipeline
    const prepare = scheduler.prepare
    scheduler.prepare = async input => {
      if (input.callId === 'scheduler-fail') {
        scheduler.prepare = prepare
        throw new Error('Snapshot scheduler preparation failed')
      }
      return prepare.call(scheduler, input)
    }
    agent.ctx.tools.setExecutor(executor)
  })
}

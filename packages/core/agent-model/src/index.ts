/**
 * Session model-selection provider: owns the projection and publishes its
 * synchronous operations after registration, retaining the fold through
 * dependent service teardown.
 * @module @deepseek-ai/dsh-agent-model
 */
import { FiberState, type Context, type Fiber } from '@deepseek-ai/cordis'
import { AgentModel } from './service.ts'
import { modelSelectionProjectionDefinition } from './projection.ts'

export { AgentModel } from './service.ts'
export type { ModelSelectionProjection } from './types.ts'

/** Session model-selection provider label. */
export const name = 'agent-model'
/** The provider owns a fold in the Session projection registry. */
export const inject = ['sessionProjections']

/**
 * Register the fold before publishing the selection service. Service withdrawal
 * awaits dependent consumers before removing the projection registration.
 * @param ctx - provider scope owning the projection and service child.
 * @returns after the selection service has activated.
 */
export async function apply(ctx: Context): Promise<void> {
  let service: Fiber | undefined
  const draining = new Set<Fiber>()
  ctx.effect(function* () {
    // Cordis removes an independently disposing consumer before service withdrawal
    // can find it. Track it until it leaves UNLOADING. `ctx.plugin()` returns a
    // wrapper around the fiber, so the shared `dispose` identifies it.
    yield ctx.on('internal/status', (fiber) => {
      if (fiber.state !== FiberState.UNLOADING) draining.delete(fiber)
      else if (service !== undefined && fiber.store?.agentModel?.fiber.dispose === service.dispose) draining.add(fiber)
    })
    yield ctx.sessionProjections.register(modelSelectionProjectionDefinition)
    yield async () => {
      while (draining.size > 0) await Promise.allSettled([...draining].map(fiber => fiber.await()))
    }
    service = ctx.plugin(AgentModel)
    yield service.dispose
  }, 'agentModel.lifecycle()')
  // The synchronous effect assigns the child before returning.
  await (service as Fiber).await()
}

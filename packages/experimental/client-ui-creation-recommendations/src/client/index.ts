/** Bind generated Remote descriptors to the source-tested browser lifecycle. */
import type { Context } from '@deepseek-ai/cordis'
import remote from '@deepseek-ai/dsh-experimental-creation-recommendations/remote'
import { mountRecommendations } from './mount.ts'
export { inject } from './mount.ts'

/** Mount creation recommendations and their optional Remote.
 * @param ctx - Client plugin context.
 * @returns disposer for both contributions.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountRecommendations(ctx, remote)
}

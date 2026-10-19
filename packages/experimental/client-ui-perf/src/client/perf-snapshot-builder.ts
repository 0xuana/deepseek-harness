/** View target builder turning published nodes into turn rows. */

import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationViewBuilder, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { buildTurns } from './perf-aggregate.ts'
import type { PerfSnapshot, PerfViewNode } from './perf-contract.ts'
import { TARGET } from './perf-definition.ts'

const EMPTY_LIST: readonly never[] = []

/** Stable snapshot used before a Session assembled any performance node. */
export const EMPTY_PERF_SNAPSHOT: PerfSnapshot = { turns: EMPTY_LIST, stepCount: 0 }

/** Incremental builder over the target's materialized nodes. */
class PerfSnapshotBuilder implements ConversationViewBuilder<PerfViewNode, PerfSnapshot> {
  private readonly nodes = new Map<string, PerfViewNode>()
  private current: PerfSnapshot = EMPTY_PERF_SNAPSHOT
  readonly empty: PerfSnapshot = EMPTY_PERF_SNAPSHOT

  replace(input: { readonly nodes: readonly PerfViewNode[] }): PerfSnapshot {
    this.nodes.clear()
    for (const node of input.nodes) this.nodes.set(node.key, node)
    return this.snapshot()
  }

  apply(input: { readonly upserts: readonly PerfViewNode[] }): PerfSnapshot {
    if (input.upserts.length === 0) return this.current
    for (const node of input.upserts) this.nodes.set(node.key, node)
    return this.snapshot()
  }

  private snapshot(): PerfSnapshot {
    const turns = buildTurns(this.nodes.values())
    this.current = {
      turns,
      stepCount: turns.reduce((sum, turn) => sum + turn.steps.length, 0),
    }
    return this.current
  }
}

/** The `perf` target every Definition publishes into. */
export const perfViewDefinition: ConversationViewDefinition<PerfViewNode, PerfSnapshot> = {
  target: TARGET,
  create: () => new PerfSnapshotBuilder(),
}

/**
 * Register the target builder. The registration rides the caller's fiber
 * effect, so unloading the plugin drops the target with it.
 * @param ctx - client root context.
 */
export function registerPerfConversationView(ctx: Context): void {
  ctx.uiConversation.views.register(perfViewDefinition)
}

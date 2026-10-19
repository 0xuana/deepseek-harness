/** Native execution plugin for the mounting Agent, preset, or deployment scope. @module */
import type { Context } from '@deepseek-ai/cordis'
import { projectToolSchema } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolExecutor, ToolModelInput, ToolBatchInput, ToolBatchResult } from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline, executeToolBatch } from '@deepseek-ai/dsh-tools/pipeline'
import type { Volatile } from '@deepseek-ai/cosmokit'
import z from '@deepseek-ai/schemastery'

/** Executes visible capabilities directly and owns their complete batch settlement. */
export class NativeToolExecutor implements ToolExecutor {
  private readonly pipeline: ToolExecutionPipeline

  constructor(ctx: Context, private readonly maxParallel: () => number = () => 10) {
    this.pipeline = new ToolExecutionPipeline(ctx, { get: (name, scope) => ctx.tools.get(name, scope) })
  }

  describe(tools: readonly ToolDefinition[]): ToolModelInput {
    return { schemas: tools.map(definition => projectToolSchema(definition, false)) }
  }

  execute(input: ToolBatchInput): Promise<ToolBatchResult> {
    return executeToolBatch(input, this.pipeline, this.maxParallel)
  }
}

/** Cordis plugin name. */
export const name = 'native-tool-executor'
/** Tool registration and scoped dispatch. */
export const inject = ['tools']

/** Native batch concurrency configuration. */
export interface Config {
  /** Maximum overlapping concurrency-safe calls in one batch. */
  maxParallelToolCalls: Volatile<number>
}

/** Validated live concurrency limit; one makes each batch serial. */
export const Config: z<{ maxParallelToolCalls?: number }, Config> = z.object({
  maxParallelToolCalls: z.number().step(1).min(1).default(10).volatile(),
})

/**
 * Select native execution in the mounting scope.
 * @param ctx - context owning this executor's selection and lifetime.
 * @param config - live batch concurrency configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.setExecutor(new NativeToolExecutor(ctx, () => config.maxParallelToolCalls.get()))
}

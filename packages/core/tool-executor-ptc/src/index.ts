/** PTC execution plugin for the mounting Agent, preset, or deployment scope. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import { RUN_CODE_NAME, ToolNotFoundError, projectToolSchema } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolExecutor, ToolModelInput, ToolPromptSection, ToolBatchInput, ToolBatchResult } from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline, executeToolBatch } from '@deepseek-ai/dsh-tools/pipeline'
import { createRunCodeTool, requirePtcRuntime, type PtcSdkLanguage } from './ptc.ts'
import { renderToolsSdk, type ToolSdkSchema } from './ts-types.ts'
import { renderToolsSdkPy } from './py-types.ts'
import type { Volatile } from '@deepseek-ai/cosmokit'
import z from '@deepseek-ai/schemastery'

const PTC_ONLY_INSTRUCTION = `\`${RUN_CODE_NAME}\` is the only tool you can call directly — a tool call naming any other tool fails. Reach every tool the SDK declares below from inside the program.`

const SDK_RENDERERS = {
  typescript: renderToolsSdk,
  python: renderToolsSdkPy,
} satisfies Record<PtcSdkLanguage, (schemas: readonly ToolSdkSchema[], programFormat: 'function-body' | 'repl') => string>

/** Runs programs whose nested tool calls use the shared guarded invocation pipeline. */
export class PtcExecutor implements ToolExecutor {
  readonly sections: readonly ToolPromptSection[]
  private readonly pipeline: ToolExecutionPipeline
  private readonly maxParallelSubCalls: number
  private ptcTransport: ToolDefinition | undefined

  constructor(private readonly ctx: Context, config: Pick<Config, 'maxParallelSubCalls'> = {}, private readonly maxParallel: () => number = () => 10) {
    this.sections = [
      { name: 'tools:ptc-only', order: ctx.systemPrompt.getSectionOrder('PTC_ONLY'), text: PTC_ONLY_INSTRUCTION, interpolate: false },
      { name: 'tools:sdk', order: ctx.systemPrompt.getSectionOrder('TOOLS_SDK'), text: tools => this.renderSdk(tools), interpolate: false },
    ]
    this.maxParallelSubCalls = config.maxParallelSubCalls ?? 10
    if (!Number.isInteger(this.maxParallelSubCalls) || this.maxParallelSubCalls < 1) {
      throw new Error('maxParallelSubCalls must be a positive integer')
    }
    this.pipeline = new ToolExecutionPipeline(ctx, {
      get: (name, scope) => this.get(name, scope),
      reject: (name, nested) => !nested && name !== RUN_CODE_NAME
        ? new ToolNotFoundError(name, `only \`${RUN_CODE_NAME}\` is callable directly — call \`${name}\` from inside a \`${RUN_CODE_NAME}\` program instead`)
        : undefined,
    })
  }

  describe(_tools: readonly ToolDefinition[]): ToolModelInput {
    return { schemas: [projectToolSchema(this.requirePtcTransport(), false)], knownNames: [RUN_CODE_NAME] }
  }

  private renderSdk(tools: readonly ToolDefinition[]): string {
    const runtime = requirePtcRuntime(this.ctx)
    const render = SDK_RENDERERS[runtime.language]
    return render(tools.map(definition => ({
      ...projectToolSchema(definition, false),
      output: definition.output.schema,
    })), runtime.programFormat)
  }

  private get(name: string, scope?: ScopeKey): ToolDefinition | undefined {
    return name === RUN_CODE_NAME ? this.requirePtcTransport() : this.ctx.tools.get(name, scope)
  }

  execute(input: ToolBatchInput): Promise<ToolBatchResult> {
    return executeToolBatch(input, this.pipeline, this.maxParallel)
  }

  /** Keep the reserved transport outside registered capabilities and their restrictions. */
  private requirePtcTransport(): ToolDefinition {
    this.ptcTransport ??= createRunCodeTool(this.ctx, this.pipeline, this.maxParallelSubCalls)
    return this.ptcTransport
  }
}

export { CodeRunFailedError } from './errors.ts'
export type { PtcDispatchLog } from './types.ts'
export type { PtcDispatchStartEventData, PtcDispatchEventData } from './session-types.ts'
export { jsonSchemaToTs, renderToolsSdk, type ToolSdkSchema } from './ts-types.ts'
export { jsonSchemaToPy, renderToolsSdkPy } from './py-types.ts'

/** Cordis plugin name. */
export const name = 'ptc-tool-executor'
/** The program provider activates with its runtime. */
export const inject = ['tools', 'systemPrompt', 'ptcRuntime']

/** Program execution limits. */
export interface Config {
  /** Maximum overlapping concurrency-safe calls in one model batch. */
  maxParallelToolCalls: Volatile<number>
  /** Maximum overlapping concurrency-safe program subcalls. */
  maxParallelSubCalls?: number
}

/** Validated program execution configuration. */
export const Config: z<{ maxParallelToolCalls?: number; maxParallelSubCalls?: number }, Config> = z.object({
  maxParallelToolCalls: z.number().step(1).min(1).default(10).volatile(),
  maxParallelSubCalls: z.natural().min(1).default(10),
})

/**
 * Select PTC execution in the mounting scope.
 * @param ctx - context owning this executor's selection and lifetime.
 * @param config - program subcall concurrency limits.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.setExecutor(new PtcExecutor(ctx, config, () => config.maxParallelToolCalls.get()))
}

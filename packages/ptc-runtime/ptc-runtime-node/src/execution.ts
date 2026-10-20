/** Resolve evaluation syntax and process lifetime once for the Node provider. */
import { stripTypeScriptTypes } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import type { PtcRunRequest, PtcRunResult, PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { ResolvedConfig } from './config.ts'
import type { ProgramFormat } from './evaluators/types.ts'
import { PerCallExecution } from './per-call.ts'
import { InMemoryExecution } from './persistent.ts'
import type { PolicyProcesses } from './policy-processes.ts'

/** Syntax, state retention and model guidance selected during provider construction. */
export interface ExecutionMode {
  /** Child evaluator selected independently of process lifetime. */
  readonly format: ProgramFormat
  /** Whether caller-owned objects retain processes between runs. */
  readonly retainsState: boolean
  /** Model-facing syntax, output and recovery rules. */
  readonly executionInstructions: string
  /**
   * Erase TypeScript in the selected syntax without executing the program.
   * @param program - Model-written TypeScript source.
   * @returns JavaScript accepted by the selected evaluator.
   */
  stripTypes(program: string): string
}

/** A resolved run carrying provider cancellation as well as caller cancellation. */
export type AdmittedRun = PtcRunSpec & { signal: AbortSignal }

/** Process ownership shared by one-shot and retained execution. */
export interface ExecutionRunner {
  /**
   * Resolve policy, directory and elapsed budget.
   * @param request - Program and optional execution settings.
   * @returns Complete inputs for run.
   */
  resolve(request: PtcRunRequest): PtcRunSpec
  /**
   * Execute an admitted call under the selected process lifetime.
   * @param spec - Resolved inputs with combined cancellation.
   * @param controller - Provider-owned cancellation, also used for one-shot deadlines.
   * @returns Captured output or a structured execution failure after required cleanup.
   */
  run(spec: AdmittedRun, controller: AbortController): Promise<PtcRunResult>
  /**
   * Release resources retained for a caller-owned object.
   * @param owner - Exact object supplied to run.
   * @returns Completion after owned processes stop; immediate for one-shot execution.
   */
  release(owner: object): Promise<void>
}

const STRIP_PREFIX = 'async function __dsh_program__() {\n'
const STRIP_SUFFIX = '\n}'
const RETAINED_STATE_INSTRUCTIONS = 'Changing the session sandbox mode clears retained variables. An approved sandbox escalation runs in a separate temporary environment: it cannot access retained variables, and its declarations are discarded afterward. Restart, Agent disposal, cancellation, timeout, output overflow, or process failure clears the environment. If a variable is undefined, recreate it and reacquire its resources. State is not restored from the conversation, and failed evaluations can leave earlier mutations in memory. Redeclaring an existing let, const, or class name fails; assign to a mutable binding or use a new name. Await all tool calls; background callbacks cannot call tools after their evaluation ends. Await child-process completion before ending an evaluation; raw subprocess output belongs to whichever evaluation is active when it arrives.'

/**
 * Select the configured evaluator and its process owner.
 * @param ctx - Provider lifecycle and execution services.
 * @param config - Validated configuration with loader defaults.
 * @param processes - Policy invalidation and process cleanup coordination.
 * @returns Immutable mode selection and the corresponding execution runner.
 */
export function createExecution(
  ctx: Context, config: ResolvedConfig, processes: PolicyProcesses,
): { mode: ExecutionMode; runner: ExecutionRunner } {
  const mode = resolveMode(config)
  const runner = mode.retainsState
    ? new InMemoryExecution(ctx, config, processes, mode)
    : new PerCallExecution(ctx, config, processes, mode)
  return { mode, runner }
}

function resolveMode(config: ResolvedConfig): ExecutionMode {
  switch (config.executionMode) {
    case 'per-call': return {
      format: 'function-body',
      retainsState: false,
      executionInstructions: 'The program is the body of an async TypeScript function; only erasable syntax is accepted, with no enum or namespaces. Type annotations are advisory. Top-level await and return are supported. Emit output with console.log(...) or return a lossless JSON value. Only printed values and the returned value become program output. Each call runs in a fresh Node process. Node APIs are available through await import(...). Relative paths use the supplied working directory; process.env starts empty. Direct filesystem access follows this execution\'s sandbox policy.',
      stripTypes(program) {
        const stripped = stripTypeScriptTypes(STRIP_PREFIX + program + STRIP_SUFFIX)
        return stripped.slice(STRIP_PREFIX.length, stripped.length - STRIP_SUFFIX.length)
      },
    }
    case 'persistent-in-memory': return {
      format: 'repl',
      retainsState: true,
      executionInstructions: 'The program contains TypeScript REPL statements; only erasable syntax is accepted, with no enum or namespaces. Type annotations are advisory. Top-level declarations and await are supported; top-level return is not supported. Emit output with console.log(...) or a final lossless JSON expression. Only printed values and that final expression become program output. Variables, functions, and imported modules remain in memory for this Agent across calls. Use await import(...) for modules. Direct filesystem access follows this execution\'s sandbox policy; process.env starts empty. ' + RETAINED_STATE_INSTRUCTIONS,
      stripTypes: stripTypeScriptTypes,
    }
    case 'vm-script': {
      const lifetime = config.scriptPersistence
        ? 'Variables, functions, and imported modules remain in memory for this Agent across calls.'
        : 'Each call runs in a fresh Node process.'
      const recovery = config.scriptPersistence ? ' ' + RETAINED_STATE_INSTRUCTIONS : ''
      return {
        format: 'script',
        retainsState: config.scriptPersistence,
        executionInstructions: 'The program contains TypeScript script statements; only erasable syntax is accepted, with no enum or namespaces. Type annotations are advisory. Top-level declarations and await are supported; top-level return is not supported. Emit output with console.log(...) or a final lossless JSON expression. The final expression is awaited if it is a Promise. Only printed values and that final expression become program output. ' + lifetime + ' Use await import(...) for modules. Relative paths use the supplied working directory. Direct filesystem access follows this execution\'s sandbox policy; process.env starts empty.' + recovery,
        stripTypes: stripTypeScriptTypes,
      }
    }
    default: return assertNever(config.executionMode)
  }
}

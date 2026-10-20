/** Select one child evaluator without process-lifetime policy. */
import { createAsyncFunctionEvaluator } from './async-function.ts'
import { createReplEvaluator } from './repl.ts'
import { createVmScriptEvaluator } from './vm-script.ts'
import type { ProgramEvaluator, ProgramFormat } from './types.ts'

const evaluators: Record<ProgramFormat, (reportError: (message: string) => void) => ProgramEvaluator> = {
  'function-body': createAsyncFunctionEvaluator,
  repl: createReplEvaluator,
  script: createVmScriptEvaluator,
}

/**
 * Create the selected evaluator for either a fresh or retained process.
 * @param format - Evaluation syntax selected by the host.
 * @param reportError - Asynchronous diagnostics attributed to the active evaluation.
 * @returns Globals, evaluation entry point, and resource cleanup.
 */
export function createProgramEvaluator(format: ProgramFormat, reportError: (message: string) => void): ProgramEvaluator {
  return evaluators[format](reportError)
}

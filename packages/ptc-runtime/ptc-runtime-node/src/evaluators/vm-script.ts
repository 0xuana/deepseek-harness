/** VM Script evaluation with Node globals and retained Script-scope declarations. */
import { resolve } from 'node:path'
import { types } from 'node:util'
import { constants, createContext, Script, type Context, type ScriptOptions } from 'node:vm'
import { processTopLevelAwait } from './vm-script-await.ts'
import type { ProgramEvaluator } from './types.ts'

/**
 * Create a VM context supporting Script completion values and top-level await.
 * @returns Retained globals, asynchronous evaluation and resource cleanup.
 */
export function createVmScriptEvaluator(): ProgramEvaluator {
  const context = createScriptContext()
  return {
    globals: context,
    evaluate(code, finish) {
      void evaluateScript(code, context).then(
        (value) => { finish({ ok: true, value }) },
        (error: unknown) => { finish({ ok: false, error }) },
      )
    },
    close() {},
  }
}

/**
 * Create an independent program context with Node globals.
 * @returns A context reusable for sequential evaluations.
 */
function createScriptContext(): Context {
  const globals = Object.create(null) as Record<string, unknown>
  const context = createContext(globals)
  const realm = new Script('globalThis').runInContext(context) as Record<string, unknown>
  for (const key of Reflect.ownKeys(globalThis)) {
    if (key === 'global' || Object.hasOwn(realm, key)) continue
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    if (descriptor) Object.defineProperty(globals, key, descriptor)
  }
  globals.global = realm
  return context
}

/**
 * Evaluate a script, lowering top-level await while retaining Script-scope declarations.
 * @param code - Type-stripped JavaScript; top-level return is not supported.
 * @param context - Program globals and declarations retained between evaluations.
 * @returns The script completion value after Promise settlement.
 */
async function evaluateScript(code: string, context: Context): Promise<unknown> {
  try {
    const options: ScriptOptions = {
      filename: resolve(process.cwd(), 'ptc-program.js'),
      importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    }
    const compiled = compileScript(code, options)
    const value: unknown = await compiled.script.runInContext(context)
    // Node's transform boxes the last expression; the PTC caller also awaits that expression.
    return compiled.transformed ? await (value as { value: unknown } | undefined)?.value : value
  } catch (error: unknown) {
    if (!types.isNativeError(error)) throw error
    // Script errors belong to another realm; preserve their diagnostics for the bootstrap.
    let detail: string
    try { detail = error.stack ?? error.message } catch { detail = 'program threw an unrenderable value' }
    const failure = new Error(detail)
    failure.stack = detail
    throw failure
  }
}

/** Native scripts bypass conversion; only compilation failures enter the await transformer. */
function compileScript(code: string, options: ScriptOptions): { script: Script; transformed: boolean } {
  try {
    return { script: new Script(code, options), transformed: false }
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    // Complete submissions need no REPL continuation; the newline terminates trailing comments.
    const source = code.startsWith('#!') ? `//${code.slice(2)}` : code
    const transformed = processTopLevelAwait(`${source}\n`)
    if (transformed === null) throw error
    return { script: new Script(transformed, options), transformed: true }
  }
}

/** Typed methods shared by the host and its co-shipped Node execution process. */
import type { PtcJsonWire } from './json-wire.ts'

/** Inputs for one program; host functions remain in the parent process. */
export interface ProgramBootData {
  /** Type-stripped JavaScript source. */
  code: string
  /** Globals and callable names injected into the program. */
  namespaces: {
    global: string
    names: string[]
    errorClass?: { name: string; memberNameProperty: string }
  }[]
  /** Combined serialized log and completion budget. */
  maxOutputBytes: number
}

/** Program completion; logs are delivered separately before this result. */
export interface ProgramResult {
  value?: PtcJsonWire
  error?: { kind: 'exception' | 'invalid-output' | 'output-limit'; message: string }
}

/** Host operations for the current evaluation; one pipe delivers its messages before its result. */
export interface HostMethods {
  /** Announce that the process can accept its first evaluation. */
  ready(): void
  /**
   * Invoke a binding under its originating host execution context.
   * @param global - Namespace global.
   * @param name - Function name within the namespace.
   * @param args - Flat lossless JSON arguments.
   * @returns Flat lossless JSON result; binding failures reject the call.
   */
  invoke(global: string, name: string, args: PtcJsonWire): Promise<PtcJsonWire>
  /**
   * Admit captured output before completion or interruption.
   * @param text - Captured text.
   */
  log(text: string): void
  /** Report exhausted program-side output accounting. */
  outputLimit(): void
}

/** Operations implemented by either the per-call child or retained REPL. */
export interface ProgramMethods {
  /**
   * Evaluate code with the supplied binding declarations and output budget.
   * @param cwd - Execution-world working directory.
   * @param data - Program and injected declarations.
   * @returns Completion or a bounded program failure, after captured output is sent.
   */
  run(cwd: string, data: ProgramBootData): Promise<ProgramResult>
}

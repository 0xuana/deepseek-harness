/** One-shot process execution; evaluation syntax is supplied by the mode selector. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PtcBindingNamespace, PtcJsonValue, PtcRunFailure, PtcRunRequest, PtcRunResult, PtcRunSandbox, PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import { clampTimeout } from '@deepseek-ai/dsh-timeout'
import { SandboxUnavailableError, classifyRunnerFailure, isRunnerSpawnFailure } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { replyToBinding, validateBindings } from './bindings.ts'
import { JsonChannel } from './channel.ts'
import type { ResolvedConfig } from './config.ts'
import type { AdmittedRun, ExecutionMode, ExecutionRunner } from './execution.ts'
import { bootstrapArgs } from './launch.ts'
import type { PolicyProcesses } from './policy-processes.ts'
import { OutputLedger } from './output-ledger.ts'
import { terminateProcess } from './output-stream.ts'
import { STARTUP_ENVIRONMENT_NAMES } from './environment.ts'
import { decodePtcJsonWire } from './json-wire.ts'
import type { ProgramBootData } from './protocol.ts'

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

/** One managed process per call, released before its result is returned. */
export class PerCallExecution implements ExecutionRunner {
  /**
   * Bind execution services and the resolved evaluation mode.
   * @param ctx - Provider execution services.
   * @param config - Validated resource limits and selected executable.
   * @param processes - Provider-owned policy invalidation and cleanup.
   * @param mode - Program syntax and TypeScript erasure.
   */
  constructor(
    private readonly ctx: Context, private readonly config: ResolvedConfig,
    private readonly processes: PolicyProcesses, private readonly mode: ExecutionMode,
  ) {}

  resolve(request: PtcRunRequest): PtcRunSpec {
    const sandboxPolicy = request.sandboxPolicy ?? this.ctx.sandboxPolicy.resolve()
    const cwd = request.cwd ?? sandboxPolicy.workspaceRoot
    if (!isAbsolute(cwd)) throw new Error('ptc-runtime-node: cwd must be absolute')
    return {
      ...request,
      cwd,
      timeoutMs: request.timeoutMs === null ? null : clampTimeout(request.timeoutMs, this.config.timeoutMs, this.config.maxTimeoutMs, 'ptc-runtime-node: timeoutMs'),
      sandboxPolicy,
    }
  }

  async run(spec: AdmittedRun, controller: AbortController): Promise<PtcRunResult> {
    if (spec.sandboxPolicy === undefined) throw new Error('ptc-runtime-node: run requires a resolved sandbox policy')
    if (!isAbsolute(spec.cwd) || (spec.timeoutMs !== null && (!Number.isFinite(spec.timeoutMs) || spec.timeoutMs <= 0 || spec.timeoutMs > this.config.maxTimeoutMs))) throw new Error('ptc-runtime-node: run requires resolved cwd and timeout')
    const bindings = validateBindings(spec)
    return await this.execute(spec, spec.sandboxPolicy, bindings, controller)
  }

  async release(): Promise<void> {}

  private async execute(
    spec: AdmittedRun,
    policy: SandboxExecutionPolicy,
    bindings: Map<string, PtcBindingNamespace>,
    controller: AbortController,
  ): Promise<PtcRunResult> {
    const replyBinding = AsyncLocalStorage.bind(replyToBinding)
    const output = new OutputLedger(this.config.maxOutputBytes)
    const logs: string[] = []
    const sandbox: PtcRunSandbox = { mode: policy.mode, denied: false }
    const result = Promise.withResolvers<PtcRunResult>()
    const signal = spec.signal
    let handle: SubprocessHandle | undefined
    let channel: JsonChannel | undefined
    let confined: ConfinedArgv | undefined
    let settled = false
    let timedOut = false
    let outputOverflow = false
    let overflowResult: PtcRunResult | undefined
    let stderr = ''
    let parsing = true
    const wallTimer = spec.timeoutMs === null ? undefined
      : setTimeout(() => { timedOut = true; controller.abort('execution deadline reached') }, spec.timeoutMs)
    let stopping: Promise<boolean> | undefined
    const stop = (): Promise<boolean> => {
      if (stopping !== undefined) return stopping
      const cleanup = handle === undefined ? Promise.resolve(true) : terminateProcess(handle, this.config.graceMs)
      stopping = cleanup.then((drained) => { unregister(); return drained }, (error: unknown) => {
        stopping = undefined
        throw error
      })
      return stopping
    }
    const finish = (failure?: PtcRunFailure, value?: PtcJsonValue): void => {
      if (settled) return
      settled = true
      clearTimeout(wallTimer)
      signal.removeEventListener('abort', onAbort)
      channel?.close()
      void (async () => {
        try {
          const drained = await stop()
          if (!drained && failure === undefined) {
            failure = { kind: 'worker-exit', message: 'Node process output did not close cleanly' }
          }
        } catch (error: unknown) {
          failure = { kind: 'worker-exit', message: `managed process cleanup failed: ${messageOf(error)}` }
        }
        const outcome = outputOverflow ? overflowResult ?? output.limit(logs)
          : failure === undefined ? output.success(logs, value) : output.failure(logs, failure)
        result.resolve({ ...outcome, sandbox: { ...sandbox } })
      })()
    }
    const onAbort = (): void => {
      finish(timedOut
        ? { kind: 'timeout', message: `execution deadline reached (${spec.timeoutMs}ms)` }
        : { kind: 'abort', message: messageOf(signal.reason) })
    }
    const unregister = this.processes.register(policy, async () => {
      controller.abort(new Error('sandbox mode changed'))
      await stop()
    })
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    try {
      // Abort callbacks can settle execution before or during an awaited operation.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      if (settled) return await result.promise
      const code = this.mode.stripTypes(spec.program)
      parsing = false
      const data: ProgramBootData = {
        code,
        programFormat: this.mode.format,
        namespaces: [...bindings.values()].map(binding => ({
          global: binding.global,
          names: Object.keys(binding.functions),
          ...binding.errorClass ? { errorClass: binding.errorClass } : {},
        })),
        maxOutputBytes: this.config.maxOutputBytes,
      }
      const executable = await this.ctx.subprocess.resolveExecutable(this.config.launch.executable, undefined, signal)
      // Abort callbacks can settle execution before or during an awaited operation.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      if (settled) return await result.promise
      const packaged = this.config.launch.kind === 'embedded'
      const heapFlag = `--max-old-space-size=${this.config.maxOldGenerationSizeMb}`
      const argv = [executable, ...packaged ? [] : [heapFlag],
        ...bootstrapArgs(this.ctx.fs, this.config.launch, this.config.maxMessageBytes)]
      confined = policy.mode === 'danger-full-access' ? undefined : await this.ctx.sandbox.confine(argv, { ...policy, mode: policy.mode }, signal)
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Cancellation can settle during awaited confinement.
      if (settled) return await result.promise
      if (confined !== undefined) sandbox.enforcement = confined.enforcement
      // Electron needs its Node-mode selector until bootstrap; the child then removes it with other ambient values.
      const env: NodeJS.ProcessEnv = Object.fromEntries(Object.keys(process.env)
        .filter(key => !STARTUP_ENVIRONMENT_NAMES.has(key.toUpperCase()) && key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE')
        .map(key => [key, undefined]))
      if (packaged) {
        env.DSH_PTC_RUNTIME_NODE = '1'
        env.NODE_OPTIONS = heapFlag
      }
      handle = this.ctx.subprocess.spawn({ argv: confined?.argv ?? argv, cwd: spec.cwd, env, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', control: 'pipe' }, graceMs: this.config.graceMs, signal })
      const launched = handle
      if (launched.control === undefined || launched.stdout === undefined || launched.stderr === undefined) {
        throw new Error('subprocess provider did not supply the requested control and output pipes')
      }
      const admit = (text: string): void => {
        if (outputOverflow) return
        if (!output.admit(text, logs)) {
          outputOverflow = true
          overflowResult = output.limit([...logs, text])
          finish({ kind: 'output-limit', message: `outer output exceeded ${this.config.maxOutputBytes} bytes` })
        }
      }
      const stdoutDecoder = new TextDecoder('utf-8', { ignoreBOM: true })
      const stderrDecoder = new TextDecoder('utf-8', { ignoreBOM: true })
      handle.stdout?.on('data', (chunk: Buffer) => {
        const text = stdoutDecoder.decode(chunk, { stream: true })
        if (text.length > 0) admit(text)
      })
      handle.stdout?.on('end', () => {
        const text = stdoutDecoder.decode()
        if (text.length > 0) admit(text)
      })
      handle.stdout?.on('error', (error: Error) => { finish({ kind: 'worker-exit', message: messageOf(error) }) })
      handle.stderr?.on('data', (chunk: Buffer) => {
        const text = stderrDecoder.decode(chunk, { stream: true })
        stderr = (stderr + text).slice(-this.config.maxOutputBytes)
        if (text.length > 0) admit(text)
      })
      handle.stderr?.on('end', () => {
        const text = stderrDecoder.decode()
        if (text.length > 0) admit(text)
      })
      handle.stderr?.on('error', (error: Error) => { finish({ kind: 'worker-exit', message: messageOf(error) }) })
      let ready = false
      let nextId = 1
      let pending = 0
      let pendingBytes = 0
      const protocolFailure = (message: string): void => { finish({ kind: 'protocol', message }) }
      const processFinished = (outcome: SubprocessOutcome): void => {
        if (settled) return
        finish((confined !== undefined && classifyRunnerFailure(outcome.exitCode, stderr, confined.runnerFailureRules) !== undefined)
          ? { kind: 'sandbox-unavailable', message: stderr }
          : { kind: 'worker-exit', message: `Node process exited before completing (${String(outcome.exitCode)})${stderr ? `: ${stderr}` : ''}` })
      }
      const transport: JsonChannel = new JsonChannel(launched.control, this.config.maxMessageBytes, (raw, bytes) => {
        if (!record(raw)) { protocolFailure('invalid control frame'); return }
        if (!ready) {
          if (raw.type !== 'ready') { protocolFailure('program frame arrived before bootstrap readiness'); return }
          ready = true
          void transport.send({ type: 'boot', data }).catch((error: unknown) => { protocolFailure(messageOf(error)) })
          return
        }
        switch (raw.type) {
          case 'log':
            if (typeof raw.text !== 'string') { protocolFailure('invalid log frame'); return }
            admit(raw.text)
            return
          case 'output-limit': outputOverflow = true; finish(); return
          case 'done': {
            if (raw.error !== undefined) {
              if (!record(raw.error) || typeof raw.error.message !== 'string' || (raw.error.kind !== 'exception' && raw.error.kind !== 'invalid-output' && raw.error.kind !== 'output-limit')) { protocolFailure('invalid terminal error'); return }
              const failure = { kind: raw.error.kind, message: raw.error.message } as PtcRunFailure
              if (confined !== undefined) {
                sandbox.denied = confined.denialSignatures.some(signature =>
                  failure.message.toLowerCase().includes(signature.toLowerCase()))
              }
              if (failure.kind === 'output-limit') outputOverflow = true
              finish(failure)
              return
            }
            const value = raw.value === undefined ? undefined : decodePtcJsonWire(raw.value)
            if (raw.value !== undefined && value === undefined) finish({ kind: 'invalid-output', message: 'program completion must be lossless JSON' })
            else finish(undefined, value)
            return
          }
          case 'call': {
            if (!Number.isSafeInteger(raw.id) || raw.id !== nextId || typeof raw.global !== 'string' || typeof raw.name !== 'string') { protocolFailure('invalid binding call identity'); return }
            nextId += 1
            const functions = bindings.get(raw.global)?.functions
            const fn = functions !== undefined && Object.hasOwn(functions, raw.name) ? functions[raw.name] : undefined
            if (typeof fn !== 'function') { protocolFailure('program requested an undeclared binding'); return }
            const args = decodePtcJsonWire(raw.args)
            if (args === undefined) { protocolFailure('binding arguments must be lossless JSON'); return }
            if (++pending > this.config.maxPendingCalls || (pendingBytes += bytes) > this.config.maxMessageBytes) { protocolFailure('pending binding calls exceed configured limits'); return }
            const id = raw.id
            void (async () => {
              const reply = await replyBinding(id, fn, args).finally(() => {
                pending -= 1
                pendingBytes -= bytes
              })
              if (!settled) await transport.send(reply)
            })().catch((error: unknown) => { protocolFailure(messageOf(error)) })
            return
          }
          default: protocolFailure('unknown control message')
        }
      }, (error, kind) => {
        if (kind === 'protocol') protocolFailure(messageOf(error))
        else if (ready) finish({ kind: 'worker-exit', message: messageOf(error) })
        else void launched.done.then(processFinished, (failure: unknown) => { finish({ kind: 'worker-exit', message: messageOf(failure) }) })
      })
      channel = transport
      void launched.done.then((outcome) => {
        // Allow queued control-frame callbacks to run before classifying a command exit.
        setImmediate(() => { processFinished(outcome) })
      }, (error: unknown) => { finish({ kind: confined !== undefined && isRunnerSpawnFailure(error, confined.argv[0], spec.cwd) ? 'sandbox-unavailable' : 'worker-exit', message: messageOf(error) }) })
    } catch (error: unknown) {
      finish({ kind: error instanceof SandboxUnavailableError ? 'sandbox-unavailable' : parsing ? 'exception' : 'worker-exit', message: messageOf(error) })
    }
    return await result.promise
  }
}

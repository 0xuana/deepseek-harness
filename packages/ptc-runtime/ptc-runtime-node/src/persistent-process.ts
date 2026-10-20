/** Retained Node evaluations with per-evaluation bindings and output attribution. */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Duplex } from 'node:stream'
import { JsonChannel } from './channel.ts'
import { captureStreamWrites, LogBuffer, makeConsoleShim, makeBindingErrorClass, makeNamespaces, prepareCompletion, prepareException, wireReplies } from './bootstrap.ts'
import type { BindingErrorConstructor, PendingCall, PatchableStream } from './bootstrap.ts'
import type { DoneMessage, ProgramBootData, ProgramToHost, ReplyMessage } from './protocol.ts'
import { clearProgramEnvironment } from './environment.ts'
import { createProgramEvaluator } from './evaluators/index.ts'
import type { ProgramFormat } from './evaluators/types.ts'

/** Process state owned by the retained child; tests supply instance-local streams and environment. */
export interface PersistentProcess {
  env: NodeJS.ProcessEnv
  stdout: PatchableStream
  stderr: PatchableStream
  chdir(directory: string): void
}

interface Evaluation {
  id: number
  logs: LogBuffer
  maxOutputBytes: number
  active: boolean
  finish(result: Omit<DoneMessage, 'type'>): void
}

/**
 * Serve sequential evaluations until the owning host closes the control channel.
 * @param stream - Inherited private control endpoint.
 * @param maxMessageBytes - Maximum control frame and queued output bytes.
 * @param processState - Child environment, output and directory control, bound only in the program context.
 * @param format - Retained evaluation syntax; existing callers select REPL by default.
 * @returns After the channel closes and the evaluator releases its resources.
 */
export async function runPersistentMain(stream: Duplex, maxMessageBytes: number, processState: PersistentProcess, format: ProgramFormat = 'repl'): Promise<void> {
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes <= 0 || maxMessageBytes > 0xffff_ffff) throw new Error('invalid control message limit')
  clearProgramEnvironment(processState)
  const context = new AsyncLocalStorage<Evaluation>()
  const closed = Promise.withResolvers<void>()
  const pending = new Map<number, PendingCall>()
  const nextId = { value: 1 }
  const errors = new Map<string, { name: string; memberNameProperty: string; constructor: BindingErrorConstructor }>()
  const errorLookup = { get: (name: string) => errors.get(name)?.constructor }
  const replies: Array<(message: ReplyMessage) => void> = []
  const evaluator = createProgramEvaluator(format, (message) => {
    const current = context.getStore()
    if (current?.active && message) current.finish(prepareException(message, current.logs.remainingOutputBytes(), current.maxOutputBytes))
  })
  let current: Evaluation | undefined
  const send = (id: number, payload: ProgramToHost): void => {
    void channel.send({ id, payload }).catch(() => { channel.close(); closed.resolve() })
  }
  const port = {
    postMessage(payload: ProgramToHost): void {
      const evaluation = context.getStore()
      if (!evaluation?.active) throw new Error('PTC evaluation has ended; call this function from a new run_code evaluation')
      send(evaluation.id, payload)
    },
    on(_event: 'message', listener: (message: ReplyMessage) => void): void { replies.push(listener) },
  }
  wireReplies(port, pending)
  const logSink = { push(text: string): void { const evaluation = context.getStore(); if (evaluation?.active) evaluation.logs.push(text) } }
  evaluator.globals.console = makeConsoleShim(logSink)
  Object.defineProperty(evaluator.globals, 'process', { configurable: true, enumerable: true, writable: true, value: processState })
  captureStreamWrites(logSink, processState.stdout)
  captureStreamWrites(logSink, processState.stderr)
  const channel = new JsonChannel(stream, maxMessageBytes, (raw) => {
    // The host owns these frames. Model-written traffic is validated on the host.
    const message = raw as { type: 'run'; id: number; cwd: string; data: ProgramBootData } | ReplyMessage
    if (message.type === 'reply') {
      for (const listener of replies) listener(message)
      return
    }
    if (current?.active) { channel.close(); closed.resolve(); return }
    const { id, data } = message
    const logs = new LogBuffer(data.maxOutputBytes, (text) => { send(id, { type: 'log', text }) }, () => { send(id, { type: 'output-limit' }) })
    const evaluation: Evaluation = {
      id, logs, maxOutputBytes: data.maxOutputBytes, active: true,
      finish(result) {
        if (!evaluation.active) return
        evaluation.active = false
        for (const call of pending.values()) call.reject(new Error('PTC evaluation ended before the binding completed'))
        pending.clear()
        send(id, { type: 'done', ...result })
      },
    }
    current = evaluation
    context.run(evaluation, () => {
      try {
        processState.chdir(message.cwd)
        for (const namespace of data.namespaces) {
          const descriptor = namespace.errorClass
          if (!descriptor) { errors.delete(namespace.global); continue }
          const previous = errors.get(namespace.global)
          if (previous?.name === descriptor.name && previous.memberNameProperty === descriptor.memberNameProperty) continue
          const constructor = makeBindingErrorClass(descriptor)
          errors.set(namespace.global, { name: descriptor.name, memberNameProperty: descriptor.memberNameProperty, constructor })
        }
        const namespaces = makeNamespaces(data, port, pending, nextId, errorLookup)
        for (const [index, namespace] of data.namespaces.entries()) {
          Object.defineProperty(evaluator.globals, namespace.global, { configurable: true, value: namespaces[index] })
          if (namespace.errorClass) {
            Object.defineProperty(evaluator.globals, namespace.errorClass.name, {
              configurable: true, value: errorLookup.get(namespace.global),
            })
          }
        }
        evaluator.evaluate(data.code, (result) => {
          evaluation.finish(result.ok ? prepareCompletion(result.value, logs.remainingOutputBytes(), data.maxOutputBytes)
            : prepareException(result.error, logs.remainingOutputBytes(), data.maxOutputBytes))
        })
      } catch (error: unknown) {
        evaluation.finish(prepareException(error, logs.remainingOutputBytes(), data.maxOutputBytes))
      }
    })
  }, () => { channel.close(); closed.resolve() })
  stream.once('close', () => { closed.resolve() })
  try {
    await channel.send({ type: 'ready' })
    await closed.promise
  } finally {
    if (current) current.active = false
    evaluator.close()
    channel.close()
    context.disable()
  }
}

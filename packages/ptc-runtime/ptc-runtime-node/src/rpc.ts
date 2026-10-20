/** birpc over newline-delimited JSON on the bounded private process channel. */
import { Buffer } from 'node:buffer'
import type { Duplex } from 'node:stream'
import { createBirpc, type BirpcReturn } from 'birpc'

const stringify = JSON.stringify
const parse = JSON.parse

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const toError = (value: unknown): Error => value instanceof Error ? value : new Error(String(value))

/**
 * Connect typed methods over one control endpoint; execution owns all deadlines.
 * @param stream - Owned control endpoint; `$close()` destroys it and rejects outstanding remote calls.
 * @param maxMessageBytes - Maximum incoming JSON line and queued outgoing bytes.
 * @param functions - Only these own methods may be called by the peer.
 * @param eventNames - Remote methods sent as notifications without a response.
 * @param failure - Receives the first I/O or malformed-message failure after it closes the endpoint.
 * @returns Typed remote calls and birpc lifetime controls.
 */
export function createProcessRpc<Remote extends object, Local extends object>(
  stream: Duplex,
  maxMessageBytes: number,
  functions: Local,
  eventNames: (keyof Remote)[],
  failure: (error: Error, kind: 'io' | 'protocol') => void,
): BirpcReturn<Remote, Local> {
  const fail = (error: unknown, kind: 'io' | 'protocol'): void => {
    if (rpc.$closed) return
    rpc.$close()
    failure(toError(error), kind)
  }
  let receive: ((line: string) => void) | undefined
  const rpc = createBirpc<Remote, Local>(functions, {
    timeout: -1,
    eventNames,
    on: (listener) => { receive = listener },
    off: () => { receive = undefined; stream.destroy() },
    // JSON drops Error fields; the peer receives only the diagnostic.
    serialize: (message: Record<string, unknown>) => `${stringify(message.e instanceof Error ? { ...message, e: { message: message.e.message } } : message)}\n`,
    post: (line: string) => {
      // A binding can settle after the endpoint closes; the Writable owns already queued bytes.
      if (rpc.$closed) return
      if (stream.writableLength + Buffer.byteLength(line) > maxMessageBytes) fail(new Error(`control output exceeds ${maxMessageBytes} queued bytes`), 'protocol')
      else stream.write(line)
    },
    deserialize: (line: string) => {
      const message: unknown = parse(line)
      if (!record(message)) throw new Error('invalid RPC frame')
      if (message.t === 'q') {
        if (typeof message.m !== 'string' || !Object.hasOwn(functions, message.m) || !Array.isArray(message.a)) throw new Error('invalid RPC method call')
      } else if (message.t !== 's') {
        throw new Error('unknown RPC message')
      } else if (message.e !== undefined) {
        if (!record(message.e) || typeof message.e.message !== 'string') throw new Error('invalid RPC error')
        return { ...message, e: new Error(message.e.message) }
      }
      return message
    },
    // Every line of a chunk dispatches before an earlier handler can close the endpoint.
    resolver: (_name, fn) => async (...args: unknown[]) => {
      if (rpc.$closed) return undefined
      // birpc treats a falsy thrown value as success.
      try { return await fn.apply(functions, args) } catch (error: unknown) { throw toError(error) }
    },
  })
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let parts: Buffer[] = []
  let size = 0
  const buffer = (part: Buffer): void => {
    size += part.length
    if (size > maxMessageBytes) throw new Error(`RPC message exceeds ${maxMessageBytes} bytes`)
    parts.push(part)
  }
  stream.on('data', (chunk: Buffer) => {
    try {
      let start = 0
      for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
        buffer(chunk.subarray(start, end))
        const line = decoder.decode(Buffer.concat(parts, size))
        parts = []
        size = 0
        start = end + 1
        void Promise.resolve(receive?.(line)).catch((error: unknown) => { fail(error, 'protocol') })
      }
      buffer(chunk.subarray(start))
    } catch (error: unknown) { fail(error, 'protocol') }
  })
  stream.on('end', () => {
    if (size === 0) fail(new Error('control channel ended before the program settled'), 'io')
    else fail(new Error('incomplete RPC message'), 'protocol')
  })
  stream.on('error', (error: Error) => { fail(error, 'io') })
  stream.on('close', () => { fail(new Error('control channel closed'), 'io') })
  return rpc
}

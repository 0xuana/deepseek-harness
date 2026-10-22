/**
 * `node:buffer` for the worker, backed by the `buffer` npm package (feross), and
 * the matching `globalThis.Buffer` install. Node code treats Buffer as ambient,
 * so the global must exist before any host module evaluates.
 *
 * Whole-buffer UTF-8 conversions, `Buffer.from(string)` and `buf.toString()`,
 * use the browser's `TextEncoder` and `TextDecoder`: they apply Node's U+FFFD
 * replacement rules and run several times faster than the package's JavaScript
 * codec on multi-megabyte bundles and source maps. Other encodings and ranged
 * `toString` calls keep the package's implementation.
 */
import { Buffer, kMaxLength } from 'buffer'

const encoder = new TextEncoder()
// Node keeps a leading byte order mark in the decoded string.
const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
const UTF8 = /^utf-?8$/i
const packageFrom = Buffer.from.bind(Buffer)
const bufferPrototype = Buffer.prototype as Buffer
// oxlint-disable-next-line typescript/unbound-method -- Reflect.apply supplies the Buffer receiver.
const packageToString = bufferPrototype.toString

Buffer.from = function from(value: unknown, encodingOrOffset?: unknown, length?: unknown): Buffer {
  if (typeof value === 'string' && (encodingOrOffset === undefined || (typeof encodingOrOffset === 'string' && UTF8.test(encodingOrOffset)))) {
    const bytes = encoder.encode(value)
    return packageFrom(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  return Reflect.apply(packageFrom, Buffer, [value, encodingOrOffset, length]) as Buffer
} as typeof Buffer.from

bufferPrototype.toString = function toString(this: Buffer, encoding?: BufferEncoding, start?: number, end?: number): string {
  if (start === undefined && end === undefined && (encoding === undefined || UTF8.test(encoding))) {
    return decoder.decode(this)
  }
  return Reflect.apply(packageToString, this, [encoding, start, end])
}
// oxlint-disable-next-line typescript/unbound-method -- Installed as a Buffer method; callers supply the receiver.
Reflect.set(bufferPrototype, 'toLocaleString', bufferPrototype.toString)

Object.defineProperty(globalThis, 'Buffer', { value: Buffer, writable: true, configurable: true })

export { Buffer, kMaxLength }

/**
 * Size limits, as `node:buffer` publishes them. The npm package exposes only
 * `kMaxLength`, so the string bound is Node's own value for a 64-bit build.
 */
export const constants = {
  MAX_LENGTH: kMaxLength,
  MAX_STRING_LENGTH: 536_870_888,
}

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

/** The `node:buffer` declarations this module stands in for. */
type NodeFace = Partial<typeof import('node:buffer')>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { Buffer, constants, kMaxLength } satisfies NodeFace

/**
 * Differential check of the worker's `node:buffer` UTF-8 conversions against Node.
 */
import { Buffer as NodeBuffer } from 'node:buffer'
import { afterAll, expect, it } from 'vitest'

const ambient = globalThis.Buffer
const { Buffer: WorkerBuffer } = await import('@deepseek-ai/dsh-experimental-webworker-runtime/src/node/builtin_modules/implemented/buffer.ts')
afterAll(() => {
  Object.defineProperty(globalThis, 'Buffer', { value: ambient, writable: true, configurable: true })
})

const STRINGS = ['', 'a', '中文字符串', '\uFEFFbom', 'lone \uD800 high', 'lone \uDC00 low', '😀 pair', 'x'.repeat(100_000)]
const BYTES = [
  [0xEF, 0xBB, 0xBF, 0x61],
  [0xC3],
  [0xE4, 0xB8],
  [0xF0, 0x9F, 0x98],
  [0xED, 0xA0, 0x80],
  [0xC0, 0x80],
  [0xFF, 0xFE, 0x61],
  [0x61, 0xF4, 0x90, 0x80, 0x80, 0x62],
]
// Node matches encoding names case-insensitively; its type lists lower-case names only.
const UTF8_NAMES = [undefined, 'utf8', 'utf-8', 'UTF-8'].map(name => name as BufferEncoding | undefined)

it('encodes UTF-8 strings to the bytes Node produces', () => {
  for (const value of STRINGS) {
    for (const encoding of UTF8_NAMES) {
      expect(WorkerBuffer.isBuffer(WorkerBuffer.from(value, encoding))).toBe(true)
      expect([...WorkerBuffer.from(value, encoding)]).toEqual([...NodeBuffer.from(value, encoding)])
    }
  }
})

it('decodes UTF-8 bytes to the string Node produces', () => {
  for (const bytes of [...BYTES, ...STRINGS.map(value => [...NodeBuffer.from(value)])]) {
    const buffer = WorkerBuffer.from(bytes)
    for (const encoding of UTF8_NAMES) {
      expect(buffer.toString(encoding)).toBe(NodeBuffer.from(bytes).toString(encoding))
    }
    expect(buffer.toLocaleString()).toBe(NodeBuffer.from(bytes).toString())
  }
})

it('keeps the package conversions for other encodings and ranges', () => {
  expect([...WorkerBuffer.from('ÿa', 'latin1')]).toEqual([0xFF, 0x61])
  expect([...WorkerBuffer.from('ff61', 'hex')]).toEqual([0xFF, 0x61])
  expect(WorkerBuffer.from('中文').toString('hex')).toBe(NodeBuffer.from('中文').toString('hex'))
  expect(WorkerBuffer.from('a中b').toString('utf8', 1, 4)).toBe('中')
  const view = new Uint8Array([0x61, 0x62, 0x63]).buffer
  expect(WorkerBuffer.from(view, 1, 1).toString()).toBe('b')
})

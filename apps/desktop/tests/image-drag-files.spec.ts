import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { ImageDragFiles } from '../src/image-drag-files.ts'

async function files() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-drag-test-'))
  const store = new ImageDragFiles(root)
  onTestFinished(async () => { await store.dispose(); await rm(root, { recursive: true, force: true }) })
  return { root, store }
}

it('exports original bytes and keeps a used file readable until disposal', async () => {
  const { root, store } = await files()
  const bytes = new Uint8Array([137, 80, 78, 71])
  const handle = await store.prepare(bytes, '../../original.png', 'image/png')
  const path = store.take(handle)!
  expect(basename(path)).toBe('_.._original.png')
  expect(new Uint8Array(await readFile(path))).toEqual(bytes)
  await store.release(handle)
  expect(new Uint8Array(await readFile(path))).toEqual(bytes)
  await store.dispose()
  expect(await readdir(root)).toEqual([])
  expect(store.take(handle)).toBeUndefined()
})

it('rejects non-images, foreign handles and writes after disposal', async () => {
  const { store } = await files()
  await expect(store.prepare(new Uint8Array([1]), 'x.html', 'text/html')).rejects.toThrow('Invalid image transfer')
  await expect(store.prepare(new Uint8Array(), 'x.png', 'image/png')).rejects.toThrow('Invalid image transfer')
  await expect(store.prepare(new Uint8Array([1]), 'x.png', 'constructor')).rejects.toThrow('Invalid image transfer')
  expect(store.take('foreign')).toBeUndefined()
  await store.dispose()
  await expect(store.prepare(new Uint8Array([1]), 'x.png', 'image/png')).rejects.toThrow('Invalid image transfer')
})

it('releases unused preparations and waits for a concurrent write before cleanup', async () => {
  const { root, store } = await files()
  const handle = await store.prepare(new Uint8Array([1]), 'x.png', 'image/png')
  await store.release(handle)
  expect(await readdir(root)).toEqual([])
  const pending = store.prepare(new Uint8Array([2]), 'y.png', 'image/png')
  const rejected = expect(pending).rejects.toThrow('Image transfer closed')
  await store.dispose()
  await rejected
  expect(await readdir(root)).toEqual([])
})

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'

vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(), rm: vi.fn(),
}))
const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
const { ImageDragFiles } = await import('../src/image-drag-files.ts')
afterEach(() => { vi.mocked(rm).mockReset() })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-image-release-'))
  const store = new ImageDragFiles(root)
  vi.mocked(rm).mockImplementation(fs.rm)
  onTestFinished(async () => {
    vi.mocked(rm).mockImplementation(fs.rm)
    await store.dispose()
    await fs.rm(root, { recursive: true, force: true })
  })
  const handle = await store.prepare(new Uint8Array([1]), 'image.png', 'image/png')
  return { root, store, handle }
}

it('waits for an in-flight release before disposal completes', async () => {
  const { root, store, handle } = await fixture()
  const barrier = Promise.withResolvers<undefined>()
  vi.mocked(rm).mockImplementationOnce(async (path, options) => { await barrier.promise; await fs.rm(path, options) })
  const releasing = store.release(handle)
  const secondRelease = store.release(handle)
  expect(store.take(handle, false)).toBeUndefined()
  let stopped = false
  const disposing = store.dispose().then(() => { stopped = true })
  await Promise.resolve()
  expect(stopped).toBe(false)
  expect(await readdir(root)).toHaveLength(1)
  barrier.resolve(undefined)
  await Promise.all([releasing, secondRelease, disposing])
  expect(await readdir(root)).toEqual([])
})

it('retains a failed release for the shutdown cleanup to retry', async () => {
  const { root, store, handle } = await fixture()
  const path = store.take(handle, false)!
  vi.mocked(rm).mockRejectedValueOnce(new Error('file busy'))
  await expect(store.release(handle)).rejects.toThrow('file busy')
  expect(new Uint8Array(await readFile(path))).toEqual(new Uint8Array([1]))
  await store.dispose()
  expect(await readdir(root)).toEqual([])
})

it('waits for all removals before reporting a shutdown cleanup failure', async () => {
  const { store } = await fixture()
  await store.prepare(new Uint8Array([2]), 'second.png', 'image/png')
  const barrier = Promise.withResolvers<undefined>()
  vi.mocked(rm).mockRejectedValueOnce(new Error('file busy'))
    .mockImplementationOnce(async (path, options) => { await barrier.promise; await fs.rm(path, options) })
  let settled = false
  const disposing = store.dispose().finally(() => { settled = true })
  const rejected = expect(disposing).rejects.toThrow('file busy')
  await vi.waitFor(() => { expect(rm).toHaveBeenCalledTimes(2) })
  expect(settled).toBe(false)
  barrier.resolve(undefined)
  await rejected
  await store.dispose()
})

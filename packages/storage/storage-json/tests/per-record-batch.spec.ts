import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { JsonStorageBackend } from '../src/index.ts'

/** Rename hook installed by a case; returning true means the case handled the call. */
const gates = vi.hoisted(() => ({
  renameOverride: null as ((from: string, to: string) => Promise<boolean>) | null,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (
      from: Parameters<typeof actual.rename>[0],
      to: Parameters<typeof actual.rename>[1],
    ): Promise<void> => {
      const override = gates.renameOverride
      if (override !== null && await override(String(from), String(to))) return
      await actual.rename(from, to)
    },
  }
})

const DESCRIPTOR = { name: 'batch', version: 1, layout: 'per-record' as const, tables: ['t'], hasGlobal: false }

const roots: string[] = []
async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-per-record-batch-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  gates.renameOverride = null
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** A filesystem denial the batch must treat as an inability to restore. */
function denied(): NodeJS.ErrnoException {
  return Object.assign(new Error('denied'), { code: 'EACCES' })
}

it('waits for the whole batch before close releases the unit', async () => {
  const root = await freshRoot()
  const backend: JsonStorageBackend = new JsonStorageBackend(root)
  const unit = await backend.kv.open(DESCRIPTOR)
  await unit.putRecord('t', 'a', { v: 1 })
  await unit.putRecord('t', 'b', { v: 2 })

  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  gates.renameOverride = async (_from, to) => {
    if (to.endsWith('/b.json.deleting')) {
      entered.resolve(undefined)
      await release.promise
    }
    return false
  }

  const batch = unit.deleteRecords('t', ['a', 'b'])
  await entered.promise
  let closed = false
  const closing = unit.close().then(() => { closed = true })
  await new Promise(resolve => setTimeout(resolve, 25))
  // The batch still holds the unit: its rename is blocked inside the call.
  expect(closed).toBe(false)

  release.resolve(undefined)
  await batch
  await closing
  expect(closed).toBe(true)

  // The batch finished before release, so the reopened unit sees no records.
  const reopened = await backend.kv.open(DESCRIPTOR)
  expect(await reopened.loadAll()).toEqual({ tables: { t: {} }, global: null })
  await backend.close()
})

it('rejects with unknown-state when a failed batch cannot restore its staged documents', async () => {
  const root = await freshRoot()
  const backend: JsonStorageBackend = new JsonStorageBackend(root)
  const unit = await backend.kv.open(DESCRIPTOR)
  await unit.putRecord('t', 'a', { v: 1 })
  await unit.putRecord('t', 'b', { v: 2 })

  gates.renameOverride = async (from, to) => {
    // The second document cannot be staged, and the first cannot be restored.
    if (to.endsWith('/b.json.deleting')) throw denied()
    if (from.endsWith('/a.json.deleting')) throw denied()
    return false
  }

  await expect(unit.deleteRecords('t', ['a', 'b'])).rejects.toMatchObject({
    name: 'StorageError',
    code: 'unknown-state',
  })
  // The unit reports the unknown state instead of claiming the batch is unapplied.
  await expect(unit.loadAll()).rejects.toMatchObject({ code: 'unknown-state' })
  await expect(unit.putRecord('t', 'c', { v: 3 })).rejects.toMatchObject({ code: 'unknown-state' })
  await expect(unit.deleteRecord('t', 'a')).rejects.toMatchObject({ code: 'unknown-state' })
  // Releasing the handle stays possible.
  await unit.close()
  await backend.close()
})

/** Independent process used to verify fresh authorization reads over the production JSON backend. */
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as Domains from '@deepseek-ai/dsh-storage-domain'
import { CuaPermissionStore } from '../../src/permission-store.ts'
import type { CuaApplicationId } from '../../src/application-types.ts'

const [root, directory, id] = process.argv.slice(2)
if (!root || !directory || !id) throw new Error('Expected storage root, profile directory and application id')
const ctx = new Context()
try {
  ctx.provide('profileContext', { dir: directory })
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root })
  await ctx.plugin(Domains, { backend: 'json' })
  const store = new CuaPermissionStore(ctx, [], 30_000)
  await store.withState(new AbortController().signal, async (transaction) => {
    const existing = transaction.state.applications[id]
    await transaction.save({ ...transaction.state, applications: { ...transaction.state.applications,
      [id]: { revoked: (existing?.revoked ?? 0) + 1, sessions: {},
        always: { id: id as CuaApplicationId, name: 'Other process', executablePath: '/other' } },
    } })
  })
  process.stdout.write('saved\n')
} finally { await ctx.fiber.dispose() }

/** Native backend checks for explicit directory grants and their denial cases. */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect } from 'vitest'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'

function quote(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`
}

async function run(provider: LocalSandboxProvider, command: string, policy: SandboxPolicy) {
  const confined = await provider.confine(['bash', '-c', command], policy)
  const result = spawnSync(confined.argv[0]!, confined.argv.slice(1), { encoding: 'utf8', timeout: 30_000 })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  return result
}

/**
 * Check a native backend's explicit grant outside its temporary-directory grant.
 * @param provider - selected native sandbox backend.
 * @param directory - fixture allocator whose caller owns cleanup.
 * @returns completion after checking allowed, unrelated, and read-only writes.
 */
export async function checkExtraWrites(provider: LocalSandboxProvider, directory: (base: string) => Promise<string>): Promise<void> {
  const workspaceRoot = realpathSync.native(await directory(homedir()))
  const extra = realpathSync.native(await directory(homedir()))
  const outside = realpathSync.native(await directory(homedir()))
  const policy: SandboxPolicy = { mode: 'workspace-write', workspaceRoot, additionalWritableRoots: [extra] }
  const allowed = join(extra, 'allowed.txt')
  const result = await run(provider, `printf allowed > ${quote(allowed)}`, policy)
  expect(result.status, result.stderr).toBe(0)
  expect(readFileSync(allowed, 'utf8')).toBe('allowed')
  const denied = join(outside, 'denied.txt')
  expect((await run(provider, `printf denied > ${quote(denied)}`, policy)).status).not.toBe(0)
  expect(existsSync(denied)).toBe(false)
  const readOnly = join(extra, 'read-only.txt')
  expect((await run(provider, `printf denied > ${quote(readOnly)}`, { ...policy, mode: 'read-only' })).status).not.toBe(0)
  expect(existsSync(readOnly)).toBe(false)
}

/**
 * Check that a confined command cannot redirect a later grant by replacing its directory.
 * @param provider - selected native sandbox backend.
 * @param directory - fixture allocator whose caller owns cleanup.
 * @returns completion after verifying replacement is rejected before an outside write.
 */
export async function checkRedirectedRoot(provider: LocalSandboxProvider, directory: (base: string) => Promise<string>): Promise<void> {
  const workspaceRoot = realpathSync.native(await directory(homedir()))
  const outside = realpathSync.native(await directory(homedir()))
  const extra = join(workspaceRoot, 'extra')
  mkdirSync(extra)
  const policy: SandboxPolicy = { mode: 'workspace-write', workspaceRoot, additionalWritableRoots: [extra] }
  const replaced = await run(provider, `rmdir ${quote(extra)} && ln -s ${quote(outside)} ${quote(extra)}`, policy)
  expect(replaced.status, replaced.stderr).toBe(0)
  const target = join(outside, 'escape.txt')
  await expect(run(provider, `printf denied > ${quote(target)}`, policy)).rejects.toMatchObject({ code: 'SANDBOX_INVALID_ROOT' })
  expect(existsSync(target)).toBe(false)
}

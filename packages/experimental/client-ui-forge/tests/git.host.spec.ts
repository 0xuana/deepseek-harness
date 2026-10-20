import { access, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import LocalSandbox from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { hasBranch, inspectCheckout, listBranches } from '../src/git.ts'
import type { GitConfig } from '../src/git.ts'
import { commitAt, git, RecordingSandbox, repository, sandboxRecord, scratch, script } from './harness.ts'
import type { SandboxRecord } from './harness.ts'

const CONFIG: GitConfig = { gitCommand: 'git', gitTimeoutMs: 10_000, graceMs: 500, maxOutputBytes: 1_048_576 }
const GIT_PREFIX = ['--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false']
const posix = process.platform === 'linux' || process.platform === 'darwin'

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function directory(prefix = 'dsh-forge-git-'): Promise<string> {
  const { path, remove } = await scratch(prefix)
  cleanups.push(remove)
  return path
}

function session(cwd: string): Session {
  const id = SessionId('forge-git')
  return Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, cwd })
}

async function context(record: SandboxRecord, root: string, real = false): Promise<Context> {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(LocalSubprocessRuntime)
  if (real) await ctx.plugin(LocalSandbox)
  else await ctx.plugin(RecordingSandbox, record)
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: root })
  return ctx
}

function live(): AbortSignal {
  return new AbortController().signal
}

/** The subcommands of the recorded Git runs, after the fixed prefix, in sorted order. */
function commands(record: SandboxRecord): string[] {
  return record.calls.map(call => call.argv.slice(1 + GIT_PREFIX.length).join(' ')).sort()
}

/** A repository whose `main`, `newer`, and `older` tips were committed from latest to earliest, with `main` checked out. */
async function branched(root: string): Promise<string> {
  const repo = await repository(root)
  await commitAt(repo, 'main.txt', '2026-03-01T00:00:00Z')
  await git(repo, 'checkout', '-b', 'older')
  await commitAt(repo, 'older.txt', '2026-01-01T00:00:00Z')
  await git(repo, 'checkout', '-b', 'newer', 'main')
  await commitAt(repo, 'newer.txt', '2026-02-01T00:00:00Z')
  await git(repo, 'checkout', 'main')
  return repo
}

describe('inspectCheckout', () => {
  it('reads the root, shared Git directory, branch, upstream, and remotes of the checkout with five read-only commands', async () => {
    const root = await directory()
    const repo = await repository(root)
    await git(root, 'init', '--bare', '-b', 'main', 'origin.git')
    await git(repo, 'remote', 'add', 'origin', join(root, 'origin.git'))
    await git(repo, 'remote', 'add', 'fake', 'https://fake.test/octo/demo.git')
    await git(repo, 'push', '-u', 'origin', 'main')
    const nested = join(repo, 'src')
    await mkdir(nested)
    const record = sandboxRecord()
    const ctx = await context(record, repo)

    const inspection = await inspectCheckout(ctx, CONFIG, session(repo), nested, live())

    expect(inspection?.checkout).toEqual({ root: repo, branch: 'main' })
    expect(inspection?.commonDir).toBe(join(repo, '.git'))
    expect(inspection?.upstream).toBe('origin/main')
    expect(inspection?.remotes).toHaveLength(2)
    expect(inspection?.remotes).toEqual(expect.arrayContaining([
      { name: 'fake', urls: ['https://fake.test/octo/demo.git'] },
      { name: 'origin', urls: [join(root, 'origin.git')] },
    ]))
    expect(record.calls[0]?.argv.slice(1 + GIT_PREFIX.length)).toEqual(['rev-parse', '--show-toplevel'])
    expect(commands(record)).toEqual([
      'remote -v',
      'rev-parse --abbrev-ref --symbolic-full-name @{upstream}',
      'rev-parse --path-format=absolute --git-common-dir',
      'rev-parse --show-toplevel',
      'symbolic-ref --quiet --short HEAD',
    ])
    for (const call of record.calls) {
      expect(call.policy).toMatchObject({ mode: 'read-only', workspaceRoot: repo })
      expect(call.argv.slice(1, 1 + GIT_PREFIX.length)).toEqual(GIT_PREFIX)
    }
  })

  it('inspects a linked worktree as its own checkout that shares the Git directory of its repository', async () => {
    const root = await directory()
    const repo = await repository(root)
    const linked = join(root, 'linked')
    await git(repo, 'worktree', 'add', '-b', 'feat', linked)
    const ctx = await context(sandboxRecord(), repo)

    await expect(inspectCheckout(ctx, CONFIG, session(repo), linked, live())).resolves.toEqual({
      checkout: { root: linked, branch: 'feat' }, commonDir: join(repo, '.git'), upstream: null, remotes: [],
    })
  })

  it('returns undefined outside a checkout and inside a Git directory', async () => {
    const root = await directory()
    const repo = await repository(root)
    const ctx = await context(sandboxRecord(), root)

    await expect(inspectCheckout(ctx, CONFIG, session(root), root, live())).resolves.toBeUndefined()
    await expect(inspectCheckout(ctx, CONFIG, session(root), join(repo, '.git'), live())).resolves.toBeUndefined()
  })

  it('reports an unborn branch and a detached HEAD', async () => {
    const root = await directory()
    await git(root, 'init', '-b', 'main', 'empty')
    const repo = await repository(root)
    await git(repo, 'checkout', '--detach')
    const ctx = await context(sandboxRecord(), root)

    await expect(inspectCheckout(ctx, CONFIG, session(root), join(root, 'empty'), live())).resolves.toEqual({
      checkout: { root: join(root, 'empty'), branch: 'main' }, commonDir: join(root, 'empty', '.git'), upstream: null, remotes: [],
    })
    await expect(inspectCheckout(ctx, CONFIG, session(root), repo, live())).resolves.toEqual({
      checkout: { root: repo, branch: null }, commonDir: join(repo, '.git'), upstream: null, remotes: [],
    })
  })

  it('stops when the caller aborts', async () => {
    const root = await directory()
    const ctx = await context(sandboxRecord(), root)
    const controller = new AbortController()
    controller.abort(new Error('closed'))

    await expect(inspectCheckout(ctx, CONFIG, session(root), root, controller.signal)).rejects.toThrow('closed')
  })
})

describe.skipIf(!posix)('inspectCheckout with a stand-in Git', () => {
  it('never runs a configured filter, because it reads no working tree file', async () => {
    const root = await directory()
    const repo = await repository(root)
    const marker = join(root, 'filter-executed')
    await writeFile(join(repo, '.gitattributes'), '*.txt filter=marker\n')
    await git(repo, 'config', 'filter.marker.clean', `sh -c 'echo executed >> "${marker}"; cat'`)
    await writeFile(join(repo, 'tracked.txt'), 'changed\n')
    const ctx = await context(sandboxRecord(), repo)

    const inspection = await inspectCheckout(ctx, CONFIG, session(repo), repo, live())

    expect(inspection?.checkout).toEqual({ root: repo, branch: 'main' })
    await expect(access(marker)).rejects.toThrow()
    await git(repo, 'status', '--porcelain')
    expect(await readFile(marker, 'utf8')).toContain('executed')
  })

  it('runs Git with a cleared repository selector and disabled prompts, locks, and lazy fetches', async () => {
    const root = await directory()
    const log = join(root, 'env.log')
    const fake = await script(join(root, 'git'), [
      'case "$*" in',
      `  *--show-toplevel*) env | grep -E '^(GIT_|LC_ALL)' | sort > "${log}"; echo /work/repo ;;`,
      '  *--git-common-dir*) echo /work/repo/.git ;;',
      '  *symbolic-ref*) exit 1 ;;',
      '  *--abbrev-ref*) exit 128 ;;',
      'esac',
    ].join('\n'))
    vi.stubEnv('GIT_DIR', join(root, 'elsewhere.git'))
    const ctx = await context(sandboxRecord(), root)

    try {
      await expect(inspectCheckout(ctx, { ...CONFIG, gitCommand: fake }, session(root), root, live())).resolves.toEqual({
        checkout: { root: '/work/repo', branch: null }, commonDir: '/work/repo/.git', upstream: null, remotes: [],
      })
    } finally {
      vi.unstubAllEnvs()
    }
    const environment = await readFile(log, 'utf8')
    expect(environment).toContain('GIT_OPTIONAL_LOCKS=0')
    expect(environment).toContain('GIT_NO_LAZY_FETCH=1')
    expect(environment).toContain('GIT_TERMINAL_PROMPT=0')
    expect(environment).toContain('LC_ALL=C')
    expect(environment).not.toContain('GIT_DIR=')
  })

  it('resolves the top-level and shared Git directories Git prints into canonical process paths', async () => {
    const root = await directory()
    const repo = await repository(root)
    const alias = join(root, 'alias')
    await symlink(repo, alias)
    const fake = await script(join(root, 'git'), [
      'case "$*" in',
      `  *--show-toplevel*) echo "${alias}/" ;;`,
      `  *--git-common-dir*) echo "${alias}/.git" ;;`,
      '  *symbolic-ref*) echo main ;;',
      '  *--abbrev-ref*) echo origin/main ;;',
      'esac',
    ].join('\n'))
    const ctx = await context(sandboxRecord(), root)

    await expect(inspectCheckout(ctx, { ...CONFIG, gitCommand: fake }, session(root), root, live())).resolves.toEqual({
      checkout: { root: repo, branch: 'main' }, commonDir: join(repo, '.git'), upstream: 'origin/main', remotes: [],
    })
  })

  it.each([
    ['an unexpected exit', 'echo broken >&2; exit 2', {}, 'git rev-parse failed (2): broken'],
    ['another rev-parse error', 'echo "fatal: detected dubious ownership" >&2; exit 128', {}, 'git rev-parse failed: fatal: detected dubious ownership'],
    ['a signal', 'kill -9 $$', {}, 'git rev-parse failed (SIGKILL): no diagnostic'],
    ['missing output', 'exit 0', {}, 'git rev-parse printed no directory'],
    ['oversized output', 'echo /a/very/long/top/level/path', { maxOutputBytes: 4 }, 'git rev-parse output exceeds maxOutputBytes'],
    ['a timeout', 'sleep 5', { gitTimeoutMs: 100 }, 'FORGE_PANEL_GIT_TIMEOUT after 100ms'],
  ])('fails on %s', async (_label, body, overrides: Partial<GitConfig>, message) => {
    const root = await directory()
    const fake = await script(join(root, 'git'), body)
    const ctx = await context(sandboxRecord(), root)

    await expect(inspectCheckout(ctx, { ...CONFIG, ...overrides, gitCommand: fake }, session(root), root, live())).rejects.toThrow(message)
  })

  it('fails when the Git executable is missing', async () => {
    const root = await directory()
    const ctx = await context(sandboxRecord(), root)

    await expect(inspectCheckout(ctx, { ...CONFIG, gitCommand: join(root, 'missing-git') }, session(root), root, live())).rejects.toThrow()
  })

  it.each([
    ['common-dir', '*--git-common-dir*) echo "fatal: bad common dir" >&2; exit 128 ;;', 'git common-dir failed (128): fatal: bad common dir'],
    ['symbolic-ref', '*symbolic-ref*) echo "fatal: bad HEAD" >&2; exit 128 ;;', 'git symbolic-ref failed (128): fatal: bad HEAD'],
    ['upstream', '*--abbrev-ref*) echo "fatal: bad upstream" >&2; exit 1 ;;', 'git upstream failed (1): fatal: bad upstream'],
    ['remote', '*remote*) echo "fatal: bad config" >&2; exit 3 ;;', 'git remote failed (3): fatal: bad config'],
  ])('names a failing %s command after the top-level directory', async (_name, failure, message) => {
    const root = await directory()
    const fake = await script(join(root, 'git'), [
      'case "$*" in',
      `  ${failure}`,
      '  *--show-toplevel*) echo /work/repo ;;',
      '  *--git-common-dir*) echo /work/repo/.git ;;',
      'esac',
    ].join('\n'))
    const ctx = await context(sandboxRecord(), root)

    await expect(inspectCheckout(ctx, { ...CONFIG, gitCommand: fake }, session(root), root, live())).rejects.toThrow(message)
  })

  it('rejects a shared Git directory that Git does not print', async () => {
    const root = await directory()
    const fake = await script(join(root, 'git'), ['case "$*" in', '  *--show-toplevel*) echo /work/repo ;;', 'esac'].join('\n'))
    const ctx = await context(sandboxRecord(), root)

    await expect(inspectCheckout(ctx, { ...CONFIG, gitCommand: fake }, session(root), root, live())).rejects.toThrow('git rev-parse printed no directory')
  })
})

describe('listBranches', () => {
  it('lists the checked-out branch first, then local branches by latest commit, with two read-only commands', async () => {
    const root = await directory()
    const repo = await branched(root)
    const record = sandboxRecord()
    const ctx = await context(record, repo)

    await expect(listBranches(ctx, CONFIG, session(repo), repo, 50, live())).resolves.toEqual({
      current: 'main', branches: ['main', 'newer', 'older'],
    })
    expect(commands(record)).toEqual([
      'for-each-ref --sort=-committerdate --count=50 --format=%(refname:lstrip=2) refs/heads/',
      'symbolic-ref --quiet --short HEAD',
    ])
    for (const call of record.calls) {
      expect(call.policy).toMatchObject({ mode: 'read-only', workspaceRoot: repo })
      expect(call.argv.slice(1, 1 + GIT_PREFIX.length)).toEqual(GIT_PREFIX)
    }
  })

  it('keeps the checked-out branch first when the limit cuts it from the listing', async () => {
    const root = await directory()
    const repo = await branched(root)
    await git(repo, 'checkout', 'older')
    const ctx = await context(sandboxRecord(), repo)

    await expect(listBranches(ctx, CONFIG, session(repo), repo, 2, live())).resolves.toEqual({ current: 'older', branches: ['older', 'main'] })
    await expect(listBranches(ctx, CONFIG, session(repo), repo, 1, live())).resolves.toEqual({ current: 'older', branches: ['older'] })
  })

  it('lists the branches of a detached HEAD without a current one, and an unborn branch alone', async () => {
    const root = await directory()
    const repo = await branched(root)
    await git(repo, 'checkout', '--detach', 'main')
    await git(root, 'init', '-b', 'main', 'empty')
    const ctx = await context(sandboxRecord(), root)

    await expect(listBranches(ctx, CONFIG, session(root), repo, 2, live())).resolves.toEqual({ current: null, branches: ['main', 'newer'] })
    await expect(listBranches(ctx, CONFIG, session(root), join(root, 'empty'), 50, live())).resolves.toEqual({ current: 'main', branches: ['main'] })
  })

  it('fails outside a checkout', async () => {
    const root = await directory()
    const ctx = await context(sandboxRecord(), root)

    await expect(listBranches(ctx, CONFIG, session(root), root, 50, live()))
      .rejects.toThrow(/^git (symbolic-ref|for-each-ref) failed \(128\): fatal: not a git repository/)
  })

  it.skipIf(!posix)('names a failing branch listing', async () => {
    const root = await directory()
    const fake = await script(join(root, 'git'), [
      'case "$*" in',
      '  *for-each-ref*) echo "fatal: bad ref" >&2; exit 2 ;;',
      '  *symbolic-ref*) echo main ;;',
      'esac',
    ].join('\n'))
    const ctx = await context(sandboxRecord(), root)

    await expect(listBranches(ctx, { ...CONFIG, gitCommand: fake }, session(root), root, 50, live()))
      .rejects.toThrow('git for-each-ref failed (2): fatal: bad ref')
  })

  it('stops when the caller aborts', async () => {
    const root = await directory()
    const ctx = await context(sandboxRecord(), root)
    const controller = new AbortController()
    controller.abort(new Error('closed'))

    await expect(listBranches(ctx, CONFIG, session(root), root, 50, controller.signal)).rejects.toThrow('closed')
  })
})

describe('hasBranch', () => {
  it('reports whether a local branch exists with one read-only command per question', async () => {
    const root = await directory()
    const repo = await branched(root)
    const record = sandboxRecord()
    const ctx = await context(record, repo)

    await expect(hasBranch(ctx, CONFIG, session(repo), repo, 'newer', live())).resolves.toBe(true)
    await expect(hasBranch(ctx, CONFIG, session(repo), repo, 'dsh/0a1b2c3d', live())).resolves.toBe(false)

    expect(record.calls.map(call => call.argv.slice(1 + GIT_PREFIX.length).join(' '))).toEqual([
      'show-ref --verify --quiet refs/heads/newer',
      'show-ref --verify --quiet refs/heads/dsh/0a1b2c3d',
    ])
    for (const call of record.calls) {
      expect(call.policy).toMatchObject({ mode: 'read-only', workspaceRoot: repo })
      expect(call.argv.slice(1, 1 + GIT_PREFIX.length)).toEqual(GIT_PREFIX)
    }
  })

  it('reads the branches of the repository from a linked worktree', async () => {
    const root = await directory()
    const repo = await branched(root)
    const linked = join(root, 'linked')
    await git(repo, 'worktree', 'add', '-b', 'feat', linked)
    const ctx = await context(sandboxRecord(), repo)

    await expect(hasBranch(ctx, CONFIG, session(repo), linked, 'older', live())).resolves.toBe(true)
  })

  it('fails outside a repository', async () => {
    const root = await directory()
    const ctx = await context(sandboxRecord(), root)

    await expect(hasBranch(ctx, CONFIG, session(root), root, 'main', live()))
      .rejects.toThrow(/^git show-ref failed \(128\): fatal: not a git repository/)
  })

  it('stops when the caller aborts', async () => {
    const root = await directory()
    const repo = await repository(root)
    const ctx = await context(sandboxRecord(), repo)
    const controller = new AbortController()
    controller.abort(new Error('closed'))

    await expect(hasBranch(ctx, CONFIG, session(repo), repo, 'main', controller.signal)).rejects.toThrow('closed')
  })
})

const sandboxUsable = await (async () => {
  if (!posix) return false
  const probe = new Context()
  try {
    await probe.plugin(LocalSandbox)
    await probe.sandbox.confine([process.execPath, '--version'], { mode: 'read-only', workspaceRoot: process.cwd() })
    return true
  } catch (error: unknown) {
    if (error instanceof SandboxUnavailableError) return false
    throw error
  } finally {
    await probe.fiber.dispose()
  }
})()

describe.skipIf(!sandboxUsable)('Git inspection under the local sandbox', () => {
  it('reads a checkout and lists its branches under read-only confinement without writing its index', async () => {
    const root = await directory()
    const repo = await repository(root)
    await writeFile(join(repo, 'tracked.txt'), 'changed\n')
    const index = join(repo, '.git', 'index')
    const before = await stat(index)
    const ctx = await context(sandboxRecord(), repo, true)
    const confine = vi.spyOn(ctx.sandbox, 'confine')

    await expect(inspectCheckout(ctx, CONFIG, session(repo), repo, live())).resolves.toEqual({
      checkout: { root: repo, branch: 'main' }, commonDir: join(repo, '.git'), upstream: null, remotes: [],
    })
    await expect(listBranches(ctx, CONFIG, session(repo), repo, 50, live())).resolves.toEqual({ current: 'main', branches: ['main'] })

    expect(confine).toHaveBeenCalledTimes(7)
    expect(confine.mock.calls.every(call => call[1].mode === 'read-only')).toBe(true)
    expect((await stat(index)).mtimeMs).toBe(before.mtimeMs)
    await expect(access(join(repo, '.git', 'index.lock'))).rejects.toThrow()
  })
})

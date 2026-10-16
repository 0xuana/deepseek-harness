// @vitest-environment jsdom
/** Forge panel registration: the Remote mount, slot entries, per-Session stores, actions and their notices, and unload. */
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError, type RemoteResult, type TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionToast } from '../src/client/ActionToast.tsx'
import { BranchChip, type BranchChipInjected } from '../src/client/BranchChip.tsx'
import { ForgeTab, type ForgeTabInjected } from '../src/client/ForgeTab.tsx'
import { ForgeTabTitle } from '../src/client/ForgeTabTitle.tsx'
import { HeaderButton, type HeaderButtonInjected } from '../src/client/HeaderButton.tsx'
import { en, NS, zh } from '../src/client/locales.ts'
import { inject, mountForgePanel, TAB_ID, TAB_KIND } from '../src/client/mount.ts'
import type { NoticeSource } from '../src/client/source.ts'
import { WorktreeProgress, type WorktreeProgressInjected } from '../src/client/WorktreeProgress.tsx'
import { WorktreeToggle, type WorktreeToggleInjected } from '../src/client/WorktreeToggle.tsx'
import type { ForgeBranches, ForgePanelState } from '../src/types.ts'
import { entry, ready, snapshot, unserved } from './client-fixtures.client.ts'

const REMOTE: TypertRemoteContribution = { package: '@deepseek-ai/dsh-experimental-client-ui-forge', descriptors: [] }
const S1 = SessionId('s1')
const S2 = SessionId('s2')
const BRANCHES: ForgeBranches = { current: 'main', branches: ['main', 'release'] }

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'clipboard')
})

/** A fake `follow` stream handle the test feeds by hand. */
function stream(signal: AbortSignal) {
  const queue: ForgePanelState[] = []
  let wake: (() => void) | undefined
  let closed = false
  const handle = {
    signal,
    disposed: vi.fn(),
    push(state: ForgePanelState) { queue.push(state); wake?.() },
    dispose() { handle.disposed(); closed = true; wake?.() },
    async *[Symbol.asyncIterator](): AsyncIterator<ForgePanelState> {
      while (true) {
        const next = queue.shift()
        if (next !== undefined) { yield next; continue }
        if (closed) return
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
      }
    },
  }
  return handle
}

const OK: RemoteResult<void> = { ok: true, value: undefined }

const REFUSED = {
  started: { ok: false, error: new RemoteError('forgePanel/session-started', 'started', {}) },
  unavailable: { ok: false, error: new RemoteError('forgePanel/worktrees-unavailable', 'unavailable', {}) },
  busy: { ok: false, error: new RemoteError('forgePanel/session-busy', 'busy', {}) },
  restore: { ok: false, error: new RemoteError('forgePanel/restore-failed', 'fatal: \'/work/repo-dsh\' already exists', {}) },
  failed: { ok: false, error: new RemoteError('gateway/bad-request', 'failed', {}) },
} satisfies Record<string, RemoteResult<never>>

function isTabFace(value: Record<string, unknown>): value is Record<string, unknown> & ForgeTabInjected {
  return typeof value.reportVisible === 'function' && typeof value.copyText === 'function'
}

function isHeaderFace(value: Record<string, unknown>): value is Record<string, unknown> & HeaderButtonInjected {
  return typeof value.toggle === 'function' && typeof value.hooks === 'object'
}

function isWorktreeFace(value: Record<string, unknown>): value is Record<string, unknown> & WorktreeToggleInjected {
  return typeof value.request === 'function' && typeof value.branches === 'function'
}

function isProgressFace(value: Record<string, unknown>): value is Record<string, unknown> & WorktreeProgressInjected {
  return typeof value.stop === 'function' && typeof value.withdraw === 'function'
    && typeof value.restore === 'function' && typeof value.leave === 'function'
}

function isBranchFace(value: Record<string, unknown>): value is Record<string, unknown> & BranchChipInjected {
  return typeof value.hooks === 'object' && Object.keys(value).length === 1
}

function isNoticeFace(value: Record<string, unknown>): value is Record<string, unknown> & Omit<NoticeSource, 'report'> {
  return typeof value.dismiss === 'function' && typeof value.hooks === 'object'
}

/** Let the Remote results that the actions await settle. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

async function base() {
  const ctx = new Context()
  const unmount = vi.fn(async () => {})
  class Remote extends Service {
    $host: RemoteHostFacts = { home: '/home/octo', isLoopback: true }
    constructor() { super(ctx, 'remote') }
    async $mount(contribution: TypertRemoteContribution) {
      expect(contribution).toBe(REMOTE)
      return unmount
    }
  }
  const remote = new Remote()
  const streams: ReturnType<typeof stream>[] = []
  const forgePanel = {
    follow: vi.fn((_sessionId: SessionId, signal: AbortSignal) => {
      const handle = stream(signal)
      streams.push(handle)
      return handle
    }),
    track: vi.fn(async (_sessionId: SessionId, _url: string): Promise<RemoteResult<void>> => OK),
    dismiss: vi.fn(async (_sessionId: SessionId, _url: string): Promise<RemoteResult<void>> => OK),
    refresh: vi.fn(async (_sessionId: SessionId): Promise<RemoteResult<void>> => OK),
    requestWorktree: vi.fn(async (_sessionId: SessionId, _from: string | null): Promise<RemoteResult<void>> => OK),
    cancelWorktree: vi.fn(async (_sessionId: SessionId): Promise<RemoteResult<void>> => OK),
    stopCreation: vi.fn(async (_sessionId: SessionId): Promise<RemoteResult<void>> => OK),
    restoreWorktree: vi.fn(async (_sessionId: SessionId): Promise<RemoteResult<void>> => OK),
    continueInProject: vi.fn(async (_sessionId: SessionId): Promise<RemoteResult<void>> => OK),
    branches: vi.fn(async (_sessionId: SessionId): Promise<RemoteResult<ForgeBranches>> => ({ ok: true, value: BRANCHES })),
  }
  ctx.provide('remote.forgePanel', forgePanel)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const unregisterTab = vi.fn()
  const sidebarRightTabs = { register: vi.fn((_type: { id: string; kind: string; title: () => string }) => unregisterTab) }
  ctx.provide('sidebarRightTabs', sidebarRightTabs)
  const sidebarRight = { openTab: vi.fn(), toggleExpanded: vi.fn() }
  ctx.provide('sidebarRight', sidebarRight)
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({
    name: 'root',
    children: {
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
      'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session' },
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.hero.options': { kind: 'list', scope: 'session' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'conversation.input.left': { kind: 'list', scope: 'session' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  return { ctx, remote, unmount, streams, forgePanel, sidebarRightTabs, unregisterTab, sidebarRight }
}

async function fixture() {
  const b = await base()
  let dispose: (() => Promise<void>) | undefined
  await b.ctx.plugin({ inject: [...inject], apply: async (plugin: Context) => { dispose = await mountForgePanel(plugin, REMOTE) } })
  assert(dispose !== undefined)
  const entry = (slot: Parameters<typeof b.ctx.slots.entries>[0], component: unknown) =>
    b.ctx.slots.entries(slot).find(candidate => candidate.component === component)
  const tabInject = entry('sidebar.right.pane.tab', ForgeTab)?.inject
  const headerInject = entry('conversation.session.header.utilities', HeaderButton)?.inject
  const worktreeInject = entry('conversation.hero.options', WorktreeToggle)?.inject
  const progressInject = entry('conversation.input.dock', WorktreeProgress)?.inject
  const branchInject = entry('conversation.session.header.actions', BranchChip)?.inject
  const toastInject = entry('shell.overlay', ActionToast)?.inject
  assert(tabInject !== undefined && headerInject !== undefined && worktreeInject !== undefined && toastInject !== undefined)
  assert(progressInject !== undefined && branchInject !== undefined)
  const tab = (sessionId: SessionId): ForgeTabInjected => {
    const value = tabInject(sessionId as never)
    assert(isTabFace(value))
    return value
  }
  const header = (sessionId: SessionId): HeaderButtonInjected => {
    const value = headerInject(sessionId as never)
    assert(isHeaderFace(value))
    return value
  }
  const worktree = (sessionId: SessionId): WorktreeToggleInjected => {
    const value = worktreeInject(sessionId as never)
    assert(isWorktreeFace(value))
    return value
  }
  const progress = (sessionId: SessionId): WorktreeProgressInjected => {
    const value = progressInject(sessionId as never)
    assert(isProgressFace(value))
    return value
  }
  const branch = (sessionId: SessionId): BranchChipInjected => {
    const value = branchInject(sessionId as never)
    assert(isBranchFace(value))
    return value
  }
  const toast = (): Omit<NoticeSource, 'report'> => {
    const value = toastInject(undefined as never)
    assert(isNoticeFace(value))
    return value
  }
  const notice = () => toast().hooks.notice.getSnapshot()
  return { ...b, dispose, entry, tab, header, worktree, progress, branch, toast, notice }
}

describe('mountForgePanel registration', () => {
  it('declares the browser services it needs', () => {
    expect(inject).toEqual(['remote', 'slots', 'locale', 'sidebarRightTabs', 'sidebarRight'])
  })

  it('registers the tab type, its body and title, the header entries, the worktree option and card, and the toast', async () => {
    const f = await fixture()
    expect(f.sidebarRightTabs.register).toHaveBeenCalledOnce()
    const type = f.sidebarRightTabs.register.mock.calls[0]?.[0]
    expect(type).toMatchObject({ id: TAB_ID, kind: TAB_KIND })
    expect([en['tab.title'], zh['tab.title']]).toContain(type?.title())
    expect(f.entry('sidebar.right.pane.tab', ForgeTab)).toMatchObject({ options: { key: TAB_ID }, locale: NS })
    expect(f.entry('sidebar.right.pane.tab.title', ForgeTabTitle)).toMatchObject({ options: { key: TAB_ID }, locale: NS })
    expect(f.entry('conversation.session.header.utilities', HeaderButton)).toMatchObject({ options: { id: 'forge-panel', order: -8 }, locale: NS })
    expect(f.entry('conversation.session.header.actions', BranchChip)).toMatchObject({ options: { id: 'forge-panel.branch', order: 10 }, locale: NS })
    expect(f.entry('conversation.hero.options', WorktreeToggle)).toMatchObject({ options: { id: 'forge-panel.worktree' }, locale: NS })
    expect(f.entry('conversation.input.dock', WorktreeProgress)).toMatchObject({ options: { id: 'forge-panel.worktree', order: 5 }, locale: NS })
    expect(f.ctx.slots.entries('conversation.input.left')).toEqual([])
    expect(f.entry('shell.overlay', ActionToast)).toMatchObject({ options: { id: 'forge-panel.toast' }, locale: NS })
    expect(f.notice()).toBeNull()
    await f.dispose()
  })

  it('withdraws every entry, closes the streams, and unmounts the Remote on unload', async () => {
    const f = await fixture()
    f.tab(S1).hooks.panel.subscribe(() => {})
    f.header(S2)
    expect(f.streams).toHaveLength(1)

    await f.dispose()

    expect(f.streams[0]?.disposed).toHaveBeenCalled()
    expect(f.streams[0]?.signal.aborted).toBe(true)
    expect(f.unregisterTab).toHaveBeenCalled()
    expect(f.unmount).toHaveBeenCalledOnce()
    for (const [slot, component] of [
      ['sidebar.right.pane.tab', ForgeTab],
      ['sidebar.right.pane.tab.title', ForgeTabTitle],
      ['conversation.session.header.utilities', HeaderButton],
      ['conversation.session.header.actions', BranchChip],
      ['conversation.hero.options', WorktreeToggle],
      ['conversation.input.dock', WorktreeProgress],
      ['shell.overlay', ActionToast],
    ] as const) expect(f.entry(slot, component)).toBeUndefined()
    f.ctx.emit('connection/reset')
    expect(f.forgePanel.follow).toHaveBeenCalledOnce()
  })

  it('unmounts the Remote when the UI registration fails', async () => {
    const b = await base()
    vi.spyOn(b.ctx.slots, 'inject').mockImplementationOnce(() => { throw new Error('slot failed') })
    const fiber = b.ctx.plugin({ inject: [...inject], apply: (plugin: Context) => mountForgePanel(plugin, REMOTE) })
    await expect(fiber).rejects.toThrow('slot failed')
    expect(b.unmount).toHaveBeenCalledOnce()
    expect(b.unregisterTab).toHaveBeenCalled()
  })
})

describe('mountForgePanel Session stores', () => {
  it('shares one panel stream per Session between the tab, the header entries, the worktree option, and the worktree card', async () => {
    const f = await fixture()
    const tab = f.tab(S1)
    expect(f.header(S1).hooks.panel).toBe(tab.hooks.panel)
    expect(f.branch(S1).hooks.panel).toBe(tab.hooks.panel)
    expect(f.worktree(S1).hooks.panel).toBe(tab.hooks.panel)
    expect(f.progress(S1).hooks.panel).toBe(tab.hooks.panel)
    expect(f.tab(S2).hooks.panel).not.toBe(tab.hooks.panel)
    expect(f.forgePanel.follow).not.toHaveBeenCalled()

    const seen: unknown[] = []
    const unsubscribe = tab.hooks.panel.subscribe(() => { seen.push(tab.hooks.panel.getSnapshot().state) })
    expect(f.forgePanel.follow).toHaveBeenCalledWith(S1, expect.any(AbortSignal))
    f.streams[0]?.push(ready())
    await vi.waitFor(() => { expect(seen).toEqual([ready()]) })

    tab.reconnect()
    expect(f.forgePanel.follow).toHaveBeenCalledOnce()
    f.ctx.emit('connection/reset')
    expect(f.streams[0]?.disposed).toHaveBeenCalled()
    expect(f.forgePanel.follow).toHaveBeenCalledTimes(2)
    unsubscribe()
    expect(f.streams[1]?.disposed).toHaveBeenCalled()
    await f.dispose()
  })

  it('reads the Host facts for the tab and the branch label again after each reconnect', async () => {
    const f = await fixture()
    const host = f.tab(S1).hooks.host
    expect(f.branch(S2).hooks.host).toBe(host)
    expect(host.getSnapshot()).toEqual({ home: '/home/octo', isLoopback: true })
    const listener = vi.fn()
    const unsubscribe = host.subscribe(listener)

    f.remote.$host = { home: '/home/other', isLoopback: false }
    f.ctx.emit('connection/reset')
    expect(listener).toHaveBeenCalledOnce()
    expect(host.getSnapshot()).toEqual({ home: '/home/other', isLoopback: false })
    unsubscribe()
    f.ctx.emit('connection/reset')
    expect(listener).toHaveBeenCalledOnce()
    await f.dispose()
  })

  it('shares the tab visibility of a Session with its header entry', async () => {
    const f = await fixture()
    const visible = f.header(S1).hooks.visible
    const listener = vi.fn()
    visible.subscribe(listener)
    expect(visible.getSnapshot()).toBe(false)

    f.tab(S1).reportVisible(true)
    expect(visible.getSnapshot()).toBe(true)
    expect(listener).toHaveBeenCalledOnce()
    expect(f.header(S2).hooks.visible.getSnapshot()).toBe(false)
    await f.dispose()
  })

  it('reveals the hidden tab from the header entry and collapses the sidebar showing it', async () => {
    const f = await fixture()
    f.header(S1).toggle(false)
    expect(f.sidebarRight.openTab).toHaveBeenCalledWith(TAB_KIND)
    expect(f.sidebarRight.toggleExpanded).not.toHaveBeenCalled()
    f.header(S1).toggle(true)
    expect(f.sidebarRight.toggleExpanded).toHaveBeenCalledOnce()
    expect(f.sidebarRight.openTab).toHaveBeenCalledOnce()
    await f.dispose()
  })
})

describe('mountForgePanel tab actions', () => {
  it('opens links outside the app', async () => {
    const f = await fixture()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    f.tab(S1).openLink('https://github.com/octo/demo/pull/1')
    expect(open).toHaveBeenCalledWith('https://github.com/octo/demo/pull/1', '_blank', 'noopener,noreferrer')
    await f.dispose()
  })

  it.each([
    ['confirms a completed copy', async () => {}, { key: 'toast.copied', tone: 'success' }],
    ['reports a refused copy', async () => { throw new Error('denied') }, { key: 'toast.copyFailed', tone: 'failure' }],
  ])('copies text to the clipboard and %s', async (_label, write, outcome) => {
    const f = await fixture()
    const writeText = vi.fn(async (_text: string) => { await write() })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    f.tab(S1).copyText('gh auth login --hostname github.com')
    await settle()

    expect(writeText).toHaveBeenCalledWith('gh auth login --hostname github.com')
    expect(f.notice()).toMatchObject({ ...outcome, params: {}, undo: undefined })
    await f.dispose()
  })

  it('refreshes through the Remote and reports only a failure', async () => {
    const f = await fixture()
    f.tab(S1).refresh()
    await settle()
    expect(f.forgePanel.refresh).toHaveBeenCalledWith(S1)
    expect(f.notice()).toBeNull()

    f.forgePanel.refresh.mockResolvedValueOnce(REFUSED.failed)
    f.tab(S1).refresh()
    await settle()
    expect(f.notice()).toMatchObject({ key: 'toast.refreshFailed', tone: 'failure' })
    await f.dispose()
  })

  it('restores a removed worktree, confirming it or reporting why it failed until the notice is dismissed', async () => {
    const f = await fixture()
    f.tab(S1).restore()
    await settle()
    expect(f.forgePanel.restoreWorktree).toHaveBeenCalledWith(S1)
    expect(f.notice()).toMatchObject({ key: 'toast.restored', tone: 'success', seq: 1 })

    f.forgePanel.restoreWorktree.mockResolvedValueOnce(REFUSED.restore)
    f.tab(S1).restore()
    await settle()
    expect(f.notice()).toMatchObject({
      key: 'toast.restoreFailed', tone: 'failure', seq: 2, params: { message: 'fatal: \'/work/repo-dsh\' already exists' },
    })
    f.toast().dismiss()
    expect(f.notice()).toBeNull()
    await f.dispose()
  })
})

describe('mountForgePanel removal', () => {
  it('removes a change request and offers to restore it', async () => {
    const f = await fixture()
    const value = entry(7, snapshot(7))
    f.tab(S1).remove(value)
    await settle()
    expect(f.forgePanel.dismiss).toHaveBeenCalledWith(S1, 'https://github.com/octo/demo/pull/7')
    const removed = f.notice()
    expect(removed).toMatchObject({ key: 'toast.removed', tone: 'success', params: { name: '#7' } })

    removed?.undo?.()
    await settle()
    expect(f.forgePanel.track).toHaveBeenCalledWith(S1, 'https://github.com/octo/demo/pull/7')
    expect(f.notice()).toBe(removed)

    f.forgePanel.track.mockResolvedValueOnce(REFUSED.failed)
    removed?.undo?.()
    await settle()
    expect(f.notice()).toMatchObject({ key: 'toast.undoFailed', tone: 'failure' })
    await f.dispose()
  })

  it.each([
    ['its URL when it has neither a number nor a snapshot', unserved('https://example.test/review/latest'),
      'https://example.test/review/latest'],
    ['its title when it has no number', { ...unserved('https://example.test/review/latest'), snapshot: snapshot(3) }, 'Change 3'],
    ['the number in its URL', unserved('https://example.test/review/17'), '#17'],
  ])('names a removed unserved change request by %s, without undo', async (_label, value, name) => {
    const f = await fixture()
    f.tab(S1).remove(value)
    await settle()
    expect(f.notice()).toMatchObject({ key: 'toast.removed', tone: 'success', params: { name }, undo: undefined })
    await f.dispose()
  })

  it('reports a failed removal without offering undo', async () => {
    const f = await fixture()
    f.forgePanel.dismiss.mockResolvedValueOnce(REFUSED.failed)
    f.tab(S1).remove(entry(7, snapshot(7)))
    await settle()
    expect(f.notice()).toMatchObject({ key: 'toast.removeFailed', tone: 'failure', params: {}, undo: undefined })
    await f.dispose()
  })
})

describe('mountForgePanel worktree actions', () => {
  it('requests and withdraws a worktree through the Remote', async () => {
    const f = await fixture()
    const option = f.worktree(S1)
    expect(await option.request('release')).toBe(true)
    expect(await option.request(null)).toBe(true)
    expect(await option.cancel()).toBe(true)
    expect(f.forgePanel.requestWorktree.mock.calls).toEqual([[S1, 'release'], [S1, null]])
    expect(f.forgePanel.cancelWorktree).toHaveBeenCalledWith(S1)
    expect(f.notice()).toBeNull()
    await f.dispose()
  })

  it.each([
    ['a started Session', REFUSED.started, 'toast.worktreeStarted'],
    ['a missing worktree service', REFUSED.unavailable, 'toast.worktreeFailed'],
    ['any other failure', REFUSED.failed, 'toast.worktreeFailed'],
  ])('reports a request or withdrawal refused for %s', async (_label, refusal, key) => {
    const f = await fixture()
    const option = f.worktree(S1)
    f.forgePanel.requestWorktree.mockResolvedValueOnce(refusal)
    expect(await option.request('main')).toBe(false)
    expect(f.notice()).toMatchObject({ key, tone: 'failure', seq: 1 })
    f.forgePanel.cancelWorktree.mockResolvedValueOnce(refusal)
    expect(await option.cancel()).toBe(false)
    expect(f.notice()).toMatchObject({ key, tone: 'failure', seq: 2 })
    await f.dispose()
  })

  it('lists the branches of the Session checkout and reports when they cannot be read', async () => {
    const f = await fixture()
    expect(await f.worktree(S1).branches()).toEqual(BRANCHES)
    expect(f.forgePanel.branches).toHaveBeenCalledWith(S1)
    expect(f.notice()).toBeNull()

    f.forgePanel.branches.mockResolvedValueOnce(REFUSED.failed)
    expect(await f.worktree(S1).branches()).toBeUndefined()
    expect(f.notice()).toMatchObject({ key: 'toast.branchesFailed', tone: 'failure' })
    await f.dispose()
  })
})

describe('mountForgePanel worktree card actions', () => {
  it.each([
    ['stops the creation that holds the message', 'stop' as const, 'stopCreation' as const],
    ['withdraws the request after a failed creation', 'withdraw' as const, 'cancelWorktree' as const],
  ])('%s through the Remote and reports only a failure', async (_label, action, method) => {
    const f = await fixture()
    f.progress(S1)[action]()
    await settle()
    expect(f.forgePanel[method]).toHaveBeenCalledWith(S1)
    expect(f.notice()).toBeNull()

    f.forgePanel[method].mockResolvedValueOnce(REFUSED.busy)
    f.progress(S1)[action]()
    await settle()
    expect(f.notice()).toMatchObject({ key: 'toast.worktreeFailed', tone: 'failure' })
    await f.dispose()
  })

  it('restores a removed worktree through the Remote and confirms it', async () => {
    const f = await fixture()
    expect(await f.progress(S1).restore()).toBeUndefined()
    expect(f.forgePanel.restoreWorktree).toHaveBeenCalledWith(S1)
    expect(f.notice()).toMatchObject({ key: 'toast.restored', tone: 'success' })
    await f.dispose()
  })

  it('returns why a restore failed for the card to show, without a notice', async () => {
    const f = await fixture()
    f.forgePanel.restoreWorktree.mockResolvedValueOnce(REFUSED.restore)
    expect(await f.progress(S1).restore()).toBe('fatal: \'/work/repo-dsh\' already exists')
    expect(f.notice()).toBeNull()
    await f.dispose()
  })

  it('continues in the project through the Remote and reports only a failure', async () => {
    const f = await fixture()
    f.progress(S1).leave()
    await settle()
    expect(f.forgePanel.continueInProject).toHaveBeenCalledWith(S1)
    expect(f.notice()).toBeNull()

    f.forgePanel.continueInProject.mockResolvedValueOnce(REFUSED.busy)
    f.progress(S1).leave()
    await settle()
    expect(f.notice()).toMatchObject({ key: 'toast.leaveFailed', tone: 'failure' })
    await f.dispose()
  })
})

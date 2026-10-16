// @vitest-environment jsdom
/** Forge tab body: connection states, the checkout row, the sign-in banner, the change request list, and tab visibility. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type { MergeRequest } from '@deepseek-ai/dsh-experimental-forge/types'
import type { PaneId, SidebarRightTabInfo, TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ForgeTab, type ForgeTabProps } from '../src/client/ForgeTab.tsx'
import { en } from '../src/client/locales.ts'
import type { PanelSnapshot } from '../src/client/source.ts'
import css from '../src/client/ForgeTab.module.css'
import type { ForgePanelChangeRequest, ForgePanelState } from '../src/types.ts'
import { created, entry, ready, removed, snapshot, worktree } from './client-fixtures.client.ts'

afterEach(cleanup)

const t = makeTranslate(en)
const unused = (): never => { throw new Error('the forge tab does not call this tab action') }

/** Tab information of a forge tab whose visibility the test sets. */
function tabInfo(visible: boolean): SidebarRightTabInfo {
  return {
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'pane-1' as PaneId },
    tab: {
      id: 'tab-forge' as TabId,
      kind: 'forge-panel',
      contentId: 'sidebar://forge-panel',
      title: en['tab.title'],
      visible,
      navigation: { address: 'sidebar://forge-panel', params: undefined, revision: 0 },
      signal: new AbortController().signal,
      actions: { bindCommands: () => () => {}, openResource: unused, openTab: unused, close: unused },
    },
  }
}

function tab(state: ForgePanelState | null, options: { disconnected?: boolean; visible?: boolean; home?: string } = {}) {
  const panel = createSnapshotStore<PanelSnapshot>({ state, disconnected: options.disconnected ?? false })
  const host = createSnapshotStore<RemoteHostFacts>({ home: options.home, isLoopback: true })
  const visibility = createSnapshotStore<boolean>(options.visible ?? true)
  const useVisibility = bindSnapshotSelector(visibility)
  const reconnect = vi.fn<() => void>()
  const refresh = vi.fn<() => void>()
  const remove = vi.fn<(entry: ForgePanelChangeRequest) => void>()
  const markReady = vi.fn<(entry: ForgePanelChangeRequest) => Promise<void>>(async () => {})
  const merge = vi.fn<(entry: ForgePanelChangeRequest, request: MergeRequest) => Promise<void>>(async () => {})
  const restore = vi.fn<() => void>()
  const openLink = vi.fn<(url: string) => void>()
  const copyText = vi.fn<(text: string) => void>()
  const reportVisible = vi.fn<(visible: boolean) => void>()
  const props: ForgeTabProps = {
    useTabInfo: () => tabInfo(useVisibility(current => current)),
    usePanel: bindSnapshotSelector(panel),
    useHost: bindSnapshotSelector(host),
    reconnect, refresh, remove, markReady, merge, restore, openLink, copyText, reportVisible,
    t,
  }
  const view = render(<ForgeTab {...props} />)
  return { view, panel, visibility, reconnect, refresh, remove, markReady, merge, restore, openLink, copyText, reportVisible }
}

/** The checkout row, or null when the tab shows none. */
function checkoutRow(view: ReturnType<typeof render>): HTMLElement | null {
  const row = view.container.querySelector(`.${css.checkout}`)
  return row instanceof HTMLElement ? row : null
}

/** The expansion state of each rendered card, in list order. */
function expansion(view: ReturnType<typeof render>): boolean[] {
  return [...view.container.querySelectorAll('[data-forge-change]')].map(card => card.hasAttribute('data-expanded'))
}

describe('ForgeTab connection', () => {
  it('centers a spinner until the first state arrives', () => {
    const b = tab(null)
    expect(b.view.container.querySelector('[data-state="ongoing"]')).not.toBeNull()
    expect(b.view.container.querySelector('[data-forge-panel]')).toBeNull()
    expect(b.view.queryByRole('status')).toBeNull()

    act(() => { b.panel.set({ state: ready(), disconnected: false }) })
    expect(b.view.container.querySelector('[data-forge-panel]')).not.toBeNull()
  })

  it('replaces the spinner with a reconnect notice while disconnected', () => {
    const b = tab(null, { disconnected: true })
    expect(b.view.container.querySelector('[data-state="ongoing"]')).toBeNull()
    const status = b.view.getByRole('status')
    expect(within(status).getByText(en['stream.failed'])).toBeTruthy()
    fireEvent.click(within(status).getByRole('button', { name: en.retry }))
    expect(b.reconnect).toHaveBeenCalledOnce()
  })

  it('keeps the last panel state and adds the reconnect notice while disconnected', () => {
    const b = tab(ready(), { disconnected: true })
    const root = b.view.container.querySelector('[data-forge-panel]')
    if (!(root instanceof HTMLElement)) throw new Error('no panel')
    expect(root.firstElementChild?.getAttribute('role')).toBe('status')
    fireEvent.click(within(root).getByRole('button', { name: en.retry }))
    expect(b.reconnect).toHaveBeenCalledOnce()

    act(() => { b.panel.set({ state: ready(), disconnected: false }) })
    expect(b.view.queryByRole('status')).toBeNull()
  })
})

describe('ForgeTab checkout', () => {
  it('shows no checkout row while the first inspection runs', () => {
    const b = tab(ready({ checkout: { state: 'pending' } }))
    expect(checkoutRow(b.view)).toBeNull()
    expect(b.view.getByText('Change requests of this Session · 0')).toBeTruthy()
  })

  it('explains a directory outside a Git checkout', () => {
    const b = tab(ready({ checkout: { state: 'none' } }))
    expect(checkoutRow(b.view)?.textContent).toBe(en['checkout.none'])
  })

  it('shows a failed inspection and its message on hover', () => {
    const b = tab(ready({ checkout: { state: 'failed', message: 'git status failed (128): fatal' } }))
    const row = checkoutRow(b.view)
    if (row === null) throw new Error('no checkout row')
    expect(row.textContent).toBe(en['checkout.failed'])
    fireEvent.mouseEnter(row)
    expect(b.view.getByRole('tooltip').textContent).toBe('git status failed (128): fatal')
  })

  it('names the branch and kind of the project directory and shows its path on hover', () => {
    const b = tab(ready(), { home: '/work' })
    const row = checkoutRow(b.view)
    if (row === null) throw new Error('no checkout row')
    expect(row.textContent).toBe(`main${en['checkout.project']}`)
    fireEvent.mouseEnter(row.querySelector(`.${css.checkoutName}`)!)
    expect(b.view.getByRole('tooltip').textContent).toBe('Project directory: ~/repo')
  })

  it('names a detached HEAD with its commit', () => {
    const b = tab(ready({}, { branch: null }))
    expect(checkoutRow(b.view)?.textContent).toBe(`${en['checkout.detached']}·0a1b2c3${en['checkout.project']}`)
  })

  it('calls a linked worktree another tool created a worktree', () => {
    const b = tab(ready({}, { linked: true }))
    expect(checkoutRow(b.view)?.textContent).toBe(`main${en['checkout.worktree']}`)
  })

  it.each([
    ['its base branch', created({ path: '/work/repo-dsh' }), 'Worktree · from main'],
    ['the commit it started from', created({ path: '/work/repo-dsh', from: null, baseCommit: '0123456789abcdef' }), 'Worktree · from 0123456'],
  ])('names the worktree this Session created with %s', (_label, made, kind) => {
    const b = tab(ready({ directory: '/work/repo-dsh', worktree: worktree({ created: made }) }, { root: '/work/repo-dsh', branch: 'other', linked: true }))
    expect(checkoutRow(b.view)?.textContent).toBe(`dsh/0a1b2c3d${kind}`)
  })

  it('names a removed worktree and restores it on request', () => {
    const b = tab(removed())
    const row = checkoutRow(b.view)
    if (row === null) throw new Error('no checkout row')
    expect(row.hasAttribute('data-missing')).toBe(true)
    expect(within(row).getByText('dsh/0a1b2c3d')).toBeTruthy()
    expect(within(row).getByText(en['missing.title'])).toBeTruthy()
    fireEvent.click(within(row).getByRole('button', { name: en['checkout.restore'] }))
    expect(b.restore).toHaveBeenCalledOnce()
  })
})

describe('ForgeTab sign-in banner', () => {
  it('offers the GitHub CLI sign-in command for an unauthenticated GitHub host', () => {
    const b = tab(ready({ readiness: { state: 'unauthenticated', message: 'not logged in' } }))
    const banner = b.view.getByRole('status')
    expect(within(banner).getByText('Sign in to github.com to show change request status')).toBeTruthy()
    expect(within(banner).getByText('gh auth login --hostname github.com').tagName).toBe('CODE')
    expect(within(banner).queryByText('not logged in')).toBeNull()
    fireEvent.click(within(banner).getByRole('button', { name: en['signin.copy'] }))
    expect(b.copyText).toHaveBeenCalledWith('gh auth login --hostname github.com')
  })

  it.each([
    ['with its message', 'token expired', ['Sign in to gitlab.example.test to show change request status', 'token expired']],
    ['without a message', null, ['Sign in to gitlab.example.test to show change request status']],
  ])('asks to sign in to another code host %s', (_label, message, texts) => {
    const b = tab(ready({
      repository: { forge: 'gitlab', host: 'gitlab.example.test', owner: 'octo', name: 'demo' },
      readiness: { state: 'unauthenticated', message },
    }))
    const banner = b.view.getByRole('status')
    expect([...banner.children].map(child => child.textContent)).toEqual(texts)
    expect(within(banner).queryByRole('button')).toBeNull()
  })

  it.each([
    ['with its message', 'spawn gh ENOENT', 'Change requests on github.com could not be read: spawn gh ENOENT'],
    ['without a message', null, 'Change requests on github.com could not be read: '],
  ])('explains an unreachable host %s', (_label, message, text) => {
    const b = tab(ready({ readiness: { state: 'unavailable', message } }))
    expect(b.view.getByRole('status').textContent).toBe(text)
  })

  it.each([
    ['sign-in is unknown', ready({ readiness: null })],
    ['the host is signed in', ready()],
    ['no provider serves the repository', ready({ repository: null, readiness: { state: 'unauthenticated', message: 'not logged in' } })],
  ])('shows no banner while %s', (_label, state) => {
    const b = tab(state)
    expect(b.view.queryByRole('status')).toBeNull()
  })
})

describe('ForgeTab change requests', () => {
  it('shows the empty state and refreshes on request', () => {
    const b = tab(ready())
    expect(b.view.getByText('Change requests of this Session · 0')).toBeTruthy()
    expect(b.view.getByText(en['changes.empty'])).toBeTruthy()
    expect(b.view.getByText(en['changes.emptyHint'])).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: en.refresh }))
    expect(b.refresh).toHaveBeenCalledOnce()
  })

  it.each([
    ['open', snapshot(1)],
    ['draft', snapshot(1, { draft: true })],
  ])('expands the only %s change request by default', (_label, only) => {
    const b = tab(ready({ changeRequests: [entry(1, only), entry(2, snapshot(2, { state: 'merged' })), entry(3, null)] }))
    expect(b.view.getByText('Change requests of this Session · 3')).toBeTruthy()
    expect(expansion(b.view)).toEqual([true, false, false])
  })

  it('collapses every card while several change requests are open', () => {
    const b = tab(ready({ changeRequests: [entry(1, snapshot(1)), entry(2, snapshot(2))] }))
    expect(expansion(b.view)).toEqual([false, false])
  })

  it('keeps the cards the user expanded and collapsed across later updates', () => {
    const b = tab(ready({ changeRequests: [entry(1, snapshot(1)), entry(2, snapshot(2, { state: 'closed' }))] }))
    expect(expansion(b.view)).toEqual([true, false])
    fireEvent.click(b.view.getByRole('button', { name: 'Collapse #1' }))
    fireEvent.click(b.view.getByRole('button', { name: 'Expand #2' }))
    expect(expansion(b.view)).toEqual([false, true])

    act(() => { b.panel.set({ state: ready({ changeRequests: [entry(1, snapshot(1, { title: 'Renamed' })), entry(2, snapshot(2, { state: 'closed' }))] }), disconnected: false }) })
    expect(expansion(b.view)).toEqual([false, true])
  })

  it('wires the card actions to the tab actions', () => {
    const value = entry(7, snapshot(7))
    const b = tab(ready({ changeRequests: [value, entry(8, { code: 'unavailable', message: 'down' })] }))
    const card = b.view.container.querySelector('[data-forge-change="https://github.com/octo/demo/pull/7"]')
    if (!(card instanceof HTMLElement)) throw new Error('no card')
    // The only open change request starts expanded.
    fireEvent.click(within(card).getByRole('button', { name: en['change.view'] }))
    fireEvent.click(within(card).getByRole('button', { name: en['change.copy'] }))
    fireEvent.click(within(card).getByRole('button', { name: 'Remove #7 from this Session' }))
    fireEvent.click(b.view.getByRole('button', { name: en.retry }))
    expect(b.openLink).toHaveBeenCalledWith('https://github.com/octo/demo/pull/7')
    expect(b.copyText).toHaveBeenCalledWith('https://github.com/octo/demo/pull/7')
    expect(b.remove).toHaveBeenCalledWith(value)
    expect(b.refresh).toHaveBeenCalledOnce()
  })

  it('wires ready for review and merge to the tab actions', async () => {
    const draft = entry(7, snapshot(7, { draft: true }))
    const mergeable = entry(8, snapshot(8, { mergeReady: true, headSha: 'b'.repeat(40) }))
    const b = tab(ready({ changeRequests: [draft, mergeable] }))
    // Two open change requests both start collapsed.
    fireEvent.click(b.view.getByRole('button', { name: 'Expand #7' }))
    fireEvent.click(b.view.getByRole('button', { name: 'Expand #8' }))

    await act(async () => {
      fireEvent.click(b.view.getByRole('button', { name: en['change.markReady'] }))
    })
    fireEvent.click(b.view.getByRole('button', { name: en['change.merge'] }))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: en['change.mergeConfirm'] }))
    })
    expect(b.markReady).toHaveBeenCalledWith(draft)
    expect(b.merge).toHaveBeenCalledWith(mergeable, { method: 'squash', headSha: 'b'.repeat(40) })
  })

  it('dates a finished change request from the current time', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-09T12:00:00Z') })
    try {
      const b = tab(ready({ changeRequests: [entry(1, snapshot(1, { state: 'merged', closedAt: '2026-10-09T11:00:00Z' }))] }))
      expect(b.view.getByText('Merged into main · 1 h ago')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ForgeTab visibility', () => {
  it('reports the tab visibility as it changes and hidden once unmounted', () => {
    const b = tab(ready())
    expect(b.reportVisible.mock.calls).toEqual([[true]])

    act(() => { b.visibility.set(false) })
    act(() => { b.visibility.set(true) })
    expect(b.reportVisible.mock.calls).toEqual([[true], [false], [true]])

    b.view.unmount()
    expect(b.reportVisible.mock.calls).toEqual([[true], [false], [true], [false]])
  })

  it('reports a tab that mounts hidden, also before the first state', () => {
    const b = tab(null, { visible: false })
    expect(b.reportVisible.mock.calls).toEqual([[false]])
  })
})

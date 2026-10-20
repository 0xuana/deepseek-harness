// @vitest-environment jsdom
/** Forge tab body: connection states, the checkout row, the sign-in banner, the change request list, and tab visibility. */
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InputActions, TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PaneId, SidebarRightTabInfo, TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ForgeTab, type ForgeTabProps } from '../src/client/ForgeTab.tsx'
import { en } from '../src/client/locales.ts'
import type { PanelSnapshot } from '../src/client/source.ts'
import css from '../src/client/ForgeTab.module.css'
import type { ForgePanelChangeRequest, ForgePanelState } from '../src/types.ts'
import { created, entry, ready, snapshot, worktree } from './client-fixtures.client.ts'

afterEach(cleanup)

const t = makeTranslate(en)
const unused = (): never => { throw new Error('the forge tab does not call this input action') }

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

function tab(state: ForgePanelState | null, options: { disconnected?: boolean; visible?: boolean; inserted?: boolean } = {}) {
  const panel = createSnapshotStore<PanelSnapshot>({ state, disconnected: options.disconnected ?? false })
  const visibility = createSnapshotStore<boolean>(options.visible ?? true)
  const useVisibility = bindSnapshotSelector(visibility)
  const span: TokenSpan = { start: 4, end: 4, draftRev: 2 }
  const captureInsertion = vi.fn(() => span)
  const insertText = vi.fn((_text: string, _span: TokenSpan) => options.inserted ?? true)
  const inputActions: InputActions = {
    captureInsertion, insertText, setDraft: unused, persistDraft: unused,
    addAttachments: unused, removeAttachment: unused, pruneAttachments: unused, submit: unused,
  }
  const reconnect = vi.fn<() => void>()
  const refresh = vi.fn<() => void>()
  const remove = vi.fn<(entry: ForgePanelChangeRequest) => void>()
  const openLink = vi.fn<(url: string) => void>()
  const copyText = vi.fn<(text: string) => void>()
  const report = vi.fn<ForgeTabProps['report']>()
  const reportVisible = vi.fn<(visible: boolean) => void>()
  const props: ForgeTabProps = {
    useTabInfo: () => tabInfo(useVisibility(current => current)),
    inputActions,
    usePanel: bindSnapshotSelector(panel),
    reconnect, refresh, remove, openLink, copyText, report, reportVisible,
    t,
  }
  const view = render(<ForgeTab {...props} />)
  return {
    view, panel, visibility, span, captureInsertion, insertText, reconnect, refresh, remove, openLink, copyText, report, reportVisible,
  }
}

/** The checkout row, or null when the tab shows none. */
function checkoutRow(view: ReturnType<typeof render>): HTMLElement | null {
  const row = view.container.querySelector(`.${css.checkout}`)
  return row instanceof HTMLElement ? row : null
}

/** The heads of the rendered change request cards, in list order. */
function heads(view: ReturnType<typeof render>): HTMLElement[] {
  return [...view.container.querySelectorAll(`.${css.changeHead}`)].filter(head => head instanceof HTMLElement)
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
    expect(b.view.getByText('Pull requests of this Session · 0')).toBeTruthy()
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

  it('names the branch of the current checkout and shows its root on hover', () => {
    const b = tab(ready())
    const row = b.view.container.querySelector('[data-forge-checkout]')
    if (!(row instanceof HTMLElement)) throw new Error('no checkout row')
    expect([...row.querySelectorAll('span')].map(span => span.textContent)).toEqual([en['checkout.branch'], 'main', en['checkout.current']])
    fireEvent.mouseEnter(row)
    expect(b.view.getByRole('tooltip').textContent).toBe('/work/repo')
  })

  it('names a detached HEAD', () => {
    const b = tab(ready({}, { branch: null }))
    expect(within(checkoutRow(b.view)!).getByText(en['checkout.detached'])).toBeTruthy()
  })

  it.each([
    ['its base branch', created({ path: '/work/repo-dsh' }), 'From main'],
    ['the commit it started from', created({ path: '/work/repo-dsh', from: null, baseCommit: '0123456789abcdef' }), 'From 0123456'],
  ])('names the worktree this Session created with %s', (_label, made, base) => {
    const b = tab(ready({ directory: '/work/repo-dsh', worktree: worktree({ created: made }) }, { root: '/work/repo-dsh', branch: 'other' }))
    const row = b.view.container.querySelector('[data-forge-checkout]')
    if (!(row instanceof HTMLElement)) throw new Error('no checkout row')
    expect([...row.querySelectorAll('span')].map(span => span.textContent)).toEqual([en['checkout.worktree'], 'dsh/0a1b2c3d', base])
  })

  it('names the current checkout once the Session works outside the worktree it created', () => {
    const b = tab(ready({ worktree: worktree({ created: created({ path: '/work/repo-dsh' }) }) }))
    const row = b.view.container.querySelector('[data-forge-checkout]')
    if (!(row instanceof HTMLElement)) throw new Error('no checkout row')
    expect([...row.querySelectorAll('span')].map(span => span.textContent)).toEqual([en['checkout.branch'], 'main', en['checkout.current']])
  })
})

describe('ForgeTab sign-in banner', () => {
  it('offers the GitHub CLI sign-in command for an unauthenticated GitHub host', () => {
    const b = tab(ready({ readiness: { state: 'unauthenticated', message: 'not logged in' } }))
    const banner = b.view.getByRole('status')
    expect(within(banner).getByText('Sign in to github.com to show pull request status')).toBeTruthy()
    expect(within(banner).getByText('gh auth login --hostname github.com').tagName).toBe('CODE')
    expect(within(banner).queryByText('not logged in')).toBeNull()
    fireEvent.click(within(banner).getByRole('button', { name: en['signin.copy'] }))
    expect(b.copyText).toHaveBeenCalledWith('gh auth login --hostname github.com')
  })

  it.each([
    ['with its message', 'token expired', ['Sign in to gitlab.example.test to show pull request status', 'token expired']],
    ['without a message', null, ['Sign in to gitlab.example.test to show pull request status']],
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
    ['with its message', 'spawn gh ENOENT', 'Pull requests on github.com could not be read: spawn gh ENOENT'],
    ['without a message', null, 'Pull requests on github.com could not be read: '],
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
    expect(b.view.getByText('Pull requests of this Session · 0')).toBeTruthy()
    expect(b.view.getByText(en['changes.empty'])).toBeTruthy()
    expect(b.view.getByText(en['changes.emptyHint'])).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: en.refresh }))
    expect(b.refresh).toHaveBeenCalledOnce()
  })

  it('lists the bound change requests and expands one at a time', () => {
    const b = tab(ready({ changeRequests: [entry(1, snapshot(1)), entry(2, null)] }))
    expect(b.view.getByText('Pull requests of this Session · 2')).toBeTruthy()
    expect(b.view.queryByText(en['changes.empty'])).toBeNull()
    const expanded = () => heads(b.view).map(head => head.getAttribute('aria-expanded'))
    expect(expanded()).toEqual(['false', 'false'])

    fireEvent.click(heads(b.view)[0]!)
    expect(expanded()).toEqual(['true', 'false'])
    fireEvent.click(heads(b.view)[1]!)
    expect(expanded()).toEqual(['false', 'true'])
    fireEvent.click(heads(b.view)[1]!)
    expect(expanded()).toEqual(['false', 'false'])
  })

  it('wires the card actions to the tab actions', () => {
    const value = entry(7, snapshot(7))
    const b = tab(ready({ changeRequests: [value, entry(8, { code: 'unavailable', message: 'down' })] }))
    fireEvent.click(heads(b.view)[0]!)
    const card = b.view.container.querySelector('[data-forge-change="https://github.com/octo/demo/pull/7"]')
    if (!(card instanceof HTMLElement)) throw new Error('no card')

    fireEvent.click(within(card).getByRole('button', { name: en['change.view'] }))
    fireEvent.click(within(card).getByRole('button', { name: en['change.copy'] }))
    fireEvent.click(within(card).getByRole('button', { name: en['change.remove'] }))
    fireEvent.click(b.view.getByRole('button', { name: en.retry }))
    expect(b.openLink).toHaveBeenCalledWith('https://github.com/octo/demo/pull/7')
    expect(b.copyText).toHaveBeenCalledWith('https://github.com/octo/demo/pull/7')
    expect(b.remove).toHaveBeenCalledWith(value)
    expect(b.refresh).toHaveBeenCalledOnce()
  })

  it('adds a change request URL to the composer at the captured insertion point', () => {
    const b = tab(ready({ changeRequests: [entry(7, snapshot(7))] }))
    fireEvent.click(heads(b.view)[0]!)
    fireEvent.click(b.view.getByRole('button', { name: en['change.addToChat'] }))
    expect(b.captureInsertion).toHaveBeenCalledOnce()
    expect(b.insertText).toHaveBeenCalledWith('https://github.com/octo/demo/pull/7 ', b.span)
    expect(b.report).not.toHaveBeenCalled()
  })

  it('reports a composer that refuses the insertion', () => {
    const b = tab(ready({ changeRequests: [entry(7, snapshot(7))] }), { inserted: false })
    fireEvent.click(heads(b.view)[0]!)
    fireEvent.click(b.view.getByRole('button', { name: en['change.addToChat'] }))
    expect(b.report).toHaveBeenCalledWith('toast.chatFailed')
  })

  it('dates a finished change request from the current time', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-09T12:00:00Z') })
    try {
      const b = tab(ready({ changeRequests: [entry(1, snapshot(1, { state: 'merged', closedAt: '2026-10-09T11:00:00Z' }))] }))
      expect(b.view.getByText('Merged · 1 h ago')).toBeTruthy()
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

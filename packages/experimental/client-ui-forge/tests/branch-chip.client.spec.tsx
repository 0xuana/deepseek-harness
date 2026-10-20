// @vitest-environment jsdom
/** Session header branch label: when it shows, the worktree a Session started in, its removal, and the current branch. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { BranchChip } from '../src/client/BranchChip.tsx'
import { en } from '../src/client/locales.ts'
import type { PanelSnapshot } from '../src/client/source.ts'
import type { ForgePanelState } from '../src/types.ts'
import { created, ready, removed, worktree } from './client-fixtures.client.ts'

afterEach(cleanup)

const t = makeTranslate(en)

function chip(state: ForgePanelState | null) {
  const panel = createSnapshotStore<PanelSnapshot>({ state, disconnected: false })
  const view = render(<BranchChip usePanel={bindSnapshotSelector(panel)} t={t} />)
  const label = (): HTMLElement => {
    const element = view.container.querySelector('[data-forge-branch]')
    if (!(element instanceof HTMLElement)) throw new Error('no branch label')
    return element
  }
  const publish = (next: ForgePanelState): void => {
    act(() => { panel.set({ state: next, disconnected: false }) })
  }
  return { view, label, publish }
}

/** The tooltip of the label after the pointer enters it. */
function detail(label: HTMLElement): string | null {
  fireEvent.mouseEnter(label)
  return screen.getByRole('tooltip').textContent
}

/** Panel state of a Session that works in the worktree it created at `/work/repo-dsh`. */
function inWorktree(made = created()): ForgePanelState {
  return ready({ directory: '/work/repo-dsh', worktree: worktree({ created: made }) }, { root: '/work/repo-dsh', branch: 'other' })
}

describe('BranchChip visibility', () => {
  it.each([
    ['before the first state', null],
    ['while the first inspection runs', ready({ checkout: { state: 'pending' } })],
    ['outside a Git checkout', ready({ checkout: { state: 'none' } })],
    ['when the inspection failed', ready({ checkout: { state: 'failed', message: 'git status failed' } })],
    ['on a detached HEAD', ready({}, { branch: null })],
    ['on a detached HEAD outside the worktree the Session created', ready({ worktree: worktree({ created: created() }) }, { branch: null })],
  ])('renders nothing %s', (_label, state) => {
    expect(chip(state).view.container.innerHTML).toBe('')
  })
})

describe('BranchChip label', () => {
  it('names the current branch and shows the checkout on hover', () => {
    const b = chip(ready())
    const label = b.label()
    expect(label.textContent).toBe('main')
    expect(label.hasAttribute('data-missing')).toBe(false)
    expect(detail(label)).toBe('Current checkout at /work/repo')
  })

  it.each([
    ['its base branch', created(), 'Worktree at /work/repo-dsh, created from main'],
    ['the commit it started from', created({ from: null, baseCommit: '0123456789abcdef' }), 'Worktree at /work/repo-dsh, created from 0123456'],
  ])('names the branch of the worktree the Session created, with %s on hover', (_label, made, expected) => {
    const label = chip(inWorktree(made)).label()
    expect(label.textContent).toBe('dsh/0a1b2c3d')
    expect(label.hasAttribute('data-missing')).toBe(false)
    expect(detail(label)).toBe(expected)
  })

  it('names the current branch once the Session works outside the worktree it created', () => {
    const b = chip(ready({ worktree: worktree({ created: created() }) }))
    expect(b.label().textContent).toBe('main')
    expect(detail(b.label())).toBe('Current checkout at /work/repo')
  })

  it('follows the panel state from the first inspection into the created worktree', () => {
    const b = chip(ready({ checkout: { state: 'pending' } }))
    expect(b.view.container.innerHTML).toBe('')
    b.publish(ready())
    expect(b.label().textContent).toBe('main')
    b.publish(inWorktree())
    expect(b.label().textContent).toBe('dsh/0a1b2c3d')
  })
})

describe('BranchChip removed worktree', () => {
  it('names the branch of the removed worktree the Session works in, marked missing, with its path on hover', () => {
    const label = chip(removed()).label()
    expect(label.textContent).toBe('dsh/0a1b2c3d')
    expect(label.hasAttribute('data-missing')).toBe(true)
    expect(detail(label)).toBe('Worktree removed: /work/repo-dsh')
  })

  it('returns to the worktree label once the worktree is restored', () => {
    const b = chip(removed(false))
    expect(b.label().hasAttribute('data-missing')).toBe(true)
    b.publish(inWorktree())
    expect(b.label().textContent).toBe('dsh/0a1b2c3d')
    expect(b.label().hasAttribute('data-missing')).toBe(false)
    expect(detail(b.label())).toBe('Worktree at /work/repo-dsh, created from main')
  })

  it('names the current branch when the panel reports a removal without the worktree record', () => {
    const label = chip(ready({ worktree: worktree({ missing: { branchExists: true } }) })).label()
    expect(label.textContent).toBe('main')
    expect(label.hasAttribute('data-missing')).toBe(false)
  })
})

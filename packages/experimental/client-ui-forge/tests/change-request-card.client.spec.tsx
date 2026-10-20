// @vitest-environment jsdom
/** One change request card: the collapsed status summary, the read failure notices, and the expanded details and actions. */
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ForgeFailure } from '@deepseek-ai/dsh-experimental-forge/types'
import { ChangeRequestCard, type ChangeRequestActions } from '../src/client/ChangeRequestCard.tsx'
import { en } from '../src/client/locales.ts'
import css from '../src/client/ForgeTab.module.css'
import type { ForgePanelChangeRequest } from '../src/types.ts'
import { check, entry, snapshot, unserved } from './client-fixtures.client.ts'

afterEach(cleanup)

const t = makeTranslate(en)
const NOW = Date.parse('2026-10-09T12:00:00Z')
/** Minus sign (U+2212) the diff size puts before the deleted line count. */
const MINUS = '\u2212'

/** Render one card inside its list, with every action recorded unless `actions` replaces it. */
function card(value: ForgePanelChangeRequest, options: { expanded?: boolean; actions?: Partial<ChangeRequestActions> } = {}) {
  const openLink = vi.fn<(url: string) => void>()
  const copyLink = vi.fn<(url: string) => void>()
  const retry = vi.fn<() => void>()
  const addToChat = vi.fn<(url: string) => void>()
  const remove = vi.fn<(entry: ForgePanelChangeRequest) => void>()
  const onToggle = vi.fn<() => void>()
  const actions: ChangeRequestActions = { openLink, copyLink, retry, addToChat, remove, ...options.actions }
  const view = render(
    <ul>
      <ChangeRequestCard entry={value} expanded={options.expanded ?? false} onToggle={onToggle} now={NOW} actions={actions} t={t} />
    </ul>,
  )
  const item = view.container.querySelector('[data-forge-change]')
  const head = item?.querySelector(`.${css.changeHead}`)
  if (!(item instanceof HTMLElement) || !(head instanceof HTMLElement)) throw new Error('no change request card')
  return { view, item, head, openLink, copyLink, retry, addToChat, remove, onToggle }
}

/** The value a details row shows next to its label. */
function rowValue(item: HTMLElement, label: string): HTMLElement {
  const value = within(item).getByText(label).nextElementSibling
  if (!(value instanceof HTMLElement)) throw new Error(`no value next to ${label}`)
  return value
}

/** Name and time of each listed check, in display order. */
function checkRows(item: HTMLElement): string[] {
  return [...item.querySelectorAll(`.${css.checks} .${css.check}`)]
    .map(row => `${row.querySelector(`.${css.code}`)?.textContent ?? ''}|${row.querySelector(`.${css.value}`)?.textContent ?? ''}`)
}

describe('collapsed ChangeRequestCard', () => {
  it('summarizes an open change request by title, number, head branch, diff size, and checks', () => {
    const b = card(entry(7, snapshot(7, { headBranch: 'feat/login' })))
    expect(b.head.getAttribute('aria-expanded')).toBe('false')
    expect(within(b.head).getByText('Change 7')).toBeTruthy()
    expect(within(b.head).getByText('#7')).toBeTruthy()
    expect(within(b.head).getByText('·')).toBeTruthy()
    expect(within(b.head).getByText('feat/login')).toBeTruthy()
    expect(within(b.head).getByText('+12')).toBeTruthy()
    expect(within(b.head).getByText(`${MINUS}3`)).toBeTruthy()
    expect(within(b.head).getByText(en['change.ci.passed']).querySelector('[data-state="done"]')).not.toBeNull()
    expect(b.head.querySelector('[data-flag]')).toBeNull()
    expect(within(b.item).queryByRole('button', { name: en['change.view'] })).toBeNull()

    fireEvent.click(b.head)
    expect(b.onToggle).toHaveBeenCalledOnce()
  })

  it.each([
    ['an open', { state: 'open', draft: false }, 'open'],
    ['a draft', { state: 'open', draft: true }, 'draft'],
    ['a merged', { state: 'merged' }, 'merged'],
    ['a closed', { state: 'closed' }, 'closed'],
  ] as const)('tones the glyph of %s change request', (_name, overrides, tone) => {
    const b = card(entry(7, snapshot(7, overrides)))
    expect(b.head.querySelector(`.${css.glyph}`)?.getAttribute('data-tone')).toBe(tone)
  })

  it('gives the glyph of a change request without a snapshot the unknown tone', () => {
    expect(card(unserved('https://gitlab.example/group/app/-/merge_requests/3')).head.querySelector(`.${css.glyph}`)?.getAttribute('data-tone')).toBe('unknown')
  })

  it.each([
    ['no checks', { checksRollup: 'none' }, en['change.ci.none'], undefined],
    ['running checks', { checksRollup: 'pending' }, en['change.ci.running'], 'ongoing'],
    ['listed failed checks', {
      checksRollup: 'failure',
      checks: [check('lint', { state: 'failure' }), check('test'), check('types', { state: 'failure' })],
    }, '2 failed', 'error'],
    ['failed checks the host did not list', { checksRollup: 'failure', checksTruncated: true }, en['change.ci.failedUnlisted'], 'error'],
  ] as const)('states %s', (_label, overrides, text, dot) => {
    const ci = within(card(entry(1, snapshot(1, overrides))).head).getByText(text)
    expect(ci.querySelector('[data-state]')?.getAttribute('data-state')).toBe(dot)
    expect(ci.getAttribute('data-tone')).toBe(dot === 'error' ? 'error' : null)
  })

  it.each([
    ['requested changes', { reviewDecision: 'changes-requested', mergeability: 'conflicting' }, 'changesRequested', en['change.flag.changesRequested']],
    ['merge conflicts', { mergeability: 'conflicting', draft: true }, 'conflicting', en['change.flag.conflicting']],
    ['draft state', { draft: true }, 'draft', en['change.flag.draft']],
  ] as const)('flags %s after the checks', (_label, overrides, flag, text) => {
    const b = card(entry(1, snapshot(1, overrides)))
    expect(b.head.querySelector('[data-flag]')?.getAttribute('data-flag')).toBe(flag)
    expect(within(b.head).getByText(text)).toBeTruthy()
  })

  it.each([
    ['merged three hours ago', { state: 'merged', closedAt: '2026-10-09T09:00:00Z' }, 'merged', 'Merged · 3 h ago'],
    ['closed without a close time', { state: 'closed' }, 'closed', en['change.state.closed']],
    ['closed at a time that does not parse', { state: 'closed', closedAt: 'last week' }, 'closed', en['change.state.closed']],
  ] as const)('states a change request %s instead of its checks', (_label, overrides, tone, text) => {
    const b = card(entry(1, snapshot(1, { ...overrides, checksRollup: 'failure', reviewDecision: 'changes-requested' })))
    const finished = within(b.head).getByText(text)
    expect(finished.getAttribute('data-tone')).toBe(tone)
    expect(within(b.head).getByText('+12')).toBeTruthy()
    expect(within(b.head).queryByText(en['change.ci.failedUnlisted'])).toBeNull()
    expect(b.head.querySelector('[data-flag]')).toBeNull()
  })

  it('names the URL and the number of a change request before its first poll', () => {
    const b = card(entry(1, null))
    expect(within(b.head).getByText('github.com/octo/demo/pull/1')).toBeTruthy()
    expect(within(b.head).getByText('#1')).toBeTruthy()
    expect(within(b.head).queryByText('·')).toBeNull()
    expect(within(b.head).getByText(en['change.loading']).querySelector('[data-state="ongoing"]')).not.toBeNull()
    expect(b.item.querySelector(`.${css.notice}`)).toBeNull()
  })

  it.each([
    ['not-found', en['change.failure.notFound']],
    ['unauthenticated', en['change.failure.unauthenticated']],
    ['unavailable', en['change.failure.unavailable']],
  ] as const)('explains a %s read failure and retries it', (code, text) => {
    const failure: ForgeFailure = { code, message: 'detail' }
    const b = card(entry(1, failure))
    expect(within(b.head).getByText('github.com/octo/demo/pull/1')).toBeTruthy()
    expect(within(b.head).queryByText(en['change.loading'])).toBeNull()
    const notice = b.item.querySelector(`.${css.notice}`)
    if (!(notice instanceof HTMLElement)) throw new Error('no failure notice')
    expect(within(notice).getByText(text)).toBeTruthy()

    fireEvent.click(within(notice).getByRole('button', { name: en.retry }))
    expect(b.retry).toHaveBeenCalledOnce()
    expect(b.openLink).not.toHaveBeenCalled()
  })

  it('keeps the last snapshot of a change request whose latest read failed, without its summary', () => {
    const b = card(entry(4, { code: 'unavailable', message: 'down' }, { kept: snapshot(4, { checksRollup: 'failure' }) }))
    expect(within(b.head).getByText('Change 4')).toBeTruthy()
    expect(within(b.head).getByText('feat')).toBeTruthy()
    expect(within(b.head).queryByText('+12')).toBeNull()
    expect(within(b.item).getByText(en['change.failure.unavailable'])).toBeTruthy()
  })

  it('opens a URL no provider serves instead of retrying it', () => {
    const b = card(unserved('http://example.test/review/latest'))
    expect(within(b.head).getByText('example.test/review/latest')).toBeTruthy()
    expect(b.head.querySelector(`.${css.metaRow}`)).toBeNull()
    expect(b.head.querySelector(`.${css.summary}`)).toBeNull()
    const notice = b.item.querySelector(`.${css.notice}`)
    if (!(notice instanceof HTMLElement)) throw new Error('no unserved notice')
    expect(within(notice).getByText(en['change.unserved'])).toBeTruthy()
    expect(within(notice).queryByRole('button', { name: en.retry })).toBeNull()

    fireEvent.click(within(notice).getByRole('button', { name: en['change.view'] }))
    expect(b.openLink).toHaveBeenCalledWith('http://example.test/review/latest')
  })

  it('reads the number of an unserved URL from its path', () => {
    const b = card(unserved('https://example.test/review/17'))
    expect(within(b.head).getByText('#17')).toBeTruthy()
  })

  it('shows the head branch and opens the snapshot URL of an unnumbered change request', () => {
    const b = card({ ...unserved('https://example.test/review/latest'), snapshot: snapshot(3, { url: 'https://example.test/review/latest#web' }) })
    expect(within(b.head).getByText('Change 3')).toBeTruthy()
    expect(within(b.head).getByText('feat')).toBeTruthy()
    expect(within(b.head).queryByText('·')).toBeNull()
    expect(within(b.head).queryByText(/^#/)).toBeNull()

    fireEvent.click(within(b.item).getByRole('button', { name: en['change.view'] }))
    expect(b.openLink).toHaveBeenCalledWith('https://example.test/review/latest#web')
  })
})

describe('expanded ChangeRequestCard', () => {
  it('shows the details of an open change request and runs its actions on the snapshot URL', () => {
    const value = entry(7, snapshot(7, { url: 'https://github.com/octo/demo/pull/7#web' }))
    const b = card(value, { expanded: true })
    expect(b.item.getAttribute('data-forge-change')).toBe('https://github.com/octo/demo/pull/7')
    expect(b.head.getAttribute('aria-expanded')).toBe('true')
    expect(rowValue(b.item, en['change.row.state']).textContent).toBe(`${en['change.state.open']} · ${en['change.origin.created']}`)
    expect(rowValue(b.item, en['change.row.checks']).textContent).toBe(en['change.ci.none'])
    expect(rowValue(b.item, en['change.row.review']).textContent).toBe(en['change.review.none'])
    expect(rowValue(b.item, en['change.row.merge']).textContent).toBe(en['change.merge.mergeable'])
    for (const label of [en['change.row.review'], en['change.row.merge']]) expect(rowValue(b.item, label).getAttribute('data-tone')).toBeNull()
    expect(within(b.item).getByRole('separator')).toBeTruthy()

    fireEvent.click(within(b.item).getByRole('button', { name: en['change.view'] }))
    fireEvent.click(within(b.item).getByRole('button', { name: en['change.copy'] }))
    fireEvent.click(within(b.item).getByRole('button', { name: en['change.addToChat'] }))
    fireEvent.click(within(b.item).getByRole('button', { name: en['change.remove'] }))
    expect(b.openLink).toHaveBeenCalledWith('https://github.com/octo/demo/pull/7#web')
    expect(b.copyLink).toHaveBeenCalledWith('https://github.com/octo/demo/pull/7#web')
    expect(b.addToChat).toHaveBeenCalledWith('https://github.com/octo/demo/pull/7#web')
    expect(b.remove).toHaveBeenCalledWith(value)
  })

  it.each([
    ['a draft found after a push', { draft: true }, 'discovered', 'Draft · Found after a push', en['change.merge.mergeable']],
    ['a tracked merged change request', { state: 'merged', mergeability: 'conflicting' }, 'tracked', 'Merged · Tracked', en['change.state.merged']],
    ['a closed change request', { state: 'closed' }, 'created', 'Closed · Created in this Session', en['change.state.closed']],
    ['an open change request whose mergeability is unknown', { mergeability: 'unknown' }, 'tracked', 'Ready for review · Tracked',
      en['change.merge.unknown']],
  ] as const)('states %s', (_label, overrides, origin, state, merge) => {
    const b = card(entry(1, snapshot(1, overrides), { origin }), { expanded: true })
    expect(rowValue(b.item, en['change.row.state']).textContent).toBe(state)
    expect(rowValue(b.item, en['change.row.merge']).textContent).toBe(merge)
    expect(rowValue(b.item, en['change.row.merge']).getAttribute('data-tone')).toBeNull()
  })

  it('marks merge conflicts of an open change request', () => {
    const b = card(entry(1, snapshot(1, { mergeability: 'conflicting' })), { expanded: true })
    expect(rowValue(b.item, en['change.row.merge']).textContent).toBe(en['change.merge.conflicting'])
    expect(rowValue(b.item, en['change.row.merge']).getAttribute('data-tone')).toBe('error')
  })

  it.each([
    ['an approval', { reviewDecision: 'approved' }, en['change.review.approved'], null],
    ['a required review', { reviewDecision: 'review-required' }, en['change.review.required'], null],
    ['requested changes', { reviewDecision: 'changes-requested' }, en['change.review.changesRequested'], 'error'],
    ['an approval with unresolved threads', { reviewDecision: 'approved', unresolvedThreads: 2 }, 'Approved · 2 unresolved', null],
    ['requested changes with an unresolved thread', { reviewDecision: 'changes-requested', unresolvedThreads: 1 },
      'Changes requested · 1 unresolved', 'error'],
  ] as const)('states the review of %s', (_label, overrides, text, tone) => {
    const value = rowValue(card(entry(1, snapshot(1, overrides)), { expanded: true }).item, en['change.row.review'])
    expect(value.textContent).toBe(text)
    expect(value.getAttribute('data-tone')).toBe(tone)
  })

  it('lists the checks failed first, then running, then the rest, with their times and links', () => {
    const checks = [
      check('build'),
      check('docs', { state: 'neutral' }),
      check('deploy', { state: 'pending', startedAt: null, completedAt: null }),
      check('lint', { state: 'failure', url: 'https://ci.example.test/lint', completedAt: '2026-10-09T11:00:00Z' }),
      check('e2e', { state: 'skipped', startedAt: null, completedAt: null }),
      check('test', { state: 'pending', completedAt: null }),
      check('package', { completedAt: null }),
      check('perf', { state: 'cancelled', startedAt: '2026-10-09T10:00:00Z', completedAt: '2026-10-09T11:30:20Z' }),
    ]
    const b = card(entry(1, snapshot(1, { checks, checksRollup: 'failure', checksTruncated: true })), { expanded: true })
    const toggle = within(b.item).getByText(en['change.row.checks']).closest('button')
    if (toggle === null) throw new Error('the checks row does not expand')
    const summary = rowValue(b.item, en['change.row.checks'])
    expect(summary.textContent).toBe('1 failed · 2 running · 2 passed · 3 not run')
    expect(summary.getAttribute('data-tone')).toBe('error')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(checkRows(b.item)).toEqual([])

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(checkRows(b.item)).toEqual([
      'lint|1h 0m', 'deploy|Queued', 'test|Running', 'build|1m 5s', 'package|', 'docs|1m 5s', 'e2e|', 'perf|1h 30m',
    ])
    const rows = [...b.item.querySelectorAll(`.${css.checks} .${css.check}`)]
    expect(rows[0]?.querySelector(`.${css.fail}`)).not.toBeNull()
    expect(rows.slice(1, 3).map(row => row.querySelector('[data-state]')?.getAttribute('data-state'))).toEqual(['ongoing', 'ongoing'])
    expect(rows[3]?.querySelector(`.${css.pass}`)).not.toBeNull()
    expect(rows.slice(5).map(row => row.querySelector('[data-state]')?.getAttribute('data-state'))).toEqual(['idle', 'idle', 'idle'])
    expect(rows.map(row => row.tagName)).toEqual(['BUTTON', 'DIV', 'DIV', 'DIV', 'DIV', 'DIV', 'DIV', 'DIV'])
    expect(within(b.item).getByText('Only the first 8 are listed')).toBeTruthy()

    fireEvent.click(rows[0]!)
    expect(b.openLink).toHaveBeenCalledWith('https://ci.example.test/lint')

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(checkRows(b.item)).toEqual([])
  })

  it.each([
    ['passed checks', [check('build'), check('test')], '2 passed', ['build|1m 5s', 'test|1m 5s']],
    ['running and skipped checks', [
      check('docs', { state: 'skipped', startedAt: null, completedAt: null }),
      check('test', { state: 'pending', completedAt: null }),
    ], '1 running · 1 not run', ['test|Running', 'docs|']],
  ])('counts %s without an error tone or a truncation note', (_label, checks, text, rows) => {
    const b = card(entry(1, snapshot(1, { checks, checksRollup: 'pending' })), { expanded: true })
    const summary = rowValue(b.item, en['change.row.checks'])
    expect(summary.textContent).toBe(text)
    expect(summary.getAttribute('data-tone')).toBeNull()
    fireEvent.click(within(b.item).getByText(en['change.row.checks']))
    expect(checkRows(b.item)).toEqual(rows)
    expect(b.item.querySelector(`.${css.truncated}`)).toBeNull()
  })

  it('shows only the link actions and the Session actions before the first poll', () => {
    const b = card(entry(1, null), { expanded: true })
    expect(within(b.item).queryByText(en['change.row.state'])).toBeNull()
    expect(within(b.item).queryByText(en['change.row.checks'])).toBeNull()
    expect(within(b.item).getByRole('separator')).toBeTruthy()
    fireEvent.click(within(b.item).getByRole('button', { name: en['change.view'] }))
    expect(b.openLink).toHaveBeenCalledWith('https://github.com/octo/demo/pull/1')
  })

  it.each([
    ['neither Session action', { addToChat: undefined, remove: undefined }, []],
    ['only adding to the chat', { remove: undefined }, [en['change.addToChat']]],
    ['only removal', { addToChat: undefined }, [en['change.remove']]],
  ] as const)('omits the Session actions a surface lacks, offering %s', (_label, actions, offered) => {
    const b = card(entry(1, snapshot(1)), { expanded: true, actions })
    const sessionActions = [en['change.addToChat'], en['change.remove']]
      .filter(name => within(b.item).queryByRole('button', { name }) !== null)
    expect(sessionActions).toEqual(offered)
    expect(within(b.item).queryAllByRole('separator')).toHaveLength(offered.length === 0 ? 0 : 1)
  })
})

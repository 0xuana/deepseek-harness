// @vitest-environment jsdom
/**
 * PerfView presentation behavior: the empty state and footer summary, the
 * scrolling table with its older-history trigger, turn and step rows with
 * their scope markers and tooltips, keyboard row controls, the copy control,
 * the step tool-call accordion, code-block caps, step filters, and the live
 * clock. Fixtures are built from the published metrics contract so each case
 * varies one field and asserts visible labels.
 */

import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { PerfView } from '../src/client/PerfView.tsx'
import { zh } from '../src/client/locales.ts'
import css from '../src/client/perf.module.css'
import {
  formatChars, formatClock, formatDateTime, formatMs, formatPercent, formatTokens,
  formatTokensShort, formatTps,
} from '../src/client/perf-format.ts'
import type {
  PerfCall, PerfSnapshot, PerfStepMetrics, PerfToolCount, PerfTurnMetrics,
} from '../src/client/perf-contract.ts'

const t = makeTranslate(zh)

/** Translate one dictionary key with its interpolation params. */
function say(key: keyof typeof zh, params?: Record<string, unknown>): string {
  return t(key, params)
}

/** One button by accessible name, typed for its disabled state. */
function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement
}

/** Fixed epoch every fixture timestamp derives from. */
const BASE = 1_767_000_000_000

/** One recorded tool call; every field defaults to "nothing recorded". */
function call(overrides: Partial<PerfCall> = {}): PerfCall {
  return {
    callId: 'call-1',
    seq: 1,
    name: 'read',
    hint: null,
    chars: null,
    lines: null,
    error: false,
    added: null,
    removed: null,
    before: null,
    after: null,
    args: null,
    inner: false,
    text: null,
    truncated: false,
    ms: null,
    startedAt: null,
    endedAt: null,
    ...overrides,
  }
}

/** One tool tally pill. */
function tool(name: string, count: number): PerfToolCount {
  return { name, count }
}

/** One measured step; defaults describe a settled 1 s step. */
function step(overrides: Partial<PerfStepMetrics> = {}): PerfStepMetrics {
  return {
    turn: 1,
    step: 1,
    startTime: BASE,
    endTime: BASE + 1_000,
    context: 1_000,
    ttft: 100,
    model: 400,
    decode: 300,
    tps: 10,
    output: 300,
    tool: 200,
    toolWall: null,
    tools: [],
    calls: [],
    toolOutput: 0,
    retries: 0,
    toolErrors: 0,
    answer: null,
    cacheRead: null,
    cacheWrite: null,
    cacheHit: null,
    wall: 1_000,
    toolPending: 0,
    running: false,
    interrupted: false,
    aborted: false,
    ...overrides,
  }
}

/** One turn aggregate; defaults describe a settled turn with no steps. */
function turn(overrides: Partial<PerfTurnMetrics> = {}): PerfTurnMetrics {
  return {
    turn: 1,
    steps: [],
    startTime: BASE,
    context: 1_000,
    ttft: 100,
    ttftPending: 0,
    model: 400,
    modelPending: 0,
    decode: 300,
    tps: 10,
    output: 300,
    tool: 200,
    toolWall: null,
    toolPending: 0,
    tools: [],
    cacheHit: null,
    cacheRead: null,
    cacheWrite: null,
    retries: 0,
    toolErrors: 0,
    toolOutput: 0,
    answer: null,
    lastStepWall: 1_000,
    running: false,
    interrupted: false,
    aborted: false,
    wall: 1_000,
    prompt: null,
    promptImages: 0,
    promptSource: null,
    ...overrides,
  }
}

/** A one-turn snapshot carrying the given steps. */
function turnSnapshot(
  steps: readonly PerfStepMetrics[],
  overrides: Partial<PerfTurnMetrics> = {},
): PerfSnapshot {
  return { turns: [turn({ steps, ...overrides })], stepCount: steps.length }
}

/** A one-turn, one-step snapshot carrying the given calls. */
function callSnapshot(
  calls: readonly PerfCall[],
  overrides: Partial<PerfStepMetrics> = {},
): PerfSnapshot {
  return turnSnapshot([step({ calls, tools: [tool('read', calls.length)], ...overrides })])
}

/** Loader contract the view receives from the inject face. */
type LoadOlder = () => Promise<boolean>

/** Render the view with every prop it consumes. */
function mount(
  snapshot: PerfSnapshot,
  loadOlder: LoadOlder = async () => false,
): ReturnType<typeof createSnapshotStore<PerfSnapshot>> {
  const store = createSnapshotStore<PerfSnapshot>(snapshot)
  const usePerf = bindSnapshotSelector(store)
  render(createElement(PerfView, { usePerf, t, loadOlder } as never))
  return store
}

/** The scrollport that owns the table's viewport. */
function scrollRegion(): HTMLElement {
  return screen.getByRole('region', { name: say('view.perf') })
}

/** Mutable scroll metrics a test can move; jsdom performs no layout. */
interface ScrollDouble {
  height: number
  top: number
}

/** Replace one element's scroll metrics because jsdom never lays content out. */
function scrollDouble(element: HTMLElement, height: number, top: number): ScrollDouble {
  const state: ScrollDouble = { height, top }
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => state.height })
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => state.top,
    set: (next: number) => { state.top = next },
  })
  return state
}

/** Patch the element prototype scroll metrics before a mount-time measurement. */
function stubInitialScroll(height: number): { top: number } {
  const state = { top: 0 }
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(height)
  vi.spyOn(Element.prototype, 'scrollTop', 'get').mockImplementation(() => state.top)
  vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation((value: number) => { state.top = value })
  return state
}

/** A promise a test settles explicitly, to observe an in-flight page load. */
function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let settle: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, resolve: settle }
}

/** Give the navigator a clipboard mock for copy-control cases. */
function stubClipboard(writeText: () => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}

/** Body rows in render order (turn headers, step rows, detail rows, step controls). */
function bodyRows(): HTMLTableRowElement[] {
  return [...document.querySelectorAll<HTMLTableRowElement>('tbody tr')]
}

/** The first body row whose text starts with `prefix`. */
function rowWithPrefix(prefix: string): HTMLTableRowElement {
  const row = bodyRows().find(candidate => (candidate.textContent ?? '').startsWith(prefix))
  if (row === undefined) throw new Error(`no row starts with ${prefix}`)
  return row
}

/** Cells of one row. */
function cellsOf(row: HTMLTableRowElement): HTMLTableCellElement[] {
  return [...row.querySelectorAll<HTMLTableCellElement>(':scope > td')]
}

/** Step-label pattern built from the dictionary, so turn rows never match. */
const STEP_LABEL = new RegExp(`^${say('step.label', { step: 1 }).replace('1', '\\d+')}`)
/** Suffix every expanded step-detail row carries in its header. */
const DETAIL_MARKER = say('detail.calls', { count: 0 }).replace('0', '').trim()

/** Rendered step rows. */
function stepRows(): HTMLTableRowElement[] {
  return bodyRows().filter(row => STEP_LABEL.test(row.textContent ?? ''))
}

/** The row of one step number. */
function stepRow(stepNumber: number): HTMLTableRowElement {
  return rowWithPrefix(say('step.label', { step: stepNumber }))
}

/** The expanded detail row of a step. */
function detailRow(): HTMLTableRowElement {
  const row = bodyRows().find(candidate => (candidate.textContent ?? '').includes(DETAIL_MARKER))
  if (row === undefined) throw new Error('no expanded detail row')
  return row
}

/** Expand one step's tool-detail row. */
function openDetail(stepNumber = 1): HTMLTableRowElement {
  fireEvent.click(stepRow(stepNumber))
  return detailRow()
}

/** Accordion blocks of the open detail row, in call order. */
function callBlocks(): HTMLElement[] {
  const cell = detailRow().querySelector('td')
  if (cell === null) throw new Error('detail row has no cell')
  // The header comes first and the hidden-calls notice has no element child.
  return [...cell.children].slice(1).filter(child => child.firstElementChild !== null) as HTMLElement[]
}

/** Time-composition tooltip of one row. */
function timeTitle(row: HTMLTableRowElement): string {
  const cell = cellsOf(row).at(-1)
  if (cell === undefined) throw new Error('row has no time cell')
  return cell.getAttribute('title') ?? ''
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('empty state and footer', () => {
  it('shows the empty message, the summary, and a disabled expand-all button', () => {
    mount({ turns: [], stepCount: 0 })
    expect(screen.getByText(say('empty'))).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText(say('summary', { turns: 0, steps: 0 }))).toBeTruthy()
    expect(button(say('expand.all')).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: say('loadOlder') })).toBeNull()
  })

  it('renders every published turn with a summary and an expand-all button', () => {
    mount({ turns: [turn({ turn: 1 }), turn({ turn: 2 }), turn({ turn: 3 })], stepCount: 0 })
    expect(screen.getByText(say('summary', { turns: 3, steps: 0 }))).toBeTruthy()
    expect(bodyRows()).toHaveLength(3)
    expect(button(say('expand.all')).disabled).toBe(false)
    expect(screen.getByRole('button', { name: say('loadOlder') })).toBeTruthy()
  })

  it('toggles one turn row and all turns from the footer', () => {
    mount({ turns: [turn({ prompt: 'question' })], stepCount: 0 })
    const row = rowWithPrefix(say('turn.label', { turn: 1 }))
    expect(row.textContent).toContain(say('turn.stepCount', { count: 0 }))
    expect(row.textContent).toContain(say('turn.collapse'))
    expect(row.getAttribute('title')).toBe(say('turn.toggle.title'))

    fireEvent.click(row)
    expect(rowWithPrefix(say('turn.label', { turn: 1 })).textContent).toContain(say('turn.expand'))

    fireEvent.click(screen.getByRole('button', { name: say('expand.all') }))
    expect(rowWithPrefix(say('turn.label', { turn: 1 })).textContent).toContain(say('turn.collapse'))
    expect(screen.getByRole('button', { name: say('collapse.all') })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: say('collapse.all') }))
    expect(rowWithPrefix(say('turn.label', { turn: 1 })).textContent).toContain(say('turn.expand'))
    expect(screen.getByRole('button', { name: say('expand.all') })).toBeTruthy()
  })
})

describe('older history', () => {
  /** Two settled turns, so one scroll can request an older page. */
  function twoTurns(): PerfSnapshot {
    return { turns: [turn({ turn: 1 }), turn({ turn: 2 })], stepCount: 2 }
  }

  it('prefetches one older page on the first content commit in a real scrollport', async () => {
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(800)
    const loadOlder = vi.fn(async () => true)
    mount(twoTurns(), loadOlder)
    await act(async () => {})
    expect(loadOlder).toHaveBeenCalledTimes(1)
  })

  it('loads near the top, reports the load, and stops after an exhausted page', async () => {
    const gate = deferred<boolean>()
    const loadOlder = vi.fn(() => gate.promise)
    mount(twoTurns(), loadOlder)
    const scroller = scrollRegion()
    scrollDouble(scroller, 1_000, 10)

    fireEvent.scroll(scroller)
    expect(loadOlder).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toBe(say('loadOlder.loading'))
    expect(screen.queryByRole('button', { name: say('loadOlder') })).toBeNull()

    // A second scroll while the page is in flight must not start another load.
    fireEvent.scroll(scroller)
    expect(loadOlder).toHaveBeenCalledTimes(1)

    await act(async () => { gate.resolve(false) })
    expect(screen.getByText(say('loadOlder.done'))).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()

    fireEvent.scroll(scroller)
    expect(loadOlder).toHaveBeenCalledTimes(1)
  })

  it('loads from the visible button and stops once a page reports no progress', async () => {
    let pages = 0
    const loadOlder = vi.fn(async () => {
      pages += 1
      return pages === 1
    })
    mount(twoTurns(), loadOlder)

    fireEvent.click(screen.getByRole('button', { name: say('loadOlder') }))
    expect(loadOlder).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toBe(say('loadOlder.loading'))
    await act(async () => {})
    expect(screen.getByRole('button', { name: say('loadOlder') })).toBeTruthy()
    expect(screen.queryByText(say('loadOlder.done'))).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: say('loadOlder') }))
    expect(loadOlder).toHaveBeenCalledTimes(2)
    await act(async () => {})
    expect(screen.getByText(say('loadOlder.done'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: say('loadOlder') })).toBeNull()

    fireEvent.scroll(scrollRegion())
    expect(loadOlder).toHaveBeenCalledTimes(2)
  })

  it('ignores a scroll away from the top and keeps an empty snapshot quiet', () => {
    const emptyLoad = vi.fn(async () => true)
    mount({ turns: [], stepCount: 0 }, emptyLoad)
    fireEvent.scroll(scrollRegion())
    expect(emptyLoad).not.toHaveBeenCalled()

    cleanup()
    const loadOlder = vi.fn(async () => true)
    mount(twoTurns(), loadOlder)
    const scroller = scrollRegion()
    const metrics = scrollDouble(scroller, 1_000, 200)
    fireEvent.scroll(scroller)
    expect(loadOlder).not.toHaveBeenCalled()
    metrics.top = 64
    fireEvent.scroll(scroller)
    expect(loadOlder).toHaveBeenCalledTimes(1)
  })

  it('keeps the trigger available after a rejected page', async () => {
    const loadOlder = vi.fn(async () => {
      throw new Error('history unavailable')
    })
    mount(twoTurns(), loadOlder)
    const scroller = scrollRegion()
    scrollDouble(scroller, 1_000, 0)

    await act(async () => { fireEvent.scroll(scroller) })
    expect(loadOlder).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(say('loadOlder.done'))).toBeNull()
    expect(screen.getByRole('button', { name: say('loadOlder') })).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: say('loadOlder') }))
    })
    expect(loadOlder).toHaveBeenCalledTimes(2)
  })

  it('restores the reading position when older turns prepend above the viewport', async () => {
    const gate = deferred<boolean>()
    const loadOlder = vi.fn(() => gate.promise)
    const store = mount({ turns: [turn({ turn: 2 }), turn({ turn: 3 })], stepCount: 2 }, loadOlder)
    const scroller = scrollRegion()
    const metrics = scrollDouble(scroller, 1_000, 0)

    fireEvent.scroll(scroller)
    expect(loadOlder).toHaveBeenCalledTimes(1)
    // The older page commits before the promise settles, and the content grows.
    act(() => {
      store.set({
        turns: [turn({ turn: 1 }), turn({ turn: 2 }), turn({ turn: 3 })],
        stepCount: 3,
      })
    })
    metrics.height = 1_500
    await act(async () => { gate.resolve(true) })
    expect(metrics.top).toBe(500)
  })

  it('opens at the newest turn on first mount and when the first turns arrive', () => {
    const initial = stubInitialScroll(1_200)
    mount(twoTurns())
    expect(initial.top).toBe(1_200)

    cleanup()
    vi.restoreAllMocks()
    const later = stubInitialScroll(900)
    const store = mount({ turns: [], stepCount: 0 })
    act(() => {
      store.set({ turns: [turn({ turn: 1 })], stepCount: 1 })
    })
    expect(later.top).toBe(900)
  })
})

describe('turn rows', () => {
  it('renders the header, prompt, markers, numeric cells, and time tooltip', () => {
    mount({
      turns: [turn({
        prompt: 'why?',
        promptImages: 2,
        cacheHit: 0.2,
        cacheRead: 100,
        cacheWrite: 100,
        ttftPending: 2,
        modelPending: 1,
        toolPending: 3,
        retries: 2,
      })],
      stepCount: 0,
    })

    const headers = screen.getAllByRole('columnheader')
    expect(headers.map(header => header.textContent)).toEqual([
      say('column.scope'), say('column.prompt'), say('column.did'), say('column.context'),
      say('column.output'), say('column.cache'), say('column.ttft'), say('column.model'),
      say('column.tps'), say('column.tool'), say('column.time'),
    ])
    expect(headers[0]?.getAttribute('title')).toBe(say('column.scope.title'))
    expect(headers[10]?.getAttribute('title')).toBe(say('column.time.title'))
    expect(headers[3]?.getAttribute('title')).toBe(say('column.context.title'))

    const row = rowWithPrefix(say('turn.label', { turn: 1 }))
    expect(row.textContent).toContain(`· ${formatClock(BASE)}`)
    const clock = within(row).getByText(`· ${formatClock(BASE)}`)
    expect(clock.getAttribute('title')).toBe(say('turn.started', { time: formatDateTime(BASE) }))
    expect(within(row).getByText(say('did.retry', { count: 2 }))).toBeTruthy()
    const miss = within(row).getByText(say('state.cacheMiss'))
    expect(miss.getAttribute('title')).toBe(say('state.cacheMiss.title'))

    const cells = cellsOf(row)
    expect(cells[1]?.textContent).toBe(`why? · ${say('turn.images', { count: 2 })}`)
    expect(cells[1]?.getAttribute('title')).toBe(`why? · ${say('turn.images', { count: 2 })}`)
    expect(cells[2]?.textContent).toBe(say('did.answer'))
    expect(cells[3]?.textContent).toBe(formatTokensShort(1_000))
    expect(cells[3]?.getAttribute('title')).toBeNull()
    expect(cells[4]?.textContent).toBe(formatTokensShort(300))
    expect(cells[5]?.textContent).toBe(formatPercent(0.2))
    expect(cells[5]?.getAttribute('title'))
      .toBe(say('cache.detail', { read: formatTokens(100), input: formatTokens(800), write: formatTokens(100) }))
    expect(cells[6]?.textContent).toBe(`≥ ${formatMs(100)}`)
    expect(cells[6]?.getAttribute('title')).toBe(say('partial', { count: 2 }))
    expect(cells[7]?.textContent).toBe(`≥ ${formatMs(400)}`)
    expect(cells[7]?.getAttribute('title')).toBe(say('partial', { count: 1 }))
    expect(cells[8]?.textContent).toBe(formatTps(10))
    expect(cells[9]?.textContent).toBe(`≥ ${formatMs(200)}`)
    expect(cells[9]?.getAttribute('title')).toBe(say('partial', { count: 3 }))
    expect(cells[10]?.textContent).toBe(formatMs(1_000))
    expect(timeTitle(row)).toBe([
      say('bar.start', { clock: formatClock(BASE) }),
      say('bar.ttft', { value: formatMs(100) }),
      say('bar.gen', { value: formatMs(300) }),
      say('bar.tool', { value: formatMs(200) }),
      say('bar.rest', { value: formatMs(400) }),
      say('bar.wall', { value: formatMs(1_000) }),
    ].join(' · '))
  })

  it('labels the did column as an answer, a generating step, or an unsettled one', () => {
    mount({
      turns: [
        turn({ turn: 1, running: true, wall: null, startTime: null }),
        turn({ turn: 2, aborted: true, interrupted: true }),
        turn({ turn: 3, aborted: true }),
        turn({ turn: 4 }),
        turn({ turn: 5, running: true }),
      ],
      stepCount: 5,
    })

    const generating = cellsOf(rowWithPrefix(say('turn.label', { turn: 1 })))
    expect(generating[2]?.textContent).toBe(say('did.working'))
    expect(generating[0]?.textContent).toContain(say('state.running'))
    expect(generating[10]?.textContent).toBe('—')
    expect(generating[10]?.getAttribute('title')).toBe(say('unknown'))

    const interrupted = cellsOf(rowWithPrefix(say('turn.label', { turn: 2 })))
    expect(interrupted[0]?.textContent).toContain(say('state.interrupted'))
    expect(interrupted[0]?.textContent).not.toContain(say('state.aborted'))
    expect(interrupted[2]?.textContent).toBe(say('did.aborted'))

    const unsettled = cellsOf(rowWithPrefix(say('turn.label', { turn: 3 })))
    const abortedMarker = within(unsettled[0] as HTMLTableCellElement).getByText(say('state.aborted'))
    expect(abortedMarker.getAttribute('title')).toBe(say('state.aborted.title'))
    expect(unsettled[2]?.textContent).toBe(say('did.aborted'))

    const answered = cellsOf(rowWithPrefix(say('turn.label', { turn: 4 })))
    expect(answered[2]?.textContent).toBe(say('did.answer'))

    const stillRunning = cellsOf(rowWithPrefix(say('turn.label', { turn: 5 })))
    expect(stillRunning[2]?.textContent).toBe(say('did.working'))
    expect(stillRunning[10]?.textContent).toBe(formatMs(1_000))
  })

  it('summarizes turn tools with pills, overflow, errors, and output size', () => {
    mount({
      turns: [turn({
        tools: [tool('read', 2), tool('edit', 1), tool('mystery', 4), tool('todo_write', 1)],
        toolErrors: 2,
        toolOutput: 1_500,
      })],
      stepCount: 0,
    })
    const row = rowWithPrefix(say('turn.label', { turn: 1 }))
    const did = cellsOf(row)[2] as HTMLTableCellElement
    expect(within(did).getByText('read ×2').getAttribute('title'))
      .toBe(say('did.title', { calls: 2, tools: 'read' }))
    expect(within(did).getByText('edit ×1')).toBeTruthy()
    expect(within(did).getByText('mystery ×4')).toBeTruthy()
    expect(within(did).queryByText('todo_write ×1')).toBeNull()
    expect(within(did).getByText(say('did.more', { count: 1 }))).toBeTruthy()
    const failed = within(did).getByText(say('tool.failed', { count: 2 }))
    expect(failed.getAttribute('title')).toBe(say('tool.failed.title', { count: 2 }))
    const output = within(did).getByText(say('did.output', { chars: formatChars(1_500) }))
    expect(output.getAttribute('title')).toBe(say('did.total', { chars: formatTokens(1_500) }))
    expect(did.getAttribute('title')).toBe(say('did.title', {
      calls: 8,
      tools: 'read ×2 · edit ×1 · mystery ×4 · todo_write ×1',
    }))
  })

  it('omits zero tool errors, zero output, and overflow for three tools', () => {
    mount({
      turns: [turn({ tools: [tool('read', 1), tool('edit', 1), tool('write', 1)], toolOutput: 0 })],
      stepCount: 0,
    })
    const did = cellsOf(rowWithPrefix(say('turn.label', { turn: 1 })))[2] as HTMLTableCellElement
    expect(within(did).queryByText(say('did.more', { count: 1 }))).toBeNull()
    expect(within(did).queryByText(say('tool.failed', { count: 1 }))).toBeNull()
    expect(within(did).queryByText(/字符/)).toBeNull()
    expect(did.getAttribute('title')).toBe(say('did.title', { calls: 3, tools: 'read ×1 · edit ×1 · write ×1' }))
  })

  it('renders a prompt without images and an empty prompt cell without one', () => {
    mount({
      turns: [
        turn({ turn: 1, prompt: 'plain question' }),
        turn({ turn: 2, prompt: '', promptImages: 1 }),
        turn({ turn: 3, prompt: null }),
      ],
      stepCount: 3,
    })
    expect(cellsOf(rowWithPrefix(say('turn.label', { turn: 1 })))[1]?.textContent).toBe('plain question')
    expect(cellsOf(rowWithPrefix(say('turn.label', { turn: 2 })))[1]?.textContent).toBe('')
    expect(cellsOf(rowWithPrefix(say('turn.label', { turn: 2 })))[1]?.getAttribute('title')).toBeNull()
    expect(cellsOf(rowWithPrefix(say('turn.label', { turn: 3 })))[1]?.textContent).toBe('')
  })

  it('labels automated turn triggers instead of leaving the question empty', () => {
    const sources = ['agent-message', 'subagent-settled', 'goal', 'runtime-context', 'time-context', 'mystery']
    mount({
      turns: sources.map((source, index) => turn({
        turn: index + 1,
        prompt: `trigger text ${index}`,
        promptSource: source,
      })),
      stepCount: sources.length,
    })
    const labels: Readonly<Record<string, string>> = {
      'agent-message': say('trigger.agent-message'),
      'subagent-settled': say('trigger.subagent-settled'),
      'goal': say('trigger.goal'),
      'runtime-context': say('trigger.context'),
      'time-context': say('trigger.context'),
      'mystery': say('trigger.other'),
    }
    sources.forEach((source, index) => {
      const cell = cellsOf(rowWithPrefix(say('turn.label', { turn: index + 1 })))[1] as HTMLTableCellElement
      expect(cell.textContent).toContain(labels[source])
      expect(cell.textContent).toContain(`trigger text ${index}`)
      expect(cell.getAttribute('title')).toBe(`trigger text ${index}`)
    })

    // A context-only trigger with no readable text still shows its badge alone.
    cleanup()
    mount({ turns: [turn({ prompt: null, promptSource: 'time-context' })], stepCount: 0 })
    const bare = cellsOf(rowWithPrefix(say('turn.label', { turn: 1 })))[1] as HTMLTableCellElement
    expect(bare.textContent).toContain(say('trigger.context'))
    expect(bare.getAttribute('title')).toBe(say('trigger.context'))
  })

  it('shows the recorded cache breakdown and the formula fallback when none was recorded', () => {
    mount({
      turns: [
        turn({ turn: 1, cacheHit: 0.8, cacheRead: 100, cacheWrite: 200, context: 1_000 }),
        turn({ turn: 2, cacheHit: 0.1, cacheRead: null, cacheWrite: 200, context: 1_000 }),
        turn({ turn: 3, cacheHit: 0.4, cacheRead: 100, cacheWrite: null, context: null }),
        turn({ turn: 4, cacheHit: 0.2, cacheRead: null, cacheWrite: null }),
      ],
      stepCount: 4,
    })
    const full = cellsOf(rowWithPrefix(say('turn.label', { turn: 1 })))
    expect(full[5]?.getAttribute('title')).toBe(say('cache.detail', {
      read: formatTokens(100), input: formatTokens(700), write: formatTokens(200),
    }))
    expect(full[0]?.textContent).not.toContain(say('state.cacheMiss'))
    const writeOnly = cellsOf(rowWithPrefix(say('turn.label', { turn: 2 })))
    expect(writeOnly[5]?.getAttribute('title')).toBe(say('cache.detail', {
      read: formatTokens(0), input: formatTokens(800), write: formatTokens(200),
    }))
    const readOnly = cellsOf(rowWithPrefix(say('turn.label', { turn: 3 })))
    expect(readOnly[5]?.getAttribute('title')).toBe(say('cache.detail', {
      read: formatTokens(100), input: formatTokens(0), write: formatTokens(0),
    }))
    expect(readOnly[3]?.textContent).toBe('—')
    const absent = cellsOf(rowWithPrefix(say('turn.label', { turn: 4 })))
    expect(absent[5]?.getAttribute('title')).toBe(say('column.cache.title'))
  })

  it('draws the bar tool segment from the non-overlapping span and keeps the column sum', () => {
    mount({
      turns: [turn({ tool: 900, toolWall: 300, wall: 1_000, ttft: 100, model: 400 })],
      stepCount: 0,
    })
    const row = rowWithPrefix(say('turn.label', { turn: 1 }))
    expect(cellsOf(row)[9]?.textContent).toBe(formatMs(900))
    expect(timeTitle(row)).toBe([
      say('bar.start', { clock: formatClock(BASE) }),
      say('bar.ttft', { value: formatMs(100) }),
      say('bar.gen', { value: formatMs(300) }),
      say('bar.tool', { value: formatMs(300) }),
      say('bar.rest', { value: formatMs(300) }),
      say('bar.wall', { value: formatMs(1_000) }),
    ].join(' · '))
  })
})

describe('step rows', () => {
  it('renders labels, partial hints, scope markers, and clickable detail rows', () => {
    const steps = [
      step({
        step: 1,
        toolErrors: 1,
        retries: 1,
        cacheHit: 0.2,
        interrupted: true,
        tools: [tool('read', 1)],
        calls: [call({ callId: 'c1', name: 'read', lines: 3 })],
      }),
      step({ step: 2, startTime: null, endTime: null, wall: null, aborted: true }),
      step({ step: 3, running: true }),
      step({ step: 4 }),
      step({ step: 5, tools: [tool('read', 1)] }),
      step({ step: 6, tools: [tool('bash', 1)], calls: [call({ callId: 'c6', name: 'bash', text: 'done' })] }),
    ]
    mount(turnSnapshot(steps))

    const first = stepRow(1)
    const firstCells = cellsOf(first)
    expect(firstCells[0]?.textContent).toContain(say('state.interrupted'))
    expect(firstCells[0]?.textContent).toContain(say('did.retry', { count: 1 }))
    expect(firstCells[0]?.textContent).toContain(say('state.cacheMiss'))
    expect(firstCells[0]?.textContent).toContain(` · ${say('detail.show')}`)
    expect(first.getAttribute('title')).toBe(say('detail.title'))
    // No recorded breakdown on this step: the cache cell keeps the formula explanation.
    expect(firstCells[5]?.getAttribute('title')).toBe(say('column.cache.title'))
    const failed = within(firstCells[2] as HTMLTableCellElement).getByText(say('tool.failed', { count: 1 }))
    expect(failed.getAttribute('title')).toBe(say('tool.failed.title', { count: 1 }))
    expect(within(firstCells[2] as HTMLTableCellElement).getByText('read')).toBeTruthy()
    expect(within(firstCells[2] as HTMLTableCellElement).getByText(say('did.lines', { lines: '3' }))).toBeTruthy()

    const partial = cellsOf(stepRow(2))
    expect(partial[0]?.textContent).toContain(say('step.partial'))
    const partialHint = within(partial[0] as HTMLTableCellElement).getByText(`· ${say('step.partial')}`)
    expect(partialHint.getAttribute('title')).toBe(say('step.partial.title'))
    expect(partial[0]?.textContent).toContain(say('state.aborted'))
    expect(within(partial[0] as HTMLTableCellElement).getByText(say('state.aborted')).getAttribute('title'))
      .toBe(say('state.aborted.title'))
    expect(partial[2]?.textContent).toBe(say('did.aborted'))

    const running = cellsOf(stepRow(3))
    expect(running[0]?.textContent).toContain(say('state.running'))
    expect(running[2]?.textContent).toBe(say('did.working'))

    expect(cellsOf(stepRow(4))[2]?.textContent).toBe(say('did.answer'))

    const unclickable = stepRow(5)
    expect(unclickable.getAttribute('title')).toBeNull()
    expect(cellsOf(unclickable)[0]?.textContent).not.toContain(say('detail.show'))

    fireEvent.click(first)
    expect(detailRow().textContent).toContain(say('detail.calls', { count: 1 }))
    expect(cellsOf(stepRow(1))[0]?.textContent).toContain(` · ${say('detail.hide')}`)
    fireEvent.click(stepRow(1))
    expect(bodyRows().some(row => (row.textContent ?? '').includes(DETAIL_MARKER))).toBe(false)

    fireEvent.click(unclickable)
    expect(bodyRows().some(row => (row.textContent ?? '').includes(DETAIL_MARKER))).toBe(false)

    fireEvent.click(stepRow(6))
    expect(detailRow().textContent).toContain('done')
  })

  it('previews the answered text in the did cell and skips blank answers', () => {
    mount(turnSnapshot([step({ answer: 'first line\nsecond line' })]))
    const stepDid = cellsOf(stepRow(1))[2] as HTMLTableCellElement
    expect(stepDid.textContent).toContain('first line')
    expect(within(stepDid).getByTitle(/first line/).getAttribute('title')).toBe('first line\nsecond line')

    cleanup()
    mount(turnSnapshot([step({ answer: '   \n  ' })]))
    expect(cellsOf(stepRow(1))[2]?.textContent).toBe(say('did.answer'))

    cleanup()
    mount({ turns: [turn({ answer: 'turn answer text' })], stepCount: 0 })
    const turnDid = cellsOf(rowWithPrefix(say('turn.label', { turn: 1 })))[2] as HTMLTableCellElement
    expect(turnDid.textContent).toContain('turn answer text')
    expect(within(turnDid).getByTitle('turn answer text')).toBeTruthy()

    cleanup()
    mount({ turns: [turn({ answer: ' ' })], stepCount: 0 })
    expect(cellsOf(rowWithPrefix(say('turn.label', { turn: 1 })))[2]?.textContent).toBe(say('did.answer'))
  })

  it('shows context deltas and the gap since the previous step', () => {
    const steps = [
      step({ step: 1, context: 1_000, toolOutput: 500, output: 100, startTime: BASE, endTime: BASE + 1_000 }),
      step({ step: 2, context: 1_500, toolOutput: 0, output: 200, startTime: BASE + 5_000, endTime: BASE + 6_000 }),
      step({ step: 3, context: null, toolOutput: null, output: null, startTime: null, endTime: null }),
      step({ step: 4, context: 1_500, toolOutput: 0, output: null, startTime: BASE + 6_000, endTime: BASE + 7_000 }),
      step({ step: 5, context: 900, toolOutput: 0, output: null, startTime: BASE + 6_100, endTime: BASE + 7_100 }),
    ]
    mount(turnSnapshot(steps))

    const second = cellsOf(stepRow(2))
    expect(second[3]?.textContent).toContain('+0.50K')
    expect(second[3]?.getAttribute('title')).toBe([
      say('context.delta', { from: formatTokensShort(1_000), to: formatTokensShort(1_500), delta: '+0.50K' }),
      say('context.delta.chars', { chars: formatTokens(500) }),
      say('context.delta.output', { tokens: formatTokens(100) }),
    ].join('\n'))
    expect(timeTitle(stepRow(2))).toContain(say('bar.gap', { value: formatMs(4_000) }))

    const third = cellsOf(stepRow(3))
    expect(third[3]?.textContent).toBe('—')
    expect(third[3]?.getAttribute('title')).toBeNull()
    expect(third[0]?.textContent).toContain(say('step.partial'))
    expect(timeTitle(stepRow(3))).toBe([
      say('bar.ttft', { value: formatMs(100) }),
      say('bar.gen', { value: formatMs(300) }),
      say('bar.tool', { value: formatMs(200) }),
      say('bar.rest', { value: formatMs(400) }),
      say('bar.wall', { value: formatMs(1_000) }),
    ].join(' · '))

    const fourth = cellsOf(stepRow(4))
    expect(fourth[3]?.textContent).toBe(formatTokensShort(1_500))
    expect(fourth[3]?.getAttribute('title')).toBeNull()
    expect(timeTitle(stepRow(4))).not.toContain('距上一步')

    const fifth = cellsOf(stepRow(5))
    expect(fifth[3]?.textContent).toContain('−0.60K')
    expect(fifth[3]?.getAttribute('title')).toBe(say('context.delta', {
      from: formatTokensShort(1_500),
      to: formatTokensShort(900),
      delta: '−0.60K',
    }))
  })

  it('summarizes step tools with line, edit, and character statistics', () => {
    const steps = [
      step({
        step: 1,
        tools: [tool('read', 2), tool('edit', 1), tool('bash', 1), tool('mystery', 1)],
        calls: [
          call({ callId: 'a1', name: 'read', lines: 1 }),
          call({ callId: 'a2', name: 'read', lines: 2 }),
          call({ callId: 'a3', name: 'edit', hint: '/a', added: 2, removed: 0 }),
          call({ callId: 'a4', name: 'bash', chars: 300 }),
        ],
      }),
      step({
        step: 2,
        tools: [tool('edit', 2)],
        calls: [
          call({ callId: 'b1', name: 'edit', added: 1, removed: 2 }),
          call({ callId: 'b2', name: 'edit', added: 0, removed: 0 }),
        ],
      }),
      step({
        step: 3,
        tools: [tool('write', 1)],
        calls: [call({ callId: 'c1', name: 'write', added: 3, removed: 0 })],
      }),
      step({
        step: 4,
        tools: [tool('apply_patch', 1)],
        calls: [call({ callId: 'd1', name: 'apply_patch', added: 0, removed: 4 })],
      }),
      step({
        step: 5,
        tools: [tool('mystery', 1), tool('bash', 1), tool('read', 1), tool('write', 1)],
        calls: [
          call({ callId: 'e1', name: 'mystery', chars: null }),
          call({ callId: 'e2', name: 'bash', chars: 0 }),
          call({ callId: 'e3', name: 'read', lines: 0 }),
          call({ callId: 'e4', name: 'write', added: 0, removed: 0 }),
          call({ callId: 'e5', name: 'latex', chars: 12 }),
        ],
      }),
      step({ step: 6, tools: [tool('null-tool', 1)], calls: [call({ callId: 'f1', name: null })] }),
      step({ step: 7, tools: [tool('', 1)], calls: [call({ callId: 'g1', name: '' })] }),
    ]
    mount(turnSnapshot(steps))

    const firstDid = cellsOf(stepRow(1))[2] as HTMLTableCellElement
    expect(within(firstDid).getByText('×2')).toBeTruthy()
    expect(within(firstDid).getByText(say('did.lines', { lines: '3' }))).toBeTruthy()
    expect(within(firstDid).getByText('+2 行')).toBeTruthy()
    expect(within(firstDid).getByText('/a')).toBeTruthy()
    expect(within(firstDid).getByText(say('did.chars', { chars: formatChars(300) }))).toBeTruthy()
    expect(within(firstDid).getAllByText('·')).toHaveLength(2)
    expect(within(firstDid).getByText(say('did.rest', { count: 1 }))).toBeTruthy()

    const mixed = cellsOf(stepRow(2))[2] as HTMLTableCellElement
    expect(within(mixed).getByText('+1')).toBeTruthy()
    expect(within(mixed).getByText('−2')).toBeTruthy()
    expect(within(cellsOf(stepRow(3))[2] as HTMLTableCellElement).getByText('+3 行')).toBeTruthy()
    expect(within(cellsOf(stepRow(4))[2] as HTMLTableCellElement).getByText('−4 行')).toBeTruthy()

    const zero = cellsOf(stepRow(5))[2] as HTMLTableCellElement
    expect(within(zero).getByText('mystery')).toBeTruthy()
    expect(within(zero).getByText('bash')).toBeTruthy()
    expect(within(zero).queryByText('write')).toBeNull()
    expect(within(zero).queryByText(say('did.lines', { lines: formatTokens(0) }))).toBeNull()
    expect(within(zero).queryByText(/字符/)).toBeNull()

    expect(within(cellsOf(stepRow(6))[2] as HTMLTableCellElement).getByText('?')).toBeTruthy()
    // An empty tool name hashes to a tone instead of falling back to the marker.
    expect(cellsOf(stepRow(7))[2]?.textContent).toBe('')

    fireEvent.click(stepRow(6))
    expect(within(callBlocks()[0] as HTMLElement).getByText('?')).toBeTruthy()
  })

  it('uses the listed call count when a step has calls but no tool tallies', () => {
    mount(turnSnapshot([step({ tools: [], calls: [call({ callId: 'only', text: 'body' })] })]))
    const did = cellsOf(stepRow(1))[2]
    expect(did?.textContent).toBe(say('did.answer'))
    fireEvent.click(stepRow(1))
    const detail = detailRow()
    expect(detail.textContent).toContain(say('detail.calls', { count: 1 }))
    expect(detail.textContent).not.toContain('还有')
  })
})

describe('keyboard row controls', () => {
  it('toggles a turn from its focusable button and reports aria-expanded', () => {
    mount({ turns: [turn({ turn: 1 }), turn({ turn: 2 })], stepCount: 2 })
    const labels = (): string | null => screen
      .getByRole('button', { name: say('turn.toggle.aria', { turn: 2 }) })
      .getAttribute('aria-expanded')
    expect(labels()).toBe('true')
    expect(screen.getByRole('button', { name: say('turn.toggle.aria', { turn: 2 }) })
      .getAttribute('title')).toBe(say('turn.toggle.title'))

    fireEvent.click(screen.getByRole('button', { name: say('turn.toggle.aria', { turn: 2 }) }))
    expect(labels()).toBe('false')
    expect(rowWithPrefix(say('turn.label', { turn: 2 })).textContent).toContain(say('turn.expand'))

    // Mouse row clicks keep toggling the same state.
    fireEvent.click(rowWithPrefix(say('turn.label', { turn: 2 })))
    expect(labels()).toBe('true')

    // A native button activates on Enter and Space; jsdom does not synthesize
    // the click those keys produce, so the test dispatches it explicitly.
    const enter = screen.getByRole('button', { name: say('turn.toggle.aria', { turn: 2 }) })
    fireEvent.keyDown(enter, { key: 'Enter' })
    fireEvent.click(enter)
    expect(labels()).toBe('false')
    const space = screen.getByRole('button', { name: say('turn.toggle.aria', { turn: 2 }) })
    fireEvent.keyDown(space, { key: ' ' })
    fireEvent.click(space)
    expect(labels()).toBe('true')
  })

  it('toggles step details from their focusable button and reports aria-expanded', () => {
    mount(turnSnapshot([
      step({ step: 1, tools: [tool('read', 1)], calls: [call({ callId: 'c1', text: 'body' })] }),
      step({ step: 2 }),
    ]))
    const toggle = (): HTMLElement => screen.getByRole('button', { name: say('step.toggle.aria', { step: 1 }) })
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(toggle().getAttribute('title')).toBe(say('detail.title'))

    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(detailRow().textContent).toContain('body')

    // A row click still toggles the same state.
    fireEvent.click(stepRow(1))
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(bodyRows().some(row => (row.textContent ?? '').includes(DETAIL_MARKER))).toBe(false)

    fireEvent.keyDown(toggle(), { key: 'Enter' })
    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(toggle(), { key: ' ' })
    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('false')

    // A step without a detail body keeps the row non-interactive.
    expect(screen.queryByRole('button', { name: say('step.toggle.aria', { step: 2 }) })).toBeNull()
  })
})

describe('time cell', () => {
  it('shows the dash for a missing total and for a zero total', () => {
    mount({
      turns: [
        turn({ turn: 1, wall: null, startTime: null }),
        turn({ turn: 2, wall: 0 }),
      ],
      stepCount: 2,
    })
    const missing = cellsOf(rowWithPrefix(say('turn.label', { turn: 1 })))
    expect(missing[10]?.textContent).toBe('—')
    expect(missing[10]?.getAttribute('title')).toBe(say('unknown'))
    const zero = cellsOf(rowWithPrefix(say('turn.label', { turn: 2 })))
    expect(zero[10]?.textContent).toBe('—')
    expect(zero[10]?.getAttribute('title')).toBe(say('unknown'))
  })

  it('clamps segments to the measured total and defaults unrecorded spans to zero', () => {
    mount(turnSnapshot([
      step({ step: 1, wall: 1_000, ttft: 5_000, model: 5_000, tool: 5_000, startTime: BASE }),
      step({ step: 2, wall: 1_000, ttft: null, model: null, tool: null, startTime: BASE }),
      step({ step: 3, wall: 1_000, ttft: 100, model: 800, tool: 500, startTime: BASE }),
      step({ step: 4, wall: 1_000, ttft: 100, model: 400, tool: 700, toolWall: 200, startTime: BASE }),
    ]))
    expect(timeTitle(stepRow(1))).toBe([
      say('bar.start', { clock: formatClock(BASE) }),
      say('bar.ttft', { value: formatMs(1_000) }),
      say('bar.gen', { value: formatMs(0) }),
      say('bar.tool', { value: formatMs(1_000) }),
      say('bar.rest', { value: formatMs(0) }),
      say('bar.wall', { value: formatMs(1_000) }),
    ].join(' · '))
    expect(timeTitle(stepRow(2))).toBe([
      say('bar.start', { clock: formatClock(BASE) }),
      say('bar.ttft', { value: formatMs(0) }),
      say('bar.gen', { value: formatMs(0) }),
      say('bar.tool', { value: formatMs(0) }),
      say('bar.rest', { value: formatMs(1_000) }),
      say('bar.wall', { value: formatMs(1_000) }),
    ].join(' · '))
    expect(timeTitle(stepRow(3))).toBe([
      say('bar.start', { clock: formatClock(BASE) }),
      say('bar.ttft', { value: formatMs(100) }),
      say('bar.gen', { value: formatMs(700) }),
      say('bar.tool', { value: formatMs(500) }),
      say('bar.rest', { value: formatMs(0) }),
      say('bar.wall', { value: formatMs(1_000) }),
    ].join(' · '))
    // The column keeps the summed tool time while the bar uses the wall union.
    expect(cellsOf(stepRow(4))[9]?.textContent).toBe(formatMs(700))
    expect(timeTitle(stepRow(4))).toBe([
      say('bar.start', { clock: formatClock(BASE) }),
      say('bar.ttft', { value: formatMs(100) }),
      say('bar.gen', { value: formatMs(300) }),
      say('bar.tool', { value: formatMs(200) }),
      say('bar.rest', { value: formatMs(400) }),
      say('bar.wall', { value: formatMs(1_000) }),
    ].join(' · '))
  })
})

describe('step detail accordion', () => {
  /** Calls and tallies that exercise every detail arm. */
  function accordionSnapshot(): PerfSnapshot {
    return callSnapshot(
      [
        call({
          callId: 'read-call',
          name: 'read',
          hint: '/a.ts',
          chars: 12,
          lines: 3,
          ms: 40,
          args: '{"path":"/a.ts"}',
          text: 'alpha\nbeta',
          error: true,
        }),
        call({ callId: 'edit-call', name: 'edit', before: 'a\nb', after: 'a\nc' }),
        call({ callId: 'write-call', name: 'write', args: '{}' }),
      ],
      { tools: [tool('read', 3), tool('edit', 1), tool('write', 1)] },
    )
  }

  it('renders the header, call metadata, bodies, hidden notice, and wrap toggle', () => {
    mount(accordionSnapshot())
    const detail = openDetail(1)
    const blocks = callBlocks()
    expect(blocks).toHaveLength(3)
    expect(detail.textContent).toContain(say('detail.calls', { count: 5 }))
    expect(detail.textContent).toContain(say('detail.chars', { chars: formatTokens(12) }))
    expect(detail.textContent).toContain(say('detail.hidden', { count: 2, limit: 12 }))

    const read = blocks[0] as HTMLElement
    expect(read.textContent).toContain('/a.ts')
    expect(read.textContent).toContain([
      say('detail.chars', { chars: formatTokens(12) }),
      say('detail.lines', { lines: formatTokens(3) }),
      formatMs(40),
    ].join(' · '))
    const failed = within(read).getByText(say('tool.failed', { count: 1 }))
    expect(failed.getAttribute('title')).toBe(say('tool.failed.title', { count: 1 }))
    expect(within(read).getByText('alpha')).toBeTruthy()
    expect(within(read).getByText('beta')).toBeTruthy()

    const edit = blocks[1] as HTMLElement
    expect(within(edit).getByText(say('detail.diff'))).toBeTruthy()
    expect(within(edit).getByText('a')).toBeTruthy()
    expect(within(edit).getByText('− b')).toBeTruthy()
    expect(within(edit).getByText('+ c')).toBeTruthy()

    const write = blocks[2] as HTMLElement
    expect(within(write).getByText(say('detail.emptyBody'))).toBeTruthy()

    expect(within(detail).queryAllByRole('button', { name: say('detail.copy') })).toHaveLength(0)
    expect(within(detail).getAllByRole('button', { name: '{}' })).toHaveLength(2)

    const wrap = within(detail).getByRole('button', { name: say('detail.wrap') })
    expect(wrap.getAttribute('aria-pressed')).toBe('false')
    expect(wrap.getAttribute('title')).toBe(say('detail.wrap.title'))
    fireEvent.click(wrap)
    expect(within(detailRow()).getByRole('button', { name: say('detail.wrap') }).getAttribute('aria-pressed'))
      .toBe('true')
  })

  it('renders the copy control only for bodies with copied text', () => {
    stubClipboard(vi.fn(() => Promise.resolve()))
    mount(accordionSnapshot())
    const detail = openDetail(1)
    // Read has result text, edit falls back to its diff, write has an empty body.
    expect(within(detail).getAllByRole('button', { name: say('detail.copy') })).toHaveLength(2)
  })

  it('toggles raw arguments per call and keeps the toggle when arguments disappear', () => {
    const store = mount(accordionSnapshot())
    openDetail(1)
    expect(within(detailRow()).queryByText(say('detail.args'))).toBeNull()

    const raw = within(callBlocks()[0] as HTMLElement).getByRole('button', { name: '{}' })
    expect(raw.getAttribute('aria-pressed')).toBe('false')
    expect(raw.getAttribute('title')).toBe(say('detail.raw.title'))
    fireEvent.click(raw)
    expect(within(detailRow()).getByText(say('detail.args'))).toBeTruthy()
    // Raw arguments are pretty-printed and always wrap instead of scrolling sideways.
    const rawBody = detailRow().querySelector('pre')
    expect([...(rawBody?.querySelectorAll('span') ?? [])].map(line => line.textContent))
      .toEqual(['{', '  "path": "/a.ts"', '}'])
    expect(rawBody?.classList.contains(css.codeWrap!)).toBe(true)
    expect(within(callBlocks()[0] as HTMLElement).getByRole('button', { name: '{}' }).getAttribute('aria-pressed'))
      .toBe('true')

    fireEvent.click(within(callBlocks()[0] as HTMLElement).getByRole('button', { name: '{}' }))
    expect(within(detailRow()).queryByText(say('detail.args'))).toBeNull()

    // Raw stays on while the arguments turn unrecorded: the chip disappears and
    // the body falls back to the result text.
    fireEvent.click(within(callBlocks()[0] as HTMLElement).getByRole('button', { name: '{}' }))
    act(() => {
      store.set(callSnapshot(
        [call({ callId: 'read-call', name: 'read', hint: '/a.ts', text: 'alpha\nbeta' })],
        { tools: [tool('read', 1)] },
      ))
    })
    expect(within(detailRow()).getByText('alpha')).toBeTruthy()
    expect(within(detailRow()).queryAllByRole('button', { name: '{}' })).toHaveLength(0)
    expect(within(detailRow()).queryByText(say('detail.args'))).toBeNull()
  })

  it('reports the copied label and resets it after the timeout', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn(() => Promise.resolve())
    stubClipboard(writeText)
    mount(callSnapshot([call({ text: 'copied body' })]))
    openDetail(1)
    const copy = within(detailRow()).getByRole('button', { name: say('detail.copy') })
    expect(copy.textContent).toBe(say('detail.copy'))
    expect(copy.getAttribute('title')).toBe(say('detail.copy.title'))

    await act(async () => {
      fireEvent.click(copy)
    })
    expect(writeText).toHaveBeenCalledWith('copied body')
    expect(within(detailRow()).getByRole('button', { name: say('detail.copied') })).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(1_200)
    })
    expect(within(detailRow()).getByRole('button', { name: say('detail.copy') })).toBeTruthy()
  })

  it('reports a rejected copy and resets the failure label', async () => {
    vi.useFakeTimers()
    const rejected = vi.fn(() => Promise.reject(new Error('denied')))
    stubClipboard(rejected)
    mount(callSnapshot([call({ text: 'nope' })]))
    openDetail(1)
    await act(async () => {
      fireEvent.click(within(detailRow()).getByRole('button', { name: say('detail.copy') }))
    })
    expect(rejected).toHaveBeenCalledWith('nope')
    expect(within(detailRow()).getByRole('button', { name: say('detail.copyFailed') })).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(1_200)
    })
    expect(within(detailRow()).getByRole('button', { name: say('detail.copy') })).toBeTruthy()
  })

  it('reports a synchronous clipboard refusal as a failed copy', () => {
    const throwing = vi.fn(() => { throw new Error('no clipboard') })
    stubClipboard(throwing)
    mount(callSnapshot([call({ text: 'nope' })]))
    openDetail(1)
    fireEvent.click(within(detailRow()).getByRole('button', { name: say('detail.copy') }))
    expect(throwing).toHaveBeenCalledTimes(1)
    expect(within(detailRow()).getByRole('button', { name: say('detail.copyFailed') })).toBeTruthy()
  })

  it('renders no copy control when the host has no Clipboard API', () => {
    mount(callSnapshot([call({ text: 'body' })]))
    openDetail(1)
    expect(within(detailRow()).queryByRole('button', { name: say('detail.copy') })).toBeNull()
  })

  it('copies the raw arguments while the raw view is active', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    stubClipboard(writeText)
    mount(callSnapshot([call({ name: 'bash', args: '{"command":"ls"}', text: 'done' })]))
    openDetail(1)
    fireEvent.click(within(detailRow()).getByRole('button', { name: '{}' }))
    await act(async () => {
      fireEvent.click(within(detailRow()).getByRole('button', { name: say('detail.copy') }))
    })
    expect(writeText).toHaveBeenCalledWith('{\n  "command": "ls"\n}')

    // Leaving the raw view copies the rendered body again.
    fireEvent.click(within(detailRow()).getByRole('button', { name: '{}' }))
    await act(async () => {
      fireEvent.click(within(detailRow()).getByRole('button', { name: say('detail.copied') }))
    })
    expect(writeText).toHaveBeenLastCalledWith('done')
  })

  it('copies the diff fallback when a call left no result text', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    stubClipboard(writeText)
    mount(callSnapshot([
      call({ callId: 'both', name: 'bash', before: 'old', after: 'new' }),
      call({ callId: 'after', name: 'bash', before: null, after: 'newer' }),
      call({ callId: 'before', name: 'bash', before: 'older', after: null }),
    ], { tools: [tool('bash', 3)] }))
    openDetail(1)
    const copies = within(detailRow()).getAllByRole('button', { name: say('detail.copy') })
    expect(copies).toHaveLength(3)
    await act(async () => {
      fireEvent.click(copies[0] as HTMLElement)
    })
    expect(writeText).toHaveBeenLastCalledWith('old\nnew')
    await act(async () => {
      fireEvent.click(copies[1] as HTMLElement)
    })
    expect(writeText).toHaveBeenLastCalledWith('newer')
    await act(async () => {
      fireEvent.click(copies[2] as HTMLElement)
    })
    expect(writeText).toHaveBeenLastCalledWith('older')
  })
})

describe('call bodies', () => {
  it('renders diffs, read envelopes, result text, truncation, and empty bodies', () => {
    mount(callSnapshot([
      call({ callId: 'diff', name: 'edit', before: 'a\nx', after: 'a\ny' }),
      call({ callId: 'edit-empty', name: 'edit' }),
      call({
        callId: 'file',
        name: 'read',
        text: '<path>/repo/file.ts</path>\n<content>\n1: alpha\n  2: beta\nplain\n</content>',
      }),
      call({ callId: 'no-path', name: 'read', text: '<content>\nbody\n</content>' }),
      call({ callId: 'reversed', name: 'read', text: '</content><content>' }),
      call({ callId: 'read-null', name: 'read' }),
      call({ callId: 'unterminated', name: 'read', text: '<content>unterminated' }),
      call({ callId: 'no-envelope', name: 'read', text: 'no envelope' }),
      call({ callId: 'empty-text', name: 'read', text: '' }),
      call({ callId: 'truncated', name: 'grep', text: 'hello', truncated: true }),
      call({ callId: 'plain', name: 'bash', text: 'one\ntwo' }),
      call({ callId: 'plain-null', name: 'bash' }),
    ], { tools: [tool('read', 7), tool('edit', 2), tool('grep', 1), tool('bash', 2)] }))

    openDetail(1)
    const blocks = callBlocks()
    expect(blocks).toHaveLength(12)

    const diff = blocks[0] as HTMLElement
    expect(within(diff).getByText(say('detail.diff'))).toBeTruthy()
    expect(within(diff).getByText('− x')).toBeTruthy()
    expect(within(diff).getByText('+ y')).toBeTruthy()

    const file = blocks[2] as HTMLElement
    expect(file.textContent).toContain(`/repo/file.ts · ${say('detail.lines', { lines: formatTokens(4) })}`)
    expect(file.textContent).toContain('alpha')
    expect(file.textContent).toContain('beta')
    expect(file.textContent).toContain('plain')
    expect(file.textContent).not.toContain('1: alpha')
    expect(file.textContent).not.toContain('2: beta')

    expect((blocks[3] as HTMLElement).textContent).toContain(say('detail.file'))
    expect((blocks[3] as HTMLElement).textContent).toContain('body')
    expect((blocks[4] as HTMLElement).textContent).toContain('</content><content>')
    expect((blocks[6] as HTMLElement).textContent).toContain('<content>unterminated')
    expect((blocks[7] as HTMLElement).textContent).toContain('no envelope')
    expect((blocks[8] as HTMLElement).querySelectorAll('pre span')).toHaveLength(0)
    expect((blocks[9] as HTMLElement).textContent).toContain(say('detail.truncated', { chars: formatTokens(5) }))
    expect((blocks[9] as HTMLElement).textContent).toContain('hello')
    expect((blocks[10] as HTMLElement).textContent).toContain('one')
    expect((blocks[10] as HTMLElement).textContent).toContain('two')

    expect(within(detailRow()).getAllByText(say('detail.emptyBody'))).toHaveLength(3)
    expect(within(detailRow()).queryAllByRole('button', { name: '{}' })).toHaveLength(0)
  })

  it('diffs pure insertions, pure removals, and replacements in the first column', () => {
    mount(callSnapshot([
      call({ callId: 'insert', name: 'edit', before: 'a', after: 'x\na' }),
      call({ callId: 'remove', name: 'edit', before: 'x\na', after: 'a' }),
      call({ callId: 'replace', name: 'edit', before: 'x\na', after: 'b\na' }),
    ], { tools: [tool('edit', 3)] }))
    openDetail(1)
    const blocks = callBlocks()
    expect(within(blocks[0] as HTMLElement).getByText('+ x')).toBeTruthy()
    expect(within(blocks[1] as HTMLElement).getByText('− x')).toBeTruthy()
    expect(within(blocks[2] as HTMLElement).getByText('− x')).toBeTruthy()
    expect(within(blocks[2] as HTMLElement).getByText('+ b')).toBeTruthy()
  })

  it('shows unparseable argument text verbatim and wrapped', () => {
    mount(callSnapshot([call({ name: 'bash', args: 'line one\nline two', text: null })]))
    openDetail(1)
    fireEvent.click(within(detailRow()).getByRole('button', { name: '{}' }))
    const detail = detailRow()
    expect(within(detail).getByText(say('detail.args'))).toBeTruthy()
    expect(within(detail).getByText('line one')).toBeTruthy()
    expect(within(detail).getByText('line two')).toBeTruthy()
    expect(within(detail).getByText('line one').closest('pre')?.classList.contains(css.codeWrap!)).toBe(true)
    expect(detail.textContent).not.toContain(say('detail.emptyBody'))
  })

  it('caps long result text and long diffs', () => {
    const longText = Array.from({ length: 1_201 }, (_, index) => `row ${index}`).join('\n')
    mount(callSnapshot([call({ name: 'bash', text: longText })], { tools: [tool('bash', 1)] }))
    openDetail(1)
    expect(within(detailRow()).getByText(say('detail.lineCap', {
      shown: formatTokens(400),
      total: formatTokens(1_201),
    }))).toBeTruthy()
    expect(within(detailRow()).getByText('row 399')).toBeTruthy()
    expect(within(detailRow()).queryByText('row 400')).toBeNull()

    cleanup()
    const before = Array.from({ length: 301 }, (_, index) => `old ${index}`).join('\n')
    const after = Array.from({ length: 301 }, (_, index) => `new ${index}`).join('\n')
    mount(callSnapshot([call({ name: 'edit', before, after })], { tools: [tool('edit', 1)] }))
    openDetail(1)
    const detail = detailRow()
    expect(within(detail).getByText(say('detail.lineCap', {
      shown: formatTokens(400),
      total: formatTokens(602),
    }))).toBeTruthy()
    expect(within(detail).getByText('− old 0')).toBeTruthy()

    cleanup()
    const added = Array.from({ length: 500 }, (_, index) => `add ${index}`).join('\n')
    mount(callSnapshot([call({ name: 'edit', before: 'tiny', after: added })], { tools: [tool('edit', 1)] }))
    openDetail(1)
    const grown = detailRow()
    expect(within(grown).getByText(say('detail.lineCap', {
      shown: formatTokens(400),
      total: formatTokens(501),
    }))).toBeTruthy()
    expect(within(grown).getByText('− tiny')).toBeTruthy()
    expect(within(grown).getByText('+ add 0')).toBeTruthy()
  })
})

describe('step filters', () => {
  /** One turn with 25 steps; two steps used read, all 25 used bash. */
  function longTurn(): PerfSnapshot {
    const steps = Array.from({ length: 25 }, (_, index) => step({
      step: index + 1,
      startTime: BASE + index * 1_000,
      endTime: BASE + index * 1_000 + 1_000,
      context: 1_000 + index,
      tools: index < 2 ? [tool('read', 1), tool('bash', 1)] : [tool('bash', 1)],
    }))
    return {
      turns: [turn({ steps, tools: [tool('read', 2), tool('bash', 25)] })],
      stepCount: steps.length,
    }
  }

  it('switches between the newest limit and all steps and filters both pools', () => {
    mount(longTurn())
    expect(screen.getByText(say('steps.total', { total: 25 }))).toBeTruthy()
    expect(stepRows()).toHaveLength(24)
    expect(stepRow(2)).toBeTruthy()
    expect(bodyRows().some(row => (row.textContent ?? '').startsWith(say('step.label', { step: 1 })))).toBe(false)

    const readChip = (): HTMLElement => screen.getByRole('button', { name: 'read ×2' })
    expect(readChip().getAttribute('aria-pressed')).toBe('false')
    expect(readChip().getAttribute('title')).toBe(say('steps.filter', { tool: 'read' }))

    fireEvent.click(screen.getByRole('button', { name: say('steps.all', { total: 25 }) }))
    expect(stepRows()).toHaveLength(25)
    expect(stepRow(1)).toBeTruthy()
    expect(screen.getByRole('button', { name: say('steps.tail', { limit: 24 }) })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'bash ×25' }))
    expect(readChip().getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText(say('steps.matched', { count: 25, tool: 'bash' }))).toBeTruthy()
    expect(screen.getByRole('button', { name: say('steps.tail', { limit: 24 }) })).toBeTruthy()
    expect(screen.queryByRole('button', { name: say('steps.all', { total: 25 }) })).toBeNull()
    expect(stepRows()).toHaveLength(25)

    fireEvent.click(readChip())
    expect(screen.getByText(say('steps.matched', { count: 2, tool: 'read' }))).toBeTruthy()
    expect(stepRows()).toHaveLength(2)
    expect(readChip().getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: say('steps.tail', { limit: 24 }) })).toBeNull()
    expect(screen.queryByRole('button', { name: say('steps.all', { total: 2 }) })).toBeNull()

    fireEvent.click(readChip())
    expect(readChip().getAttribute('aria-pressed')).toBe('false')
    expect(stepRows()).toHaveLength(25)

    fireEvent.click(screen.getByRole('button', { name: say('steps.tail', { limit: 24 }) }))
    expect(stepRows()).toHaveLength(24)

    fireEvent.click(screen.getByRole('button', { name: 'bash ×25' }))
    expect(screen.getByText(say('steps.matched', { count: 25, tool: 'bash' }))).toBeTruthy()
    expect(stepRows()).toHaveLength(24)
    expect(screen.getByRole('button', { name: say('steps.all', { total: 25 }) })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: say('steps.clear') }))
    expect(screen.queryByText(say('steps.matched', { count: 25, tool: 'bash' }))).toBeNull()
    expect(screen.queryByRole('button', { name: say('steps.clear') })).toBeNull()
    expect(stepRows()).toHaveLength(24)
  })

})

describe('live clock', () => {
  it('ticks a running turn and stops when it settles', () => {
    vi.useFakeTimers()
    vi.setSystemTime(BASE)
    const store = mount({
      turns: [turn({ running: true, wall: null, startTime: BASE - 2_000 })],
      stepCount: 0,
    })
    expect(cellsOf(rowWithPrefix(say('turn.label', { turn: 1 })))[10]?.textContent)
      .toBe(`≥ ${formatMs(2_000)}`)
    expect(timeTitle(rowWithPrefix(say('turn.label', { turn: 1 })))).toContain(say('bar.running'))

    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(cellsOf(rowWithPrefix(say('turn.label', { turn: 1 })))[10]?.textContent)
      .toBe(`≥ ${formatMs(3_000)}`)

    act(() => {
      store.set({ turns: [turn({ wall: 500 })], stepCount: 0 })
    })
    expect(cellsOf(rowWithPrefix(say('turn.label', { turn: 1 })))[10]?.textContent).toBe(formatMs(500))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ticks a running step inside a settled turn', () => {
    vi.useFakeTimers()
    vi.setSystemTime(BASE)
    const store = mount(turnSnapshot([
      step({ running: true, wall: null, startTime: BASE - 3_000, endTime: null }),
    ]))
    const running = stepRow(1)
    expect(cellsOf(running)[10]?.textContent).toBe(`≥ ${formatMs(3_000)}`)
    expect(timeTitle(running)).toContain(say('bar.start', { clock: formatClock(BASE - 3_000) }))
    expect(timeTitle(running)).toContain(say('bar.running'))

    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(cellsOf(stepRow(1))[10]?.textContent).toBe(`≥ ${formatMs(4_000)}`)

    act(() => {
      store.set(turnSnapshot([step({ wall: 2_000, startTime: BASE - 3_000 })]))
    })
    expect(cellsOf(stepRow(1))[10]?.textContent).toBe(formatMs(2_000))
    expect(vi.getTimerCount()).toBe(0)
  })
})

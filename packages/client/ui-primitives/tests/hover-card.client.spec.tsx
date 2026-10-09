// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HoverCard, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { POINTER_GRACE_MS } from '../src/pointer-grace.ts'

afterEach(cleanup)
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(any-hover: hover)' }))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

/** Anchor wrapper rect: the card positions from this (jsdom rects are all-zero by default). */
function stubAnchorRect(anchor: HTMLElement, rect: { top: number; right: number }): void {
  const wrapper = anchor.parentElement as HTMLElement
  wrapper.getBoundingClientRect = () => ({
    top: rect.top, right: rect.right, left: rect.right - 100, bottom: rect.top + 34,
    width: 100, height: 34, x: rect.right - 100, y: rect.top, toJSON: () => ({}),
  })
}

function mount(props: {
  widthAnchorRef?: { current: HTMLElement | null }
  variant?: 'compact' | 'preview' | 'callout'
  openDelayMs?: number
  disabled?: boolean
  copyText?: string
  copyLabel?: string
  copiedLabel?: string
} = {}) {
  const view = render(
    <HoverCard
      anchor={<span>row</span>}
      content={<div>card body</div>}
      copyLabel={props.copyLabel ?? 'Copy'}
      copiedLabel={props.copiedLabel ?? 'Copied'}
      {...props}
    />,
  )
  const anchor = screen.getByText('row')
  stubAnchorRect(anchor, { top: 40, right: 200 })
  return { view, anchor, wrapper: anchor.parentElement as HTMLElement }
}

/** Install the async browser clipboard and restore its prior host shape. */
function installClipboard(writeText: (text: string) => Promise<void>): () => void {
  const prior = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  return () => {
    if (prior === undefined) Reflect.deleteProperty(navigator, 'clipboard')
    else Object.defineProperty(navigator, 'clipboard', prior)
  }
}

describe('HoverCard', () => {
  it.each([false, true])('opens mouse previews only when a pointer can hover: %s', (canHover) => {
    vi.stubGlobal('matchMedia', () => ({ matches: canHover }))
    const { wrapper } = mount()
    const event = new Event('pointerover', { bubbles: true })
    Object.defineProperty(event, 'pointerType', { value: 'mouse' })
    fireEvent(wrapper, event)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('card body') !== null).toBe(canHover)
  })

  it.each(['compact', 'preview'] as const)('does not open a %s card when a touch enters the anchor', (variant) => {
    const { wrapper } = mount({ variant })
    const event = new Event('pointerover', { bubbles: true })
    Object.defineProperty(event, 'pointerType', { value: 'touch' })
    fireEvent(wrapper, event)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('card body')).toBeNull()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('card body')).toBeTruthy()
  })

  it.each(['disabled', 'unmounted'] as const)('keeps its preview mounted while a nested tooltip shows and is then %s', (released) => {
    const markup = (state: 'active' | 'disabled' | 'unmounted') => (
      <HoverCard
        anchor={<div>row{state !== 'unmounted' && (
          <Tooltip label="Create" disabled={state === 'disabled'}><button type="button">action</button></Tooltip>
        )}</div>}
        content={<div>card body</div>}
        copyLabel="Copy"
        copiedLabel="Copied"
      />
    )
    const view = render(markup('active'))
    fireEvent.pointerEnter(screen.getByText('row').parentElement as HTMLElement)
    act(() => { vi.advanceTimersByTime(500) })
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'action' }))
    expect(screen.getByRole('tooltip').textContent).toBe('Create')
    const card = screen.getByText('card body')
    expect(card.isConnected).toBe(true)

    view.rerender(markup(released))
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.getByText('card body')).toBe(card)
  })

  it('keeps card content mounted while its own tooltip is visible', () => {
    render(<HoverCard
      anchor={<span>row</span>}
      content={<div>card body<Tooltip label="Details"><button type="button">card action</button></Tooltip></div>}
      copyLabel="Copy"
      copiedLabel="Copied"
    />)
    fireEvent.pointerEnter(screen.getByText('row').parentElement as HTMLElement)
    act(() => { vi.advanceTimersByTime(500) })
    const card = screen.getByText('card body')
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'card action' }))
    expect(card.isConnected).toBe(true)
    expect(screen.getByRole('tooltip').textContent).toBe('Details')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(card.isConnected).toBe(true)
    expect(screen.getByRole('tooltip').textContent).toBe('Details')
  })

  it('opens after the dwell delay, positioned right of the anchor', () => {
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    expect(screen.queryByText('card body')).toBeNull()
    act(() => { vi.advanceTimersByTime(499) })
    expect(screen.queryByText('card body')).toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    const card = screen.getByText('card body').parentElement as HTMLElement
    expect(card.parentElement).toBe(document.body)
    expect(card.style.left).toBe('208px')
    expect(card.style.top).toBe('40px')
  })

  it('insets a preview by 24px on each side and follows anchor resizing', () => {
    const { wrapper } = mount({ variant: 'preview' })
    wrapper.getBoundingClientRect = () => DOMRect.fromRect({ x: 100, y: 600, width: 600, height: 32 })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    const card = screen.getByText('card body').parentElement as HTMLElement
    expect(card.style.width).toBe('552px')
    expect(card.style.left).toBe('124px')
    expect(card.style.maxHeight).toBe('420px')
    wrapper.getBoundingClientRect = () => DOMRect.fromRect({ x: 100, y: 600, width: 400, height: 32 })
    fireEvent(window, new Event('resize'))
    expect(card.style.width).toBe('352px')
    fireEvent.keyDown(wrapper, { key: 'Escape' })
    act(() => { vi.advanceTimersByTime(100) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('places previews below rows near the top and dismisses without anchor focus', () => {
    const { wrapper } = mount({ variant: 'preview' })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    const card = screen.getByText('card body').parentElement as HTMLElement
    expect(card.style.top).toBe('82px')
    expect(card.style.maxHeight).toBe('420px')
    fireEvent.keyDown(document.body, { key: 'a' })
    expect(screen.queryByText('card body')).not.toBeNull()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    act(() => { vi.advanceTimersByTime(100) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('caps a callout, keeps its caret on the anchor, and flips it above when needed', () => {
    const { wrapper } = mount({ variant: 'callout' })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    const card = screen.getByText('card body').closest('[data-placement]') as HTMLElement
    const body = card.querySelector<HTMLElement>('[data-hover-card-scroll]') as HTMLElement
    expect(card.style.width).toBe('300px')
    expect(card.style.left).toBe('8px')
    expect(card.style.top).toBe('82px')
    expect(card.dataset.placement).toBe('below')
    expect(card.style.getPropertyValue('--dsh-hover-card-max-height')).toBe('240px')
    expect(card.style.getPropertyValue('--dsh-hover-card-anchor-x')).toBe('142px')

    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 600 })
    wrapper.getBoundingClientRect = () => DOMRect.fromRect({ x: 100, y: 700, width: 100, height: 34 })
    fireEvent(window, new Event('resize'))
    expect(card.style.top).toBe('452px')
    expect(card.dataset.placement).toBe('above')
    expect(card.style.getPropertyValue('--dsh-hover-card-max-height')).toBe('240px')
  })

  it('observes preview and container sizes until dismissal', () => {
    let resize = () => {}
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe = observe
      disconnect = disconnect
    })
    const container = document.createElement('div')
    container.getBoundingClientRect = () => DOMRect.fromRect({ x: 10, width: 700 })
    const { wrapper, view } = mount({ variant: 'preview', widthAnchorRef: { current: container } })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    const card = screen.getByText('card body').parentElement as HTMLElement
    expect(observe).toHaveBeenCalledWith(card)
    expect(observe).toHaveBeenCalledWith(container)
    expect(card.style.width).toBe('652px')
    expect(card.style.left).toBe('34px')
    container.getBoundingClientRect = () => DOMRect.fromRect({ x: 10, width: 500 })
    act(() => { resize() })
    expect(card.style.width).toBe('452px')
    const previousDisconnects = disconnect.mock.calls.length
    view.unmount()
    expect(disconnect.mock.calls.length).toBe(previousDisconnects + 1)
  })

  it('retains a dismissing preview for 100ms and cancels dismissal on re-entry', () => {
    const { wrapper, view } = mount({ variant: 'preview' })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    const card = screen.getByText('card body').parentElement as HTMLElement
    fireEvent.pointerLeave(wrapper)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
    expect(card.hasAttribute('data-closing')).toBe(true)
    act(() => { vi.advanceTimersByTime(99) })
    expect(screen.queryByText('card body')).not.toBeNull()
    fireEvent.pointerEnter(wrapper)
    expect(card.hasAttribute('data-closing')).toBe(false)
    act(() => { vi.advanceTimersByTime(100) })
    expect(screen.queryByText('card body')).not.toBeNull()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    act(() => { vi.advanceTimersByTime(100) })
    expect(screen.queryByText('card body')).toBeNull()
    fireEvent.pointerDown(wrapper)
    expect(vi.getTimerCount()).toBe(0)
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('honors a custom openDelayMs', () => {
    const { wrapper } = mount({ openDelayMs: 50 })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(50) })
    expect(screen.getByText('card body')).toBeTruthy()
  })

  it('pins on click for touch access and keeps the card through pointer leave and blur', () => {
    render(
      <>
        <p id="existing-description">Existing description</p>
        <HoverCard
          inline
          openOnClick
          anchor={<button type="button" aria-describedby="existing-description">details</button>}
          content={<div>card body</div>}
        />
      </>,
    )
    const anchor = screen.getByRole('button', { name: 'details' })
    const wrapper = anchor.parentElement as HTMLElement
    const touch = new Event('pointerover', { bubbles: true })
    Object.defineProperty(touch, 'pointerType', { value: 'touch' })
    fireEvent(wrapper, touch)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.queryByText('card body')).toBeNull()

    fireEvent.click(anchor)
    const card = screen.getByText('card body').parentElement as HTMLElement
    expect(card.getAttribute('data-pinned')).toBe('true')
    expect(anchor.getAttribute('aria-describedby')).toBe(`existing-description ${card.id}`)
    fireEvent.pointerLeave(wrapper)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
    fireEvent.blur(anchor, { relatedTarget: document.body })
    expect(screen.getByText('card body')).toBeTruthy()

    fireEvent.pointerLeave(card)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
    expect(screen.getByText('card body')).toBeTruthy()
    fireEvent.pointerDown(card)
    expect(screen.getByText('card body')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByText('card body')).toBeNull()
    expect(anchor.getAttribute('aria-describedby')).toBe('existing-description')
  })

  it('preserves a caller-owned accessible description while click-pinned', () => {
    render(<>
      <p id="stable-description">Stable description</p>
      <HoverCard
        inline
        openOnClick
        describeAnchor={false}
        anchor={<button type="button" aria-describedby="stable-description">details</button>}
        content={<div>card body</div>}
      />
    </>)
    const anchor = screen.getByRole('button', { name: 'details' })
    expect(anchor.getAttribute('aria-describedby')).toBe('stable-description')
    fireEvent.click(anchor)
    expect(screen.getByText('card body')).toBeTruthy()
    expect(anchor.getAttribute('aria-describedby')).toBe('stable-description')
    fireEvent.pointerDown(document.body)
    expect(screen.queryByText('card body')).toBeNull()
    expect(anchor.getAttribute('aria-describedby')).toBe('stable-description')
  })

  it('dismisses a click-open card on another click, Escape, or Tab', () => {
    const ownerKey = vi.fn()
    render(<div onKeyDown={ownerKey}>
      <HoverCard openOnClick anchor={<button type="button">details</button>} content={<div>card body</div>} />
    </div>)
    const anchor = screen.getByRole('button', { name: 'details' })

    fireEvent.click(anchor)
    expect(screen.getByText('card body')).toBeTruthy()
    fireEvent.click(anchor)
    expect(screen.queryByText('card body')).toBeNull()

    fireEvent.click(anchor)
    fireEvent.keyDown(anchor, { key: 'a' })
    expect(screen.getByText('card body')).toBeTruthy()
    ownerKey.mockClear()
    expect(fireEvent.keyDown(anchor, { key: 'Escape' })).toBe(false)
    expect(ownerKey).not.toHaveBeenCalled()
    expect(screen.queryByText('card body')).toBeNull()

    fireEvent.click(anchor)
    expect(fireEvent.keyDown(anchor, { key: 'Tab' })).toBe(true)
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('drops a click pin when the card is disabled', () => {
    const pinnedCard = (disabled = false) => (
      <HoverCard openOnClick disabled={disabled} anchor={<button type="button">details</button>} content={<div>card body</div>} />
    )
    const view = render(pinnedCard())
    const anchor = screen.getByRole('button', { name: 'details' })
    fireEvent.click(anchor)
    expect(screen.getByText('card body')).toBeTruthy()
    view.rerender(pinnedCard(true))
    expect(screen.queryByText('card body')).toBeNull()

  })

  it('removes click-pin dismissal listeners on unmount', () => {
    const view = render(
      <HoverCard openOnClick anchor={<button type="button">details</button>} content={<div>card body</div>} />,
    )
    const registrations = vi.spyOn(document, 'addEventListener')
    const removals = vi.spyOn(document, 'removeEventListener')
    fireEvent.click(screen.getByRole('button', { name: 'details' }))
    expect(screen.getByText('card body')).toBeTruthy()

    const listeners = registrations.mock.calls.filter(([type]) => type === 'keydown' || type === 'pointerdown')
    expect(listeners.map(([type]) => type).sort()).toEqual(['keydown', 'pointerdown'])
    view.unmount()

    for (const [type, listener, options] of listeners) {
      const removed = removals.mock.calls.find(([removedType, removedListener]) =>
        removedType === type && removedListener === listener)
      expect(removed).toBeDefined()
      expect(removed?.[2]).toBe(options)
    }
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(true)
    fireEvent.pointerDown(document.body)
  })

  it('dismisses on keyboard clicks and cancels a pending hover', () => {
    const { anchor, wrapper } = mount({ variant: 'preview' })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(499) })
    fireEvent.click(anchor, { detail: 0 })
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByText('card body')).toBeNull()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    fireEvent.click(screen.getByText('card body'))
    expect(screen.getByText('card body').parentElement?.hasAttribute('data-closing')).toBe(false)
    fireEvent.click(anchor, { detail: 0 })
    expect(screen.getByText('card body').parentElement?.hasAttribute('data-closing')).toBe(true)
    act(() => { vi.advanceTimersByTime(100) })
    expect(screen.queryByText('card body')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps previews below the desktop frame clearance', () => {
    const prior = document.documentElement.style.getPropertyValue('--dsh-frame-top-clearance')
    const priority = document.documentElement.style.getPropertyPriority('--dsh-frame-top-clearance')
    document.documentElement.style.setProperty('--dsh-frame-top-clearance', '100px')
    try {
      const { wrapper } = mount({ variant: 'preview' })
      wrapper.getBoundingClientRect = () => DOMRect.fromRect({ x: 100, y: 600, width: 600, height: 32 })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      const card = screen.getByText('card body').parentElement as HTMLElement
      Object.defineProperty(card, 'offsetHeight', { configurable: true, value: 420 })
      wrapper.getBoundingClientRect = () => DOMRect.fromRect({ x: 100, y: 450, width: 600, height: 32 })
      fireEvent(window, new Event('resize'))
      expect(card.style.top).toBe('120px')
      expect(card.style.maxHeight).toBe('322px')
    } finally {
      if (prior === '') document.documentElement.style.removeProperty('--dsh-frame-top-clearance')
      else document.documentElement.style.setProperty('--dsh-frame-top-clearance', prior, priority)
    }
  })

  it('pointerleave before the delay cancels the pending open', () => {
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    fireEvent.pointerLeave(wrapper)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('pointerleave closes an open card a grace later; re-enter after that restarts the dwell', () => {
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('card body')).toBeTruthy()
    fireEvent.pointerLeave(wrapper)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS - 1) })
    expect(screen.getByText('card body')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByText('card body')).toBeNull()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('card body')).toBeTruthy()
  })

  it('reaching the card inside the grace keeps it open without restarting the dwell', () => {
    // The portaled card is a React child of the wrapper, so the pointer
    // arriving on it re-enters the wrapper — the gesture an anchor gap
    // would make impossible.
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    fireEvent.pointerLeave(wrapper)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS - 50) })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS * 10) })
    expect(screen.getByText('card body')).toBeTruthy()
  })

  it('keeps the card open while its own pointer is inside and closes after leaving it', () => {
    const { wrapper } = mount({ variant: 'callout' })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    const card = screen.getByText('card body').closest('[data-placement]') as HTMLElement
    fireEvent.pointerLeave(wrapper)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS - 50) })
    fireEvent.pointerEnter(card)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
    expect(screen.getByText('card body')).toBeTruthy()
    fireEvent.pointerLeave(card)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('re-entering while open does not queue a second dwell', () => {
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    fireEvent.pointerEnter(wrapper)
    fireEvent.pointerLeave(wrapper)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
    // A dwell restarted by the redundant enter would reopen the card here.
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('a press inside the anchor dismisses the card without waiting for disabled', () => {
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('card body')).toBeTruthy()
    fireEvent.pointerDown(screen.getByText('row'))
    expect(screen.queryByText('card body')).toBeNull()
    // The pending timer is also cleared: no reopen after the dwell.
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('a press on the card starts a selection instead of dismissing it', () => {
    // The card is a React child of the wrapper, so capture-phase presses on
    // it reach the wrapper's dismissal handler too; they must not close it,
    // or the first pointerdown of a text-selection drag would kill the card.
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    fireEvent.pointerDown(screen.getByText('card body'))
    // Still mounted after a grace's worth of time: no close was armed either.
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
    expect(screen.getByText('card body')).toBeTruthy()
  })

  it('keeps a completed card selection instead of treating its click as copy', async () => {
    const writeText = vi.fn(async () => {})
    const restoreClipboard = installClipboard(writeText)
    const selection = window.getSelection()
    if (selection === null) throw new Error('jsdom selection API unavailable')
    try {
      const { wrapper } = mount({ copyText: 'card body', copyLabel: 'Copy' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      const card = screen.getByRole('button', { name: 'Copy: card body' })
      const selectedText = screen.getByText('card body')
      const cardRange = document.createRange()
      cardRange.selectNodeContents(selectedText)
      selection.addRange(cardRange)
      await act(async () => { fireEvent.click(card) })
      expect(writeText).not.toHaveBeenCalled()
      expect(selection.toString()).toBe('card body')
      expect(screen.getByText('card body')).toBeTruthy()

      // Firefox supports multiple selection ranges: any range intersecting
      // this card wins, not only the first.
      selection.removeAllRanges()
      const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue({
        isCollapsed: false,
        rangeCount: 2,
        getRangeAt: vi.fn((index: number) => ({
          intersectsNode: () => index === 1,
        })),
      } as unknown as Selection)
      await act(async () => { fireEvent.click(card) })
      expect(writeText).not.toHaveBeenCalled()
      getSelection.mockRestore()

      // A non-collapsed selection elsewhere does not block this card.
      const anchorRange = document.createRange()
      anchorRange.selectNodeContents(screen.getByText('row'))
      selection.addRange(anchorRange)
      await act(async () => { fireEvent.click(card) })
      expect(writeText).toHaveBeenCalledWith('card body')
    } finally {
      selection.removeAllRanges()
      restoreClipboard()
    }
  })

  it('a press while closed leaves the card closed', () => {
    mount()
    fireEvent.pointerDown(screen.getByText('row'))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('copies its configured value and shows success only for the feedback window', async () => {
    const writeText = vi.fn(async () => {})
    const restoreClipboard = installClipboard(writeText)
    try {
      const { wrapper } = mount({
        copyText: '/full/path',
        copyLabel: 'Copy path',
        copiedLabel: 'Copied',
      })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      const card = screen.getByRole('button', { name: 'Copy path: /full/path' })
      const status = screen.getByRole('status')
      expect(status.textContent).toBe('')
      expect(card.contains(status)).toBe(false)
      Object.defineProperty(card, 'offsetHeight', { configurable: true, value: 96 })
      await act(async () => { fireEvent.click(card) })
      expect(writeText).toHaveBeenCalledWith('/full/path')
      expect(status.textContent).toBe('Copied')
      expect(screen.getByRole('button', { name: 'Copy path: /full/path' })).toBe(card)
      expect(card.style.minHeight).toBe('96px')
      // Repeated activation while feedback is visible neither rewrites nor
      // extends the one-second success window.
      await act(async () => { fireEvent.click(card) })
      expect(writeText).toHaveBeenCalledOnce()
      act(() => { vi.advanceTimersByTime(999) })
      expect(status.textContent).toBe('Copied')
      act(() => { vi.advanceTimersByTime(1) })
      expect(screen.getByRole('button', { name: 'Copy path: /full/path' })).toBe(card)
      expect(card.style.minHeight).toBe('')
      expect(status.textContent).toBe('')
      expect(screen.getByText('card body')).toBeTruthy()
    } finally {
      restoreClipboard()
    }
  })

  it('supports button keys and ignores unrelated keys', async () => {
    const writeText = vi.fn(async () => {})
    const restoreClipboard = installClipboard(writeText)
    try {
      const { wrapper } = mount({ copyText: 'value', copiedLabel: 'Copied' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      const card = screen.getByRole('button')
      fireEvent.keyDown(card, { key: 'Escape' })
      expect(writeText).not.toHaveBeenCalled()
      await act(async () => { fireEvent.keyDown(card, { key: 'Enter' }) })
      expect(writeText).toHaveBeenCalledOnce()
      act(() => { vi.advanceTimersByTime(1000) })
      await act(async () => { fireEvent.keyDown(card, { key: ' ' }) })
      expect(writeText).toHaveBeenCalledTimes(2)
    } finally {
      restoreClipboard()
    }
  })

  it('keeps its content when the clipboard rejects the write', async () => {
    const writeText = vi.fn(async () => { throw new Error('denied') })
    const restoreClipboard = installClipboard(writeText)
    try {
      const { wrapper } = mount({ copyText: 'value', copiedLabel: 'Copied' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      await act(async () => { fireEvent.click(screen.getByRole('button')) })
      expect(screen.queryByText('Copied')).toBeNull()
      expect(screen.getByText('card body')).toBeTruthy()
    } finally {
      restoreClipboard()
    }
  })

  it('unmount clears copied feedback', async () => {
    const writeText = vi.fn(async () => {})
    const restoreClipboard = installClipboard(writeText)
    try {
      const { view, wrapper } = mount({ copyText: 'value' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      await act(async () => { fireEvent.click(screen.getByRole('button')) })
      expect(vi.getTimerCount()).toBe(1)
      view.unmount()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      restoreClipboard()
    }
  })

  it('clears copied feedback when the card closes', async () => {
    const writeText = vi.fn(async () => {})
    const restoreClipboard = installClipboard(writeText)
    try {
      const { wrapper } = mount({ copyText: 'value', copiedLabel: 'Copied' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      await act(async () => { fireEvent.click(screen.getByRole('button')) })
      expect(screen.getByRole('status').textContent).toBe('Copied')
      fireEvent.pointerLeave(wrapper)
      act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
      expect(screen.queryByText('Copied')).toBeNull()
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getByText('card body')).toBeTruthy()
    } finally {
      restoreClipboard()
    }
  })

  it('does not create copied feedback after an in-flight write unmounts', async () => {
    let acceptWrite: (() => void) | undefined
    const writeText = vi.fn(() => new Promise<void>((resolve) => { acceptWrite = resolve }))
    const restoreClipboard = installClipboard(writeText)
    try {
      const { view, wrapper } = mount({ copyText: 'value' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      fireEvent.click(screen.getByRole('button'))
      expect(writeText).toHaveBeenCalledOnce()
      view.unmount()
      await act(async () => { acceptWrite?.() })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      restoreClipboard()
    }
  })

  it('does not restore copied feedback after an in-flight card closes', async () => {
    let acceptWrite: (() => void) | undefined
    const writeText = vi.fn(() => new Promise<void>((resolve) => { acceptWrite = resolve }))
    const restoreClipboard = installClipboard(writeText)
    try {
      const { wrapper } = mount({ copyText: 'value', copiedLabel: 'Copied' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      fireEvent.click(screen.getByRole('button'))
      fireEvent.pointerLeave(wrapper)
      act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      await act(async () => { acceptWrite?.() })
      expect(vi.getTimerCount()).toBe(0)
      expect(screen.getByText('card body')).toBeTruthy()
    } finally {
      restoreClipboard()
    }
  })

  it('coalesces activations while the clipboard write is in flight', async () => {
    let acceptWrite: (() => void) | undefined
    const writeText = vi.fn(() => new Promise<void>((resolve) => { acceptWrite = resolve }))
    const restoreClipboard = installClipboard(writeText)
    try {
      const { wrapper } = mount({ copyText: 'value', copiedLabel: 'Copied' })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      const card = screen.getByRole('button')
      fireEvent.click(card)
      fireEvent.click(card)
      expect(writeText).toHaveBeenCalledOnce()
      await act(async () => { acceptWrite?.() })
      expect(screen.getByRole('status').textContent).toBe('Copied')
    } finally {
      restoreClipboard()
    }
  })

  it('disabled suppresses opening entirely', () => {
    const { wrapper } = mount({ disabled: true })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('flipping disabled true closes an open card', () => {
    const { view, wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('card body')).toBeTruthy()
    view.rerender(
      <HoverCard
        anchor={<span>row</span>}
        content={<div>card body</div>}
        copyLabel="Copy"
        copiedLabel="Copied"
        disabled
      />,
    )
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('corrects the bottom-edge clamp once the mounted card height is measurable', () => {
    // First placement reads height 0 (card not yet mounted) and keeps the
    // anchor top; the post-mount correction re-clamps with the real height.
    window.innerHeight = 300
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 120 })
    try {
      const { wrapper } = mount()
      stubAnchorRect(screen.getByText('row'), { top: 280, right: 200 })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      const card = screen.getByText('card body').parentElement as HTMLElement
      // 300 - 120 - 8 = 172, instead of the anchor top 280.
      expect(card.style.top).toBe('172px')
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
    }
  })

  it('clamps inside placement itself when the card is already measured (resize path)', () => {
    window.innerHeight = 300
    const { wrapper } = mount()
    stubAnchorRect(screen.getByText('row'), { top: 280, right: 200 })
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    const card = screen.getByText('card body').parentElement as HTMLElement
    Object.defineProperty(card, 'offsetHeight', { value: 120 })
    act(() => { fireEvent.resize(window) })
    expect(card.style.top).toBe('172px')
  })

  it('repositions on capture-phase scroll while open and stops listening after close', () => {
    const { wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    stubAnchorRect(screen.getByText('row'), { top: 90, right: 300 })
    act(() => { fireEvent.scroll(document) })
    const card = screen.getByText('card body').parentElement as HTMLElement
    expect(card.style.left).toBe('308px')
    expect(card.style.top).toBe('90px')
    fireEvent.pointerLeave(wrapper)
    act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
    expect(screen.queryByText('card body')).toBeNull()
  })

  it('unmount clears a pending open timer', () => {
    const { view, wrapper } = mount()
    fireEvent.pointerEnter(wrapper)
    view.unmount()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('card body')).toBeNull()
  })
})

it('opens inline previews only for keyboard focus and closes when focus leaves the anchor', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const anchor = <><button>first</button><button>second</button></>
  const view = render(<HoverCard inline anchor={anchor} content={<span>thumbnail</span>} />)
  const first = screen.getByRole('button', { name: 'first' })
  const second = screen.getByRole('button', { name: 'second' })
  const matches = vi.spyOn(first, 'matches').mockReturnValue(false)
  fireEvent.focus(first)
  expect(screen.queryByText('thumbnail')).toBeNull()
  matches.mockReturnValue(true)
  fireEvent.focus(first)
  expect(screen.getByText('thumbnail')).toBeTruthy()
  fireEvent.blur(first, { relatedTarget: second })
  expect(screen.getByText('thumbnail')).toBeTruthy()
  fireEvent.blur(second, { relatedTarget: document.body })
  expect(screen.queryByText('thumbnail')).toBeNull()
  view.rerender(<HoverCard inline disabled anchor={anchor} content={<span>thumbnail</span>} />)
  fireEvent.focus(first)
  expect(screen.queryByText('thumbnail')).toBeNull()
  matches.mockRestore()
})

it('keeps an inline preview open when the pointer leaves its focused anchor', () => {
  render(<HoverCard inline anchor={<button>details</button>} content={<span>thumbnail</span>} />)
  const anchor = screen.getByRole('button', { name: 'details' })
  const matches = vi.spyOn(anchor, 'matches').mockReturnValue(true)
  fireEvent.focus(anchor)
  expect(screen.getByText('thumbnail')).toBeTruthy()
  const activeElement = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(anchor)
  fireEvent.pointerLeave(anchor.parentElement as HTMLElement)
  act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
  expect(screen.getByText('thumbnail')).toBeTruthy()
  activeElement.mockRestore()
  fireEvent.blur(anchor, { relatedTarget: document.body })
  expect(screen.queryByText('thumbnail')).toBeNull()
  matches.mockRestore()
})

it('dismisses an inline hover without anchor focus and lets the next Escape reach the owner', () => {
  const ownerKey = vi.fn()
  render(<div onKeyDown={ownerKey}>
    <button>outside</button>
    <HoverCard inline anchor={<button>image link</button>} content={<span>thumbnail</span>} />
  </div>)
  const outside = screen.getByRole('button', { name: 'outside' })
  outside.focus()
  const wrapper = screen.getByRole('button', { name: 'image link' }).parentElement!
  // jsdom lacks PointerEvent; preserve its pointerType through a regular DOM event.
  const touch = new Event('pointerover', { bubbles: true })
  Object.defineProperty(touch, 'pointerType', { value: 'touch' })
  fireEvent(wrapper, touch)
  act(() => { vi.advanceTimersByTime(500) })
  expect(screen.queryByText('thumbnail')).toBeNull()
  fireEvent.pointerEnter(wrapper)
  act(() => { vi.advanceTimersByTime(500) })
  expect(document.activeElement).toBe(outside)
  fireEvent.keyDown(outside, { key: 'a' })
  expect(screen.getByText('thumbnail')).toBeTruthy()
  ownerKey.mockClear()
  fireEvent.keyDown(outside, { key: 'Escape' })
  expect(screen.queryByText('thumbnail')).toBeNull()
  expect(ownerKey).not.toHaveBeenCalled()
  fireEvent.keyDown(outside, { key: 'Escape' })
  expect(ownerKey).toHaveBeenCalledOnce()
})

it('flips inline media above a bottom link and constrains it without covering the anchor', () => {
  render(<HoverCard inline anchor={<button>image link</button>} content={<span>thumbnail</span>} />)
  const wrapper = screen.getByRole('button').parentElement!
  wrapper.getBoundingClientRect = () => DOMRect.fromRect({ x: window.innerWidth - 100, y: window.innerHeight - 60, width: 80, height: 24 })
  fireEvent.pointerEnter(wrapper)
  act(() => { vi.advanceTimersByTime(500) })
  const card = screen.getByText('thumbnail').parentElement!
  Object.defineProperty(card, 'offsetHeight', { configurable: true, value: 28 })
  Object.defineProperty(card, 'scrollHeight', { configurable: true, value: 220 })
  fireEvent.resize(window)
  expect(Number.parseFloat(card.style.top) + 220).toBe(window.innerHeight - 68)
  expect(Number.parseFloat(card.style.left) + Number.parseFloat(card.style.width)).toBe(window.innerWidth - 8)
  // Neither side fits: constrain the larger side and keep the link unobstructed.
  Object.defineProperty(card, 'offsetHeight', { configurable: true, value: 1000 })
  fireEvent.resize(window)
  expect(card.style.top).toBe('8px')
  expect(Number.parseFloat(card.style.maxHeight)).toBe(window.innerHeight - 76)
  wrapper.getBoundingClientRect = () => DOMRect.fromRect({ x: 30, y: 10, width: 80, height: 24 })
  fireEvent.resize(window)
  expect(card.style.top).toBe('42px')
  expect(Number.parseFloat(card.style.maxHeight)).toBe(window.innerHeight - 50)
})

it('closes a compact copyable card after its mouse-focused card loses the pointer', () => {
  const { wrapper } = mount({ copyText: 'value' })
  fireEvent.pointerEnter(wrapper)
  act(() => { vi.advanceTimersByTime(500) })
  const card = screen.getByRole('button', { name: 'Copy: value' })
  act(() => { card.focus() })
  expect(document.activeElement).toBe(card)
  fireEvent.pointerLeave(card)
  act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
  expect(screen.queryByText('card body')).toBeNull()
})

it('closes a callout hover after click toggling leaves mouse focus on the anchor', () => {
  render(<HoverCard variant="callout" openOnClick anchor={<button>details</button>} content="body" />)
  const anchor = screen.getByRole('button', { name: 'details' })
  act(() => { anchor.focus() })
  fireEvent.click(anchor)
  fireEvent.click(anchor)
  fireEvent.pointerEnter(anchor.parentElement as HTMLElement)
  act(() => { vi.advanceTimersByTime(500) })
  expect(screen.getByText('body')).toBeTruthy()
  fireEvent.pointerLeave(anchor.parentElement as HTMLElement)
  act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS) })
  expect(screen.queryByText('body')).toBeNull()
})

it('scrolls an open callout with the focused anchor keyboard controls', () => {
  render(<HoverCard variant="callout" openOnClick anchor={<button>details</button>} content="body" />)
  const anchor = screen.getByRole('button', { name: 'details' })
  fireEvent.click(anchor)
  const scroll = document.querySelector<HTMLElement>('[data-hover-card-scroll]') as HTMLElement
  Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 160 })
  Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 640 })
  expect(fireEvent.keyDown(scroll, { key: 'PageDown' })).toBe(true)
  expect(scroll.scrollTop).toBe(0)
  for (const [key, top] of [['ArrowDown', 20], ['ArrowUp', 0], ['PageDown', 160], ['PageUp', 0], ['End', 640], ['Home', 0]] as const) {
    expect(fireEvent.keyDown(anchor, { key })).toBe(false)
    expect(scroll.scrollTop).toBe(top)
  }
  fireEvent.keyDown(anchor, { key: 'Tab' })
  expect(screen.queryByText('body')).toBeNull()
})

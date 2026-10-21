/**
 * The floating layer: one overlay panel per floating pane, bottom-to-top in the
 * model's z order. A floating pane hosts exactly one tab; its header is the
 * strip's row holding that tab's chip, never selectable or closable from the
 * chip, and the send-back and close controls. Pressing a panel's body raises it. Its grip
 * and corner report through their gesture instead: a press released in place is
 * a click and raises the panel; a drag records the move or resize, and that
 * operation raises the panel itself, so one gesture is one intent. Raising a
 * panel that is active and on top already changes nothing and reports nothing.
 *
 * The layer owns its own drag and resize gestures, so where it mounts is not
 * part of its contract: panels are positioned in viewport coordinates and read
 * only `state` and the outward contracts. An embedder may portal it anywhere,
 * and nothing here assumes the docked tree is an ancestor or even present.
 */
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import clsx from 'clsx'
import { IconCloseOutlineRegular, IconPanelLeftOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DockIntents, DockLabels, TabRenderer } from '../contract/adapter.ts'
import type { FloatRect, LayoutState, PaneId, TabId, TabRecord } from '../contract/types.ts'
import { FLOAT_MIN_SIZE } from '../engine/constraints.ts'
import {
  boundedResize, legalFloatRect, movedRect, resistedRect, resizedRect, unresistedRect, type FloatBounds,
} from '../engine/geometry.ts'
import {
  SPRING_DEADLINE_MS, SPRING_MAX_FRAME_MS, SPRING_MAX_VELOCITY, SPRING_STALL_MS, springSettled, stepSpring, type SpringAxis,
} from '../engine/spring.ts'
import { floatRect, getPane, getTab, onlyTabId } from '../engine/tree.ts'
import { useGesture } from './pointer.ts'
import { TabTitle } from './TabTitle.tsx'
import css from './dockkit.module.css'

/** The layout whose `floats` this layer draws. */
export interface FloatLayerProps {
  readonly state: LayoutState
  readonly intents: DockIntents
  readonly labels: DockLabels
  readonly renderTab: TabRenderer
  /** Whether a floating tab offers its close control; defaults to true. Called per tab on every render. */
  readonly canCloseTab?: (tabId: TabId) => boolean
  /** The panel header's title content; omit to show the record's `title` text (see `DockSurfaceProps`). */
  readonly renderTabTitle?: TabRenderer
}

/** A floating-panel gesture: what it moves and where it started. */
interface FloatDrag {
  readonly mode: 'move' | 'resize'
  readonly originX: number
  readonly originY: number
  readonly rect: FloatRect
}

/** The rectangle the pointer travel asks for, before the viewport has its say. */
function draggedRect(drag: FloatDrag, x: number, y: number): FloatRect {
  const dx = x - drag.originX
  const dy = y - drag.originY
  return drag.mode === 'move'
    ? movedRect(drag.rect, dx, dy)
    : resizedRect(drag.rect, dx, dy, FLOAT_MIN_SIZE)
}

/** Whether two rectangles agree in every coordinate. */
function sameRect(a: FloatRect, b: FloatRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/** Whether a floating pane is already where a raise would put it: focused and on top. */
function raised(state: LayoutState, paneId: PaneId): boolean {
  return state.activePaneId === paneId && state.floats.at(-1) === paneId
}

/**
 * The viewport region panels stay inside. It reads the window size and the
 * root's caption attributes only, so starting a gesture never forces layout.
 */
function floatBounds(): FloatBounds {
  const root = document.documentElement
  const windows = root.hasAttribute('data-windows-titlebar')
  // Desktop publishes the caption height in pixels on the root's inline style.
  const caption = windows && !root.hasAttribute('data-fullscreen')
    ? Number.parseFloat(root.style.getPropertyValue('--dsh-windows-titlebar-height')) : 0
  return { top: windows ? caption + 20 : 0, width: window.innerWidth, height: window.innerHeight }
}

/** Whether the platform asks for reduced motion; environments without `matchMedia` (jsdom) report no preference. */
function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** How much recent pointer history the release velocity is measured over. */
const VELOCITY_WINDOW_MS = 100

/** One pointer position and when it was read. */
interface PointerSample {
  readonly t: number
  readonly x: number
  readonly y: number
}

/** Pointer velocity over the last `VELOCITY_WINDOW_MS`, capped per axis, in pixels per second. */
function releaseVelocity(samples: readonly PointerSample[]): { readonly x: number; readonly y: number } {
  const last = samples[samples.length - 1] as PointerSample
  const first = samples.find(sample => last.t - sample.t <= VELOCITY_WINDOW_MS) as PointerSample
  if (last.t === first.t) return { x: 0, y: 0 }
  const rate = (travel: number): number =>
    Math.max(-SPRING_MAX_VELOCITY, Math.min(SPRING_MAX_VELOCITY, travel / (last.t - first.t) * 1000))
  return { x: rate(last.x - first.x), y: rate(last.y - first.y) }
}

/** A panel springing back inside the viewport after a release past an edge. */
interface Settling {
  readonly paneId: PaneId
  readonly target: FloatRect
  readonly started: number
  x: SpringAxis
  y: SpringAxis
  last: number
  frame: number
}

/**
 * Shared move/resize gestures; changing layout mode never owns the content DOM.
 * Panels draw at their stored rectangle projected into the viewport, so a
 * shrinking window pushes them in without recording anything. A move past an
 * edge draws with resistance; its release records the legal rectangle and the
 * panel springs there from where it was drawn.
 * @param state - committed layout and float stacking order.
 * @param intents - gesture settlements.
 * @returns the current preview, the rectangle to draw per panel, and focus/gesture callbacks.
 */
export function useFloatGestures(state: LayoutState, intents: DockIntents) {
  const [preview, setPreview] = useState<{ paneId: PaneId; rect: FloatRect } | undefined>(undefined)
  const [bounds, setBounds] = useState(floatBounds)
  const settling = useRef<Settling | undefined>(undefined)
  const begin = useGesture(() => { setPreview(undefined) })

  /** Stop a running return where it is; reports whether one was running. */
  const cancelSettling = useRef((): boolean => {
    const running = settling.current
    if (running === undefined) return false
    cancelAnimationFrame(running.frame)
    settling.current = undefined
    return true
  }).current

  useEffect(() => {
    const resize = (): void => {
      if (cancelSettling()) setPreview(undefined)
      setBounds(floatBounds())
    }
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      cancelSettling()
    }
  }, [cancelSettling])

  /** One animation frame of a return: advance the spring, or end it at its target. */
  const frame = (): void => {
    const running = settling.current as Settling
    const now = performance.now()
    const gap = now - running.last
    running.last = now
    if (gap <= SPRING_STALL_MS && now - running.started < SPRING_DEADLINE_MS) {
      const dt = Math.min(gap, SPRING_MAX_FRAME_MS) / 1000
      running.x = stepSpring(running.x, running.target.x, dt)
      running.y = stepSpring(running.y, running.target.y, dt)
      if (!springSettled(running.x, running.target.x) || !springSettled(running.y, running.target.y)) {
        setPreview({ paneId: running.paneId, rect: { ...running.target, x: running.x.position, y: running.y.position } })
        running.frame = requestAnimationFrame(frame)
        return
      }
    }
    settling.current = undefined
    setPreview(undefined)
  }

  /** Spring a panel from where it was drawn to its recorded rectangle; a legal axis keeps still. */
  const settle = (paneId: PaneId, from: FloatRect, target: FloatRect, velocity: { x: number; y: number }): void => {
    const axis = (position: number, goal: number, speed: number): SpringAxis =>
      ({ position, velocity: position === goal ? 0 : speed })
    const now = performance.now()
    settling.current = {
      paneId, target, started: now, last: now,
      x: axis(from.x, target.x, velocity.x), y: axis(from.y, target.y, velocity.y),
      frame: requestAnimationFrame(frame),
    }
    setPreview({ paneId, rect: from })
  }

  /** Focus and raise a panel from a press or click on it, unless it is raised already. */
  const raise = (paneId: PaneId): void => {
    if (raised(state, paneId)) return
    intents.focusPane(paneId)
  }

  /**
   * Where a panel draws: its gesture or return preview, otherwise its stored
   * rectangle projected into the viewport.
   * @param paneId - the floating pane.
   * @param stored - its recorded rectangle.
   * @returns the rectangle to draw.
   */
  const rectOf = (paneId: PaneId, stored: FloatRect): FloatRect =>
    preview?.paneId === paneId ? preview.rect : legalFloatRect(stored, bounds)

  /** Start a move or resize from a press on the panel's grip or corner; a release that moved nothing is a click. */
  const drag = (mode: 'move' | 'resize', paneId: PaneId, event: ReactPointerEvent<HTMLElement>): void => {
    // The press stops here: the panel's own press-to-focus would record a focus
    // entry before the drag's, and the release below decides which one it is.
    event.stopPropagation()
    // A press during a return takes the panel from where it is drawn.
    const drawn = settling.current?.paneId === paneId ? preview?.rect : undefined
    cancelSettling()
    const area = floatBounds()
    const reduce = reducedMotion()
    const stored = floatRect(getPane(state, paneId))
    const shown = drawn ?? legalFloatRect(stored, area)
    const rect = mode === 'move' && !reduce ? unresistedRect(shown, area) : legalFloatRect(shown, area)
    const start: FloatDrag = { mode, originX: event.clientX, originY: event.clientY, rect }
    const samples: PointerSample[] = [{ t: performance.now(), x: event.clientX, y: event.clientY }]
    /** The rectangle to draw for a pointer position, and the legal one a release there records. */
    const reached = (x: number, y: number): { readonly drawn: FloatRect; readonly legal: FloatRect } => {
      const desired = draggedRect(start, x, y)
      if (mode === 'resize') {
        const resized = boundedResize(desired, area, FLOAT_MIN_SIZE)
        return { drawn: resized, legal: resized }
      }
      const legal = legalFloatRect(desired, area)
      return { drawn: reduce ? legal : resistedRect(desired, area), legal }
    }
    begin(event.currentTarget, event.pointerId, {
      move: (moved) => {
        samples.push({ t: performance.now(), x: moved.clientX, y: moved.clientY })
        setPreview({ paneId, rect: reached(moved.clientX, moved.clientY).drawn })
      },
      up: (released) => {
        samples.push({ t: performance.now(), x: released.clientX, y: released.clientY })
        const { drawn, legal } = reached(released.clientX, released.clientY)
        if (sameRect(legal, stored)) raise(paneId)
        else if (mode === 'move') intents.moveFloat(paneId, legal.x, legal.y)
        else intents.resizeFloat(paneId, legal)
        if (!sameRect(drawn, legal)) settle(paneId, drawn, legal, releaseVelocity(samples))
      },
    })
  }

  return { preview, raise, drag, rectOf }
}

/**
 * Header-only controls, usable above either retained or visibility-mounted bodies.
 * @param props - owning pane/tab, localized labels and gesture callbacks.
 * @returns the float header without a content container.
 */
export function FloatHeader({ paneId, tab, labels, intents, renderTabTitle, canCloseTab, drag }: {
  readonly paneId: PaneId
  readonly tab: TabRecord
  readonly labels: DockLabels
  readonly intents: DockIntents
  readonly renderTabTitle: TabRenderer | undefined
  readonly canCloseTab: ((id: TabId) => boolean) | undefined
  readonly drag: ReturnType<typeof useFloatGestures>['drag']
}): ReactNode {
  return (
    <header className={clsx(css.tabStrip, css.floatHeader)} data-dockkit-float-grip={paneId}
      onPointerDown={(event) => { drag('move', paneId, event) }}>
      <div className={clsx(css.tab, css.floatTitle)} data-dockkit-float-title>
        <TabTitle>{renderTabTitle?.(tab) ?? tab.title}</TabTitle>
      </div>
      <div className={css.stripFill} />
      <Tooltip label={labels.dockFloat} side="bottom" delayMs={500}>
        <button type="button" className={css.iconButton} aria-label={labels.dockFloat}
          data-dockkit-float-dock={paneId} onPointerDown={(event) => { event.stopPropagation() }}
          onClick={() => { intents.unfloatPane(paneId) }}>
          <IconPanelLeftOutlineRegular className={css.dockGlyph} />
        </button>
      </Tooltip>
      {(canCloseTab?.(tab.id) ?? true) && (
        <Tooltip label={labels.closeTab} shortcutKeys={labels.closeTabKeys} side="bottom" delayMs={500}>
          <button type="button" className={css.iconButton} aria-label={labels.closeTab}
            data-dockkit-float-close={paneId} onPointerDown={(event) => { event.stopPropagation() }}
            onClick={() => { intents.closeTab(tab.id) }}>
            <IconCloseOutlineRegular />
          </button>
        </Tooltip>
      )}
    </header>
  )
}

/** Every floating panel, in z order. */
export function FloatLayer({ state, intents, labels, renderTab, renderTabTitle, canCloseTab }: FloatLayerProps): ReactNode {
  const { preview, raise, drag, rectOf } = useFloatGestures(state, intents)

  return (
    <>
      {state.floats.map((paneId, depth) => {
        const pane = getPane(state, paneId)
        const tab = getTab(state, onlyTabId(pane))
        // A panel mid-gesture draws where the pointer has taken it and on top,
        // as the operation its release records will leave it.
        const lifted = preview?.paneId === paneId ? preview.rect : undefined
        const live = rectOf(paneId, floatRect(pane))
        return (
          <div
            key={paneId}
            className={css.float}
            data-dockkit-float={paneId}
            tabIndex={-1}
            data-dockkit-float-active={state.activePaneId === paneId || undefined}
            style={{
              left: live.x,
              top: `max(var(--dsh-dockkit-float-top, 0px), ${live.y}px)`,
              width: live.width,
              height: live.height,
              zIndex: lifted === undefined ? depth + 1 : state.floats.length + 1,
            }}
            onPointerDown={() => { raise(paneId) }}
          >
            <FloatHeader {...{ paneId, tab, labels, intents, renderTabTitle, canCloseTab, drag }} />
            <div className={css.floatBody}>{renderTab(tab)}</div>
            <div
              className={css.floatResize}
              data-dockkit-float-resize={paneId}
              onPointerDown={(event) => { drag('resize', paneId, event) }}
            />
          </div>
        )
      })}
    </>
  )
}

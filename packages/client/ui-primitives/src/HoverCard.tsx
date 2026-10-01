import { cloneElement, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode, RefObject, SyntheticEvent } from 'react'
import clsx from 'clsx'
import { createPortal } from 'react-dom'
import { writeClipboard } from './clipboard.ts'
import { usePointerGrace } from './pointer-grace.ts'
import { overlayTopMargin } from './overlay-top-margin.ts'
import { HoverCardGroupContext } from './HoverCardGroup.tsx'
import { useDismissOnOutsidePointer } from './useDismissOnOutsidePointer.ts'
import css from './HoverCard.module.css'

/** Preview opacity transition and retained lifetime during dismissal. */
const PREVIEW_FADE_MS = 100
const PREVIEW_MAX_HEIGHT = 420
const PREVIEW_INSET = 24
const INLINE_PREVIEW_WIDTH = 300
const CALLOUT_MAX_HEIGHT = 240
const CALLOUT_WIDTH = 300
const CALLOUT_ARROW_EDGE_INSET = 16
const CALLOUT_SURFACE_INSET = 4
const ANCHOR_GAP = 8
const VIEWPORT_MARGIN = 8

interface DescribedAnchorProps {
  'aria-describedby'?: string | undefined
}

type HoverCardProps = {
  /** Inline media preview using the shared menu material and keyboard focus. */
  inline?: boolean
  content: ReactNode
  openDelayMs?: number
  disabled?: boolean
  grouped?: boolean
  variant?: 'compact' | 'preview' | 'callout'
  widthAnchorRef?: RefObject<HTMLElement | null>
} & ({
  anchor: ReactElement<DescribedAnchorProps>
  openOnClick: true
  describeAnchor?: boolean
} | {
  anchor: ReactNode
  openOnClick?: false | undefined
  describeAnchor?: never
}) & ({ copyText?: string | undefined; copyLabel: string; copiedLabel: string } | {
  copyText?: undefined
  copyLabel?: string
  copiedLabel?: string
})

/**
 * Render an anchor with a hover-triggered preview card independently of nested tooltips.
 * @param props.anchor - the hover target (rendered in place inside a wrapper span). With
 * openOnClick, pass one focusable element that forwards ARIA props.
 * @param props.content - card content; the pointer may rest on it, so it is
 * readable and selectable, but it carries no dismissal affordance of its own.
 * @param props.openDelayMs - hover dwell before the card shows (default 500).
 * @param props.variant - compact card beside the anchor; a preview with container-relative
 * width and opacity transitions; or a 300px callout with an anchor caret and 240px height cap.
 * @param props.widthAnchorRef - optional element whose width and horizontal position size the preview.
 * @param props.inline - keep the anchor in prose; show a contained preview on hover or keyboard focus.
 * @param props.disabled - suppress opening; turning true dismisses an open card.
 * @param props.grouped - share first-display dwell across the surrounding list and active portal.
 * Group replacement removes the previous card immediately, including a fading preview.
 * @param props.openOnClick - clicking or touching the anchor pins the card open. Another activation,
 * Escape, Tab, or an outside pointerdown dismisses it; pointer leave and blur do not dismiss a pinned card.
 * @param props.describeAnchor - with openOnClick, append the open card to the anchor's accessible
 * description (default true). Set false when the caller supplies a stable description relationship.
 * @param props.copyText - optional primary value copied by activation and
 * included in the card's accessible name.
 * @param props.copyLabel - localized accessible activation-label prefix.
 * @param props.copiedLabel - localized visible success label.
 * @returns anchor wrapper with the conditional portaled card.
 */
export function HoverCard(props: HoverCardProps) {
  const {
    content, openDelayMs = 500, disabled = false, grouped = false, describeAnchor = true,
    copyText, copyLabel, copiedLabel, variant = 'compact', widthAnchorRef, inline = false,
  } = props
  const openOnClick = props.openOnClick === true
  const callout = variant === 'callout'
  const anchored = inline || callout
  const id = useId()
  const rootRef = useRef<HTMLSpanElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyHeightRef = useRef<number | null>(null)
  const copyEpochRef = useRef(0)
  const copyingRef = useRef(false)
  const mountedRef = useRef(true)
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed')
  const open = phase !== 'closed'
  const closing = phase === 'closing'
  const [pos, setPos] = useState<{
    left: number
    top: number
    width?: number
    maxHeight?: number
    anchorX?: number
    placement?: 'above' | 'below'
  } | null>(null)
  const positioned = pos !== null
  const [copied, setCopied] = useState(false)
  const parentGroup = useContext(HoverCardGroupContext)
  const group = grouped ? parentGroup : null
  const [groupOwner] = useState(() => Symbol('hover-card'))
  const [pinned, setPinned] = useState(false)

  const clearCopied = useCallback(() => {
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current)
      copyTimerRef.current = null
    }
    copyHeightRef.current = null
    setCopied(false)
  }, [])

  const close = useCallback(() => {
    copyEpochRef.current += 1
    clearCopied()
    setPinned(false)
    setPhase(current => variant === 'preview' && current !== 'closed' ? 'closing' : 'closed')
  }, [clearCopied, variant])

  const { arm: armClose, cancel: cancelClose } = usePointerGrace(close)
  useDismissOnOutsidePointer(rootRef, openOnClick && open, close, cardRef)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const dismissImmediately = useCallback(() => {
    clearTimer()
    cancelClose()
    copyEpochRef.current += 1
    clearCopied()
    setPhase('closed')
  }, [clearTimer, cancelClose, clearCopied])
  // A fading preview still owns the group's visible card until it unmounts or another card replaces it.
  const groupVisible = open && positioned
  useLayoutEffect(() => {
    if (!groupVisible || group === null) return
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- The visible card's ref is attached before layout effects.
    group.shown(groupOwner, dismissImmediately, cardRef.current!)
    return () => { group.release(groupOwner) }
  }, [group, groupOwner, groupVisible, dismissImmediately])

  useEffect(() => {
    if (!closing) return
    const timer = setTimeout(() => { setPhase('closed') }, PREVIEW_FADE_MS)
    return () => { clearTimeout(timer) }
  }, [closing])

  // Owner disabling mid-hover (menu opened, drag started) starts dismissal.
  useEffect(() => {
    if (!disabled) return
    clearTimer()
    cancelClose()
    close()
  }, [disabled, cancelClose, close])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      copyEpochRef.current += 1
      clearTimer()
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current)
        copyTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!open || openOnClick || (variant !== 'preview' && !anchored)) return
    const dismiss = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (inline) event.stopPropagation()
      clearTimer()
      cancelClose()
      close()
    }
    window.addEventListener('keydown', dismiss, inline)
    return () => { window.removeEventListener('keydown', dismiss, inline) }
  }, [open, openOnClick, variant, anchored, cancelClose, close])

  useEffect(() => {
    if (!openOnClick || !open) return
    const dismiss = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' && event.key !== 'Tab') return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
      }
      clearTimer()
      cancelClose()
      close()
    }
    document.addEventListener('keydown', dismiss, true)
    return () => { document.removeEventListener('keydown', dismiss, true) }
  }, [open, openOnClick, cancelClose, close])

  useEffect(() => {
    if (pinned && !openOnClick) close()
  }, [close, openOnClick, pinned])

  // Fixed-position from the anchor rect before paint; track the anchor while
  // open (capture-phase scroll catches nested panes), as in Menu portal mode.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const place = () => {
      const wrapper = rootRef.current
      /* v8 ignore next -- the ref is attached before the layout effect runs and the listeners die with it. */
      if (wrapper === null) return
      const r = wrapper.getBoundingClientRect()
      const h = cardRef.current?.offsetHeight ?? 0
      if (variant === 'preview') {
        const bounds = widthAnchorRef?.current?.getBoundingClientRect() ?? r
        const width = Math.max(0, Math.min(bounds.width - PREVIEW_INSET * 2, window.innerWidth - VIEWPORT_MARGIN * 2))
        const topMargin = overlayTopMargin(VIEWPORT_MARGIN)
        const belowTop = Math.max(topMargin, r.bottom + ANCHOR_GAP)
        const above = Math.max(0, r.top - ANCHOR_GAP - topMargin)
        const below = Math.max(0, window.innerHeight - belowTop - VIEWPORT_MARGIN)
        const onTop = above >= Math.min(PREVIEW_MAX_HEIGHT, below)
        const maxHeight = Math.min(PREVIEW_MAX_HEIGHT, onTop ? above : below)
        setPos({
          left: Math.max(VIEWPORT_MARGIN, Math.min(bounds.left + PREVIEW_INSET, window.innerWidth - width - VIEWPORT_MARGIN)),
          top: onTop ? Math.max(topMargin, r.top - Math.min(h, maxHeight) - ANCHOR_GAP) : belowTop,
          width, maxHeight,
        })
        return
      }
      if (anchored) {
        const height = callout
          ? Math.max(h, (scrollRef.current?.scrollHeight ?? 0) + CALLOUT_SURFACE_INSET * 2)
          : Math.max(h, cardRef.current?.scrollHeight ?? 0)
        const width = Math.max(0, Math.min(callout ? CALLOUT_WIDTH : INLINE_PREVIEW_WIDTH,
          window.innerWidth - VIEWPORT_MARGIN * 2))
        const topMargin = overlayTopMargin(VIEWPORT_MARGIN)
        const belowTop = Math.max(topMargin, r.bottom + ANCHOR_GAP)
        const above = Math.max(0, r.top - ANCHOR_GAP - topMargin)
        const below = Math.max(0, window.innerHeight - belowTop - VIEWPORT_MARGIN)
        const onTop = height > below && above > below
        const maxHeight = Math.min(callout ? CALLOUT_MAX_HEIGHT : Number.POSITIVE_INFINITY,
          onTop ? above : below)
        const anchorCenter = (r.left + r.right) / 2
        const idealLeft = callout ? anchorCenter - width / 2 : r.left
        const left = Math.max(VIEWPORT_MARGIN, Math.min(idealLeft,
          window.innerWidth - width - VIEWPORT_MARGIN))
        const arrowInset = Math.min(CALLOUT_ARROW_EDGE_INSET, width / 2)
        setPos({
          left,
          top: onTop ? r.top - ANCHOR_GAP - Math.min(height, maxHeight) : belowTop,
          width, maxHeight,
          ...(callout
            ? {
              anchorX: Math.max(arrowInset, Math.min(anchorCenter - left, width - arrowInset)),
              placement: onTop ? 'above' as const : 'below' as const,
            }
            : {}),
        })
        return
      }
      const top = r.top + h > window.innerHeight - VIEWPORT_MARGIN ? window.innerHeight - h - VIEWPORT_MARGIN : r.top
      setPos({ left: r.right + ANCHOR_GAP, top })
    }
    place()
    const observer = (variant === 'preview' || anchored) && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null
    for (const element of [cardRef.current, scrollRef.current, rootRef.current, widthAnchorRef?.current]) {
      if (element !== null && element !== undefined) observer?.observe(element)
    }
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, variant, widthAnchorRef, positioned, anchored, callout])

  // The first placement ran before the card mounted (height read 0): once the
  // card's real height is measurable, correct the bottom-edge clamp. The
  // correction converges — a clamped top satisfies the guard, so it runs once.
  useLayoutEffect(() => {
    if (!open || pos === null || variant === 'preview' || anchored) return
    /* v8 ignore next -- the card is mounted whenever pos is set, so the ref is attached here. */
    const h = cardRef.current?.offsetHeight ?? 0
    if (pos.top + h > window.innerHeight - VIEWPORT_MARGIN) {
      setPos({ left: pos.left, top: window.innerHeight - h - VIEWPORT_MARGIN })
    }
  }, [open, pos, variant, anchored])

  const copy = async (text: string): Promise<void> => {
    if (copied || copyingRef.current) return
    copyingRef.current = true
    const copyEpoch = copyEpochRef.current
    const accepted = await writeClipboard(text)
    copyingRef.current = false
    const card = cardRef.current
    if (!accepted || !mountedRef.current || copyEpoch !== copyEpochRef.current || card === null) return
    const height = card.offsetHeight
    copyHeightRef.current = height > 0 ? height : null
    setCopied(true)
    copyTimerRef.current = setTimeout(clearCopied, 1000)
  }

  const copyable = copyText !== undefined
  const describedAnchor = props.openOnClick === true && describeAnchor
    ? cloneElement(props.anchor, {
      'aria-describedby': open
        ? [props.anchor.props['aria-describedby'], id].filter(Boolean).join(' ')
        : props.anchor.props['aria-describedby'],
    })
    : props.anchor
  const dismissFromAnchor = (event: SyntheticEvent<HTMLSpanElement>): void => {
    // Portal content is a React child, but its clicks and text selection do not activate the anchor.
    if (cardRef.current?.contains(event.target as Node)) return
    clearTimer()
    cancelClose()
    if (openOnClick && !disabled && !pinned) {
      setPinned(true)
      setPhase('open')
      return
    }
    close()
  }
  const cardContent = copied ? <span className={css.copied} aria-hidden="true">{copiedLabel}</span> : content
  const card = open && pos !== null && (
    <div
      ref={cardRef}
      id={openOnClick ? id : undefined}
      className={clsx(css.card, variant === 'preview' && css.preview, inline && css.media,
        callout && css.callout, copyable && css.copyable, copied && css.feedback)}
      data-closing={closing || undefined}
      data-pinned={pinned || undefined}
      data-placement={callout ? pos.placement : undefined}
      style={{
        left: pos.left, top: pos.top, width: pos.width,
        maxHeight: callout ? undefined : pos.maxHeight,
        minHeight: copied && copyHeightRef.current !== null ? copyHeightRef.current : undefined,
        '--dsh-hover-preview-fade': `${PREVIEW_FADE_MS}ms`,
        '--dsh-hover-card-max-height': pos.maxHeight === undefined ? undefined : `${pos.maxHeight}px`,
        '--dsh-hover-card-anchor-x': pos.anchorX === undefined ? undefined : `${pos.anchorX}px`,
      } as CSSProperties}
      role={copyable ? 'button' : undefined}
      tabIndex={copyable ? 0 : undefined}
      aria-label={copyable ? `${copyLabel}: ${copyText}` : undefined}
      onClick={copyable
        ? (e) => {
          const selection = window.getSelection()
          if (selection !== null && !selection.isCollapsed) {
            for (let i = 0; i < selection.rangeCount; i += 1) {
              if (selection.getRangeAt(i).intersectsNode(e.currentTarget)) return
            }
          }
          void copy(copyText)
        }
        : undefined}
      onKeyDown={copyable
        ? (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          void copy(copyText)
        }
        : undefined}
      onPointerEnter={() => {
        cancelClose()
        setPhase('open')
      }}
      onPointerLeave={() => {
        if (!pinned
          && rootRef.current?.contains(document.activeElement) !== true
          && cardRef.current?.contains(document.activeElement) !== true) armClose()
      }}
    >
      {callout
        ? (
          <>
            <span className={css.calloutCaret} data-hover-card-caret aria-hidden="true" />
            <div className={css.calloutSurface}>
              <div ref={scrollRef} className={css.calloutBody} data-hover-card-scroll>{cardContent}</div>
            </div>
          </>
        )
        : cardContent}
    </div>
  )

  return (
    <span
      ref={rootRef}
      className={clsx(css.root, anchored && css.inline)}
      onFocus={anchored ? (event) => {
        if (!disabled && event.target.matches(':focus-visible')) { cancelClose(); setPhase('open') }
      } : undefined}
      onBlur={anchored ? (event) => {
        if (!pinned && !event.currentTarget.contains(event.relatedTarget)) { clearTimer(); cancelClose(); close() }
      } : undefined}
      onPointerEnter={(event) => {
        if (disabled || event.pointerType === 'touch') return
        if (event.pointerType === 'mouse' && !window.matchMedia('(any-hover: hover)').matches) return
        // Coming back inside during the grace (the gap, or the card itself)
        // keeps the current card rather than restarting the dwell.
        cancelClose()
        if (open) { setPhase('open'); return }
        clearTimer()
        if (group?.isWarm()) setPhase('open')
        else timerRef.current = setTimeout(() => { setPhase('open') }, openDelayMs)
      }}
      onPointerLeave={() => {
        clearTimer()
        // Leaving a closed card schedules a no-op close; only arm while
        // open, matching Menu's shape. Keyboard focus remains an independent
        // open trigger after the pointer leaves.
        if (open && !pinned
          && rootRef.current?.contains(document.activeElement) !== true
          && cardRef.current?.contains(document.activeElement) !== true) armClose()
      }}
      onPointerDownCapture={openOnClick ? undefined : dismissFromAnchor}
      onClickCapture={dismissFromAnchor}
    >
      {describedAnchor}
      {open && copyable && <span className={css.status} role="status">{copied ? copiedLabel : ''}</span>}
      {card !== false && createPortal(card, document.body)}
    </span>
  )
}

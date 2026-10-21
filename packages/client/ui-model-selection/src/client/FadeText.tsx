/**
 * One-line selector text that fades out at its clipped end instead of showing
 * an ellipsis. While the inner run is wider than the box, the box carries
 * `data-model-select-clipped` and the stylesheet masks its last 24px. Both
 * spans are observed, so a narrowed composer, a loaded font, and a label slot
 * that changes its own content all re-read the geometry.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import clsx from 'clsx'
import css from './ModelSelect.module.css'

/**
 * Render clipped text with an end fade.
 * @param props - Placement class for the box and the text it holds.
 * @returns The fading box around an unconstrained text run.
 */
export function FadeText({ className, children }: { className: string | undefined; children: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null)
  const run = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    // Both spans mount unconditionally before this layout effect runs.
    const outer = box.current as HTMLSpanElement
    const inner = run.current as HTMLSpanElement
    const mark = (): void => {
      outer.toggleAttribute('data-model-select-clipped', inner.offsetWidth > outer.clientWidth)
    }
    mark()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(mark)
    observer.observe(outer)
    observer.observe(inner)
    return () => { observer.disconnect() }
  }, [])
  return <span ref={box} className={clsx(css.fade, className)} data-model-select-text>
    <span ref={run} className={css.fadeRun}>{children}</span>
  </span>
}

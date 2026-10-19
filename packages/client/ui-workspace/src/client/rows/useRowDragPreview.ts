/** Offscreen snapshots for native Workspace and Session row dragging. */
import { useEffect, useMemo, useRef } from 'react'
import type { DragEvent } from 'react'
import css from './Rows.module.css'

/**
 * Own a row's inert drag preview until drag end, replacement, or unmount.
 * The offscreen copy keeps WebKit snapshots separate from overlapping panels.
 * @returns preview creation and cleanup callbacks for native drag handlers.
 */
export function useRowDragPreview(): {
  start: (event: DragEvent<HTMLElement>) => void
  clear: () => void
} {
  const current = useRef<HTMLDivElement | null>(null)
  const preview = useMemo(() => {
    const clear = (): void => {
      current.current?.remove()
      current.current = null
    }
    return {
      clear,
      start: (event: DragEvent<HTMLElement>): void => {
        clear()
        const row = event.currentTarget
        const rect = row.getBoundingClientRect()
        const style = getComputedStyle(row)
        const copy = row.cloneNode(true) as HTMLElement
        copy.removeAttribute('data-row-key')
        Object.assign(copy.style, {
          boxSizing: 'border-box', margin: '0', width: '100%', height: '100%',
          color: style.color,
        })
        const image = row.ownerDocument.createElement('div')
        image.className = css.dragPreview as string
        image.inert = true
        image.setAttribute('aria-hidden', 'true')
        Object.assign(image.style, {
          left: `${String(-rect.width)}px`, width: `${String(rect.width)}px`,
          height: `${String(rect.height)}px`, font: style.font,
        })
        image.style.setProperty('--dsh-workspace-indent', style.getPropertyValue('--dsh-workspace-indent'))
        image.append(copy)
        row.ownerDocument.body.append(image)
        current.current = image
        event.dataTransfer.setDragImage(image, event.clientX - rect.left, event.clientY - rect.top)
      },
    }
  }, [])
  useEffect(() => preview.clear, [preview])
  return preview
}

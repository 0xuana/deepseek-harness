/** Original image files supplied to browser and native drag sessions. */
import { useCallback, useEffect, useRef, type DragEvent, type MouseEvent, type PointerEvent } from 'react'

import { IMAGE_DRAG_TYPE, useImageDragTransfer } from './ImageDragProvider.tsx'

/** Application-owned native image transfer; prepared handles never expose host paths. */
export interface DesktopImageDrag {
  /** @returns an opaque handle for the original file, retained until release or application exit. */
  prepare: (bytes: Uint8Array, name: string, mediaType: string) => Promise<string>
  /** Start a system copy drag from an already prepared handle. */
  start: (handle: string) => Promise<boolean>
  /** Release an unused handle; files already handed to the OS survive until application exit. */
  release: (handle: string) => void
}

interface PreparedImage {
  readonly file: File
  readonly handle?: string
}

interface ImageDragHandlers {
  onPointerEnter: () => void
  onPointerDown: (event: PointerEvent<HTMLImageElement>) => void
  onDragStart: (event: DragEvent<HTMLImageElement>) => void
  onDragEnd: () => void
  onClickCapture: (event: MouseEvent) => void
}

/**
 * Prepare original bytes on hover and supply them synchronously when dragging begins.
 * @param src - authorized image URL; changing it retires pending preparation.
 * @param name - suggested original filename, without a directory.
 * @param failureText - localized failure message, including a retry action.
 * @param original - already loaded original file; omitted sources are read from their image URL.
 * @returns drag handlers; cancellation never starts a late drag.
 */
export function useImageDrag(src: string, name: string, failureText: string, original?: File): ImageDragHandlers {
  const desktop = (globalThis as typeof globalThis & { dshDesktop?: { imageDrag?: DesktopImageDrag } }).dshDesktop?.imageDrag
  const state = useRef<{ source: string; prepared?: PreparedImage; pending?: Promise<void> | undefined; abort: AbortController }>()
  const dragged = useRef(false)
  const transfer = useImageDragTransfer()
  const reportFailure = transfer.report
  const prepare = useCallback((): void => {
    const current = state.current
    if (src === '' || current === undefined || current.source !== src || current.pending !== undefined || current.prepared !== undefined) return
    current.pending = (async () => {
      let file = original
      if (file === undefined) {
        const response = await fetch(src, { signal: current.abort.signal, referrerPolicy: 'no-referrer' })
        if (!response.ok) throw new Error('Image read failed')
        const blob = await response.blob()
        if (!blob.type.startsWith('image/')) throw new Error('Image media type unavailable')
        file = new File([blob], name, { type: blob.type })
      }
      if (current.abort.signal.aborted) return
      const handle = desktop === undefined ? undefined
        : await desktop.prepare(new Uint8Array(await file.arrayBuffer()), file.name, file.type)
      if (state.current !== current) {
        if (handle !== undefined) desktop?.release(handle)
        return
      }
      current.prepared = { file, ...handle === undefined ? {} : { handle } }
    })().catch((_error: unknown) => {
      // Preparation is speculative; a failed user gesture reports through the owning image.
    }).finally(() => { current.pending = undefined })
  }, [src, name, original, desktop])
  useEffect(() => {
    const current: NonNullable<typeof state.current> = { source: src, abort: new AbortController() }
    state.current = current
    if (src !== '' && (original !== undefined || new URL(src, location.href).origin === location.origin)) prepare()
    return () => {
      current.abort.abort()
      const prepared = current.prepared
      if (prepared?.handle !== undefined) desktop?.release(prepared.handle)
      state.current = undefined
    }
  }, [src, name, original, desktop, prepare])
  const onDragStart = useCallback((event: DragEvent<HTMLImageElement>): void => {
    if (event.defaultPrevented) return
    dragged.current = true
    const prepared = state.current?.source === src ? state.current.prepared : undefined
    if (prepared === undefined) {
      event.preventDefault()
      prepare()
      reportFailure(failureText)
      return
    }
    event.dataTransfer.items.clear()
    event.dataTransfer.effectAllowed = 'copy'
    if (desktop !== undefined && prepared.handle !== undefined) {
      event.preventDefault()
      void desktop.start(prepared.handle).then((started) => { if (!started) reportFailure(failureText) },
        () => { reportFailure(failureText) })
      return
    }
    event.dataTransfer.setData(IMAGE_DRAG_TYPE, transfer.begin(prepared.file))
    event.dataTransfer.setData('DownloadURL', `${prepared.file.type}:${prepared.file.name}:${src}`)
  }, [src, desktop, prepare, reportFailure, failureText, transfer])
  const onPointerDown = useCallback((event: PointerEvent<HTMLImageElement>): void => {
    dragged.current = false
    if (event.button === 0) prepare()
  }, [prepare])
  const onClickCapture = useCallback((event: MouseEvent): void => {
    if (!dragged.current) return
    event.preventDefault()
    event.stopPropagation()
    dragged.current = false
  }, [])
  return { onPointerEnter: prepare, onPointerDown, onDragStart, onDragEnd: transfer.end, onClickCapture }
}

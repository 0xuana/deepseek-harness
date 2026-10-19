/** Original image files supplied to browser and native drag sessions. */
import { useCallback, useEffect, useRef, type DragEvent, type MouseEvent, type PointerEvent } from 'react'

import { IMAGE_DRAG_TOKEN_TYPE, useImageDragTransfer } from './ImageDragProvider.tsx'

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
  readonly release?: () => void
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
 * Requires an ancestor ImageDragProvider; it owns transfer bytes and feedback across source unmounts.
 * @param src - authorized image URL; changing it retires pending preparation.
 * @param name - suggested original filename, without a directory.
 * @param failureText - localized failure message, including a retry action.
 * @param original - already loaded original file; omitted sources are read from their image URL.
 * @returns drag handlers; cancellation never starts a late drag.
 */
export function useImageDrag(src: string, name: string, failureText: string, original?: File): ImageDragHandlers {
  const state = useRef<{
    source: string
    prepared?: PreparedImage | undefined
    pending?: Promise<void> | undefined
    abort: AbortController
  }>()
  const dragged = useRef(false)
  const transfer = useImageDragTransfer()
  const reportFailure = transfer.report
  const desktop = transfer.desktop
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
      if (desktop === undefined) {
        current.prepared = { file }
        return
      }
      const handle = await desktop.prepare(new Uint8Array(await file.arrayBuffer()), file.name, file.type)
      if (state.current !== current) {
        desktop.release(handle)
        return
      }
      current.prepared = { file, handle, release: () => { desktop.release(handle) } }
    })().catch((_error: unknown) => {
      // Preparation is speculative; a failed user gesture reports through the owning image.
    }).finally(() => { current.pending = undefined })
  }, [src, name, original, desktop])
  useEffect(() => {
    const current: NonNullable<typeof state.current> = { source: src, abort: new AbortController() }
    state.current = current
    return () => {
      current.abort.abort()
      current.prepared?.release?.()
      state.current = undefined
    }
  }, [src, name, original, desktop, prepare])
  const onDragStart = useCallback((event: DragEvent<HTMLImageElement>): void => {
    if (event.defaultPrevented || src === '') return
    dragged.current = true
    const prepared = state.current?.source === src ? state.current.prepared : undefined
    if (prepared === undefined) {
      const url = new URL(src, location.href)
      if (original === undefined && (url.protocol === 'https:' || url.protocol === 'http:') && url.origin !== location.origin) return
      event.preventDefault()
      prepare()
      reportFailure(failureText)
      return
    }
    event.dataTransfer.items.clear()
    event.dataTransfer.effectAllowed = 'copy'
    if (desktop !== undefined && prepared.handle !== undefined) {
      event.preventDefault()
      const failed = (): void => {
        if (state.current?.prepared === prepared) state.current.prepared = undefined
        reportFailure(failureText)
      }
      void desktop.start(prepared.handle).then((started) => { if (!started) failed() }, failed)
      return
    }
    event.dataTransfer.setData(IMAGE_DRAG_TOKEN_TYPE, transfer.begin(prepared.file))
    event.dataTransfer.setData('DownloadURL', `${prepared.file.type}:${prepared.file.name}:${src}`)
  }, [src, desktop, prepare, reportFailure, failureText, transfer])
  const onPointerDown = useCallback((event: PointerEvent<HTMLImageElement>): void => {
    dragged.current = false
    if (event.button === 0) prepare()
  }, [prepare])
  const onClickCapture = useCallback((event: MouseEvent): void => {
    if (event.detail === 0) { dragged.current = false; return }
    if (!dragged.current) return
    event.preventDefault()
    event.stopPropagation()
    dragged.current = false
  }, [])
  return { onPointerEnter: prepare, onPointerDown, onDragStart, onDragEnd: transfer.end, onClickCapture }
}

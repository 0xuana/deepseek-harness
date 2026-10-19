// @vitest-environment jsdom
import { useEffect } from 'react'
import { File as NodeFile } from 'node:buffer'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IMAGE_DRAG_TOKEN_TYPE, type ImageDragActions } from '../src/image-drag-actions.ts'
import { DraggableImage } from '../src/DraggableImage.tsx'
import { useImageDrag, type DesktopImageDrag } from '../src/image-drag.ts'

let imageDrag: ImageDragActions
beforeEach(() => { imageDrag = { desktop: undefined, begin: vi.fn(() => 'token'), end: vi.fn(), report: vi.fn() } })

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function Image({ src, file, onOpen }: { src: string; file?: File; onOpen?: () => void }) {
  return <button onClick={onOpen}><DraggableImage imageDrag={imageDrag} alt="original" src={src} name="original.png" failureText="Image drag failed. Try again." original={file} /></button>
}
function transfer() {
  const add = vi.fn()
  const values = new Map<string, string>()
  return { items: { add, clear: vi.fn() }, getData: (type: string) => values.get(type) ?? '',
    setData: vi.fn((type: string, value: string) => { values.set(type, value) }), effectAllowed: 'none' }
}
function native() {
  const bridge: DesktopImageDrag = { prepare: vi.fn(async () => 'handle'), start: vi.fn(async () => true), release: vi.fn() }
  imageDrag = { ...imageDrag, desktop: bridge }
  return bridge
}
function original() {
  return new NodeFile([new Uint8Array([137, 80, 78, 71])], 'original.png', { type: 'image/png' }) as File
}

it('hands original bytes to the browser without alt text or an internal URI payload', async () => {
  const file = original()
  const open = vi.fn()
  render(<><Image src="blob:original" file={file} onOpen={open} /></>)
  const dataTransfer = transfer()
  await act(async () => { fireEvent.pointerEnter(screen.getByRole('img')) })
  await act(async () => { fireEvent.dragStart(screen.getByRole('img'), { dataTransfer }) })
  expect(dataTransfer.items.add).not.toHaveBeenCalled()
  expect(dataTransfer.items.clear).toHaveBeenCalledOnce()
  expect(dataTransfer.setData).toHaveBeenCalledWith(IMAGE_DRAG_TOKEN_TYPE, expect.any(String))
  expect(dataTransfer.effectAllowed).toBe('copy')
  expect(dataTransfer.setData).toHaveBeenCalledWith('DownloadURL', 'image/png:original.png:blob:original')
  fireEvent.click(screen.getByRole('img'), { detail: 1 })
  expect(open).not.toHaveBeenCalled()
  fireEvent.pointerDown(screen.getByRole('img'), { button: 0 })
  fireEvent.click(screen.getByRole('img'), { detail: 1 })
  expect(open).toHaveBeenCalledOnce()
})

it('prepares before the gesture, starts native file dragging and releases its handle on unmount', async () => {
  const bridge = native()
  const file = original()
  const view = render(<><Image src="blob:original" file={file} /></>)
  await act(async () => { fireEvent.pointerEnter(screen.getByRole('img')) })
  expect(bridge.prepare).toHaveBeenCalledExactlyOnceWith(new Uint8Array([137, 80, 78, 71]), 'original.png', 'image/png')
  const dataTransfer = transfer()
  await act(async () => { expect(fireEvent.dragStart(screen.getByRole('img'), { dataTransfer })).toBe(false) })
  expect(bridge.start).toHaveBeenCalledExactlyOnceWith('handle')
  expect(dataTransfer.items.add).not.toHaveBeenCalled()
  view.unmount()
  expect(bridge.release).toHaveBeenCalledExactlyOnceWith('handle')
})

it('cancels an unready gesture and releases late preparation without starting a delayed drag', async () => {
  const bridge = native()
  const pending = Promise.withResolvers<string>()
  vi.mocked(bridge.prepare).mockReturnValue(pending.promise)
  const view = render(<><Image src="blob:first" file={original()} /></>)
  await act(async () => { fireEvent.pointerEnter(screen.getByRole('img')) })
  fireEvent.dragStart(screen.getByRole('img'), { dataTransfer: transfer() })
  expect(imageDrag.report).toHaveBeenCalledWith('Image drag failed. Try again.')
  view.rerender(<><span>Image closed</span></>)
  expect(imageDrag.report).toHaveBeenCalledWith('Image drag failed. Try again.')
  await act(async () => { pending.resolve('late'); await pending.promise })
  expect(bridge.release).toHaveBeenCalledExactlyOnceWith('late')
  expect(bridge.start).not.toHaveBeenCalled()
})

it('reports native failure even after its source image closes', async () => {
  const bridge = native()
  const pending = Promise.withResolvers<boolean>()
  vi.mocked(bridge.start).mockReturnValue(pending.promise)
  const view = render(<><Image src="blob:original" file={original()} /></>)
  await act(async () => { fireEvent.pointerEnter(screen.getByRole('img')) })
  fireEvent.dragStart(screen.getByRole('img'), { dataTransfer: transfer() })
  view.rerender(<><span>Image closed</span></>)
  await act(async () => { pending.resolve(false); await pending.promise })
  expect(imageDrag.report).toHaveBeenCalledWith('Image drag failed. Try again.')
})

it('never exports a failed read or starts a native drag after fetch cancellation', async () => {
  const bridge = native()
  const pending = Promise.withResolvers<Response>()
  const fetchImage = vi.fn<typeof fetch>().mockReturnValue(pending.promise)
  vi.stubGlobal('fetch', fetchImage)
  const view = render(<><Image src="https://example.test/image.png" /></>)
  fireEvent.pointerEnter(screen.getByRole('img'))
  const request = fetchImage.mock.calls[0]?.[1]
  view.rerender(<><span>Closed</span></>)
  expect(request?.signal?.aborted).toBe(true)
  await act(async () => { pending.resolve(new Response('unavailable', { status: 404 })); await pending.promise })
  expect(bridge.prepare).not.toHaveBeenCalled()
  expect(bridge.start).not.toHaveBeenCalled()
})

it('does not prepare on mount, ignores secondary buttons, and keeps keyboard activation after dragging', async () => {
  const bridge = native()
  const open = vi.fn()
  render(<><Image src="blob:original" file={original()} onOpen={open} /></>)
  expect(bridge.prepare).not.toHaveBeenCalled()
  fireEvent.pointerDown(screen.getByRole('img'), { button: 2 })
  expect(bridge.prepare).not.toHaveBeenCalled()
  await act(async () => { fireEvent.pointerEnter(screen.getByRole('img')) })
  fireEvent.dragStart(screen.getByRole('img'), { dataTransfer: transfer() })
  fireEvent.dragEnd(screen.getByRole('img'), { dataTransfer: transfer() })
  fireEvent.click(screen.getByRole('button'), { detail: 0 })
  expect(open).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('img'), { detail: 0 })
  expect(open).toHaveBeenCalledTimes(2)
})

it('reports rejected native starts and accepts later preparation attempts', async () => {
  const bridge = native()
  vi.mocked(bridge.prepare).mockRejectedValueOnce(new Error('read failed'))
  vi.mocked(bridge.start).mockRejectedValueOnce(new Error('drag failed'))
  render(<><Image src="blob:original" file={original()} /></>)
  await act(async () => { fireEvent.pointerEnter(screen.getByRole('img')) })
  await act(async () => { fireEvent.pointerEnter(screen.getByRole('img')) })
  await act(async () => { fireEvent.dragStart(screen.getByRole('img'), { dataTransfer: transfer() }) })
  expect(imageDrag.report).toHaveBeenCalledWith('Image drag failed. Try again.')
})

it.each(['image/png', 'text/plain'])('cancels late fetched %s responses after unmount', async (type) => {
  const bridge = native()
  const pending = Promise.withResolvers<Response>()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockReturnValue(pending.promise))
  const view = render(<><Image src="https://example.test/image.png" /></>)
  fireEvent.pointerEnter(screen.getByRole('img'))
  view.unmount()
  await act(async () => { pending.resolve(new Response('bytes', { headers: { 'Content-Type': type } })); await pending.promise })
  expect(bridge.prepare).not.toHaveBeenCalled()
})

it('fetches a readable source once and retains the original file for its owner', async () => {
  const fetchImage = vi.fn<typeof fetch>().mockResolvedValue(new Response('bytes', { headers: { 'Content-Type': 'image/png' } }))
  vi.stubGlobal('fetch', fetchImage)
  render(<><Image src="/image.png" /></>)
  await act(async () => { fireEvent.pointerEnter(screen.getByRole('img')); fireEvent.pointerEnter(screen.getByRole('img')) })
  fireEvent.pointerEnter(screen.getByRole('img'))
  expect(fetchImage).toHaveBeenCalledOnce()
  const dataTransfer = transfer()
  fireEvent.dragStart(screen.getByRole('img'), { dataTransfer })
  expect(imageDrag.begin).toHaveBeenCalledWith(expect.objectContaining({ name: 'original.png', type: 'image/png' }))
  fireEvent.dragEnd(screen.getByRole('img'))
  expect(imageDrag.end).toHaveBeenCalledOnce()
})

it.each(['https://other.test/image.png', 'http://other.test/image.png'])('leaves unreadable external %s drags native', async (src) => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('CORS')))
  render(<><Image src={src} /></>)
  await act(async () => { fireEvent.pointerEnter(screen.getByRole('img')) })
  const dataTransfer = transfer()
  expect(fireEvent.dragStart(screen.getByRole('img'), { dataTransfer })).toBe(true)
  expect(dataTransfer.items.clear).not.toHaveBeenCalled()
  expect(imageDrag.report).not.toHaveBeenCalled()
})

it('keeps disabled and already-cancelled gestures inert', () => {
  const bridge = native()
  const view = render(<><Image src="" /></>)
  fireEvent.pointerEnter(screen.getByRole('img'))
  const dataTransfer = transfer()
  expect(fireEvent.dragStart(screen.getByRole('img'), { dataTransfer })).toBe(true)
  view.rerender(<><div onDragStartCapture={(event) => { event.preventDefault() }}><Image src="blob:original" file={original()} /></div></>)
  expect(fireEvent.dragStart(screen.getByRole('img'), { dataTransfer })).toBe(false)
  expect(bridge.prepare).not.toHaveBeenCalled()
  expect(bridge.start).not.toHaveBeenCalled()
})

it('reports an unready same-origin HTTP image instead of exporting its URL', async () => {
  const pending = Promise.withResolvers<Response>()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockReturnValue(pending.promise))
  render(<><Image src="/image.png" /></>)
  expect(fireEvent.dragStart(screen.getByRole('img'), { dataTransfer: transfer() })).toBe(false)
  expect(imageDrag.report).toHaveBeenCalled()
  await act(async () => { pending.resolve(new Response('failure', { status: 404 })); await pending.promise })
})


it('cancels a handler retained after its image unmounts', () => {
  let handlers!: ReturnType<typeof useImageDrag>
  function Source() {
    const drag = useImageDrag(imageDrag, 'blob:original', 'original.png', 'Image drag failed')
    useEffect(() => { handlers = drag }, [drag])
    return null
  }
  const view = render(<><Source /></>)
  view.rerender(<><span>Closed</span></>)
  const event = { defaultPrevented: false, preventDefault: vi.fn(), dataTransfer: transfer() }
  const captured: Parameters<typeof handlers.onDragStart>[0] = Object.assign({} as Parameters<typeof handlers.onDragStart>[0], event)
  act(() => { handlers.onDragStart(captured) })
  expect(event.preventDefault).toHaveBeenCalledOnce()
})

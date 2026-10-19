// @vitest-environment jsdom
import { File as NodeFile } from 'node:buffer'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { IMAGE_DRAG_TYPE, ImageDragProvider, useImageDrop } from '../src/ImageDragProvider.tsx'
import { useImageDrag, type DesktopImageDrag } from '../src/image-drag.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function Image({ src, file, onOpen }: { src: string; file?: File; onOpen?: () => void }) {
  const drag = useImageDrag(src, 'original.png', 'Image drag failed. Try again.', file)
  return <button onClickCapture={drag.onClickCapture} onClick={onOpen}><img alt="original" src={src} draggable {...drag} /></button>
}
function transfer() {
  const add = vi.fn()
  const values = new Map<string, string>()
  return { items: { add, clear: vi.fn() }, getData: (type: string) => values.get(type) ?? '',
    setData: vi.fn((type: string, value: string) => { values.set(type, value) }), effectAllowed: 'none' }
}
function native() {
  const bridge: DesktopImageDrag = { prepare: vi.fn(async () => 'handle'), start: vi.fn(async () => true), release: vi.fn() }
  vi.stubGlobal('dshDesktop', { imageDrag: bridge })
  return bridge
}
function original() {
  return new NodeFile([new Uint8Array([137, 80, 78, 71])], 'original.png', { type: 'image/png' }) as File
}

it('hands original bytes to the browser without alt text or an internal URI payload', async () => {
  const file = original()
  const open = vi.fn()
  render(<ImageDragProvider><Image src="blob:original" file={file} onOpen={open} /></ImageDragProvider>)
  const dataTransfer = transfer()
  await act(async () => { fireEvent.dragStart(screen.getByRole('img'), { dataTransfer }) })
  expect(dataTransfer.items.add).not.toHaveBeenCalled()
  expect(dataTransfer.items.clear).toHaveBeenCalledOnce()
  expect(dataTransfer.setData).toHaveBeenCalledWith(IMAGE_DRAG_TYPE, expect.any(String))
  expect(dataTransfer.effectAllowed).toBe('copy')
  expect(dataTransfer.setData).toHaveBeenCalledWith('DownloadURL', 'image/png:original.png:blob:original')
  fireEvent.click(screen.getByRole('button'))
  expect(open).not.toHaveBeenCalled()
  fireEvent.pointerDown(screen.getByRole('img'), { button: 0 })
  fireEvent.click(screen.getByRole('button'))
  expect(open).toHaveBeenCalledOnce()
})

it('prepares before the gesture, starts native file dragging and releases its handle on unmount', async () => {
  const bridge = native()
  const file = original()
  const view = render(<ImageDragProvider><Image src="blob:original" file={file} /></ImageDragProvider>)
  await act(async () => { await Promise.resolve() })
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
  const view = render(<ImageDragProvider><Image src="blob:first" file={original()} /></ImageDragProvider>)
  await act(async () => { await Promise.resolve() })
  fireEvent.dragStart(screen.getByRole('img'), { dataTransfer: transfer() })
  expect(screen.getByRole('alert').textContent).toBe('Image drag failed. Try again.')
  view.rerender(<ImageDragProvider><span>Image closed</span></ImageDragProvider>)
  expect(screen.getByRole('alert').textContent).toBe('Image drag failed. Try again.')
  await act(async () => { pending.resolve('late'); await pending.promise })
  expect(bridge.release).toHaveBeenCalledExactlyOnceWith('late')
  expect(bridge.start).not.toHaveBeenCalled()
})

it('reports native failure even after its source image closes', async () => {
  const bridge = native()
  const pending = Promise.withResolvers<boolean>()
  vi.mocked(bridge.start).mockReturnValue(pending.promise)
  const view = render(<ImageDragProvider><Image src="blob:original" file={original()} /></ImageDragProvider>)
  await act(async () => { await Promise.resolve() })
  fireEvent.dragStart(screen.getByRole('img'), { dataTransfer: transfer() })
  view.rerender(<ImageDragProvider><span>Image closed</span></ImageDragProvider>)
  await act(async () => { pending.resolve(false); await pending.promise })
  expect(screen.getByRole('alert').textContent).toBe('Image drag failed. Try again.')
})

it('never exports a failed read or starts a native drag after fetch cancellation', async () => {
  const bridge = native()
  const pending = Promise.withResolvers<Response>()
  const fetchImage = vi.fn<typeof fetch>().mockReturnValue(pending.promise)
  vi.stubGlobal('fetch', fetchImage)
  const view = render(<ImageDragProvider><Image src="https://example.test/image.png" /></ImageDragProvider>)
  fireEvent.pointerEnter(screen.getByRole('img'))
  const request = fetchImage.mock.calls[0]?.[1]
  view.rerender(<ImageDragProvider><span>Closed</span></ImageDragProvider>)
  expect(request?.signal?.aborted).toBe(true)
  await act(async () => { pending.resolve(new Response('unavailable', { status: 404 })); await pending.promise })
  expect(bridge.prepare).not.toHaveBeenCalled()
  expect(bridge.start).not.toHaveBeenCalled()
})

function DropTarget({ receive }: { receive: (file: File | undefined) => void }) {
  const read = useImageDrop()
  return <div data-testid="drop" onDrop={(event) => { event.preventDefault(); receive(read(event.dataTransfer)) }} />
}

it('resolves only the active application drag token and clears it after dragging ends', () => {
  const file = original()
  const receive = vi.fn()
  render(<ImageDragProvider><Image src="blob:original" file={file} /><DropTarget receive={receive} /></ImageDragProvider>)
  const dataTransfer = transfer()
  fireEvent.dragStart(screen.getByRole('img'), { dataTransfer })
  fireEvent.drop(screen.getByTestId('drop'), { dataTransfer })
  expect(receive).toHaveBeenLastCalledWith(file)
  fireEvent.dragEnd(screen.getByRole('img'), { dataTransfer })
  fireEvent.drop(screen.getByTestId('drop'), { dataTransfer })
  expect(receive).toHaveBeenLastCalledWith(undefined)
})

// @vitest-environment jsdom
/** Plugin-owned transfers and feedback across independent render roots. */
import { File as NodeFile } from 'node:buffer'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { DraggableImage, IMAGE_DRAG_TOKEN_TYPE, type DesktopImageDrag } from '@deepseek-ai/dsh-client-ui-primitives'
import * as plugin from '../src/client/index.ts'
import { apply as applyHost } from '../src/index.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

function transfer(token = '') {
  const data = new Map([[IMAGE_DRAG_TOKEN_TYPE, token]])
  return {
    items: { clear: vi.fn() }, effectAllowed: 'none',
    getData: (type: string) => data.get(type) ?? '',
    setData: (type: string, value: string) => { data.set(type, value) },
  }
}

async function bench() {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const owner = await runtime.mount(plugin)
  await runtime.root.declare({ 'shell.overlay': { kind: 'list', scope: 'root' } },
    ({ renderSlot }) => renderSlot('shell.overlay', {}))
  const view = runtime.renderRoot()
  return { runtime, owner, view, service: runtime.ctx.imageDrag }
}

it('keeps the Host entry empty', () => { applyHost() })

it('shares original bytes across roots, rejects foreign tokens, and clears bytes when the drag ends', async () => {
  const { service, owner, runtime } = await bench()
  const file = new NodeFile([Uint8Array.of(137, 80, 78, 71)], 'original.png', { type: 'image/png' }) as File
  const source = render(<DraggableImage imageDrag={service.actions} src="blob:original" name={file.name}
    original={file} failureText="拖放失败，请重试" alt="original" />)
  const receive = vi.fn()
  const target = render(<div data-testid="target" onDrop={(event) => { receive(service.read(event.dataTransfer)) }} />)
  const data = transfer()
  fireEvent.drop(target.getByTestId('target'), { dataTransfer: data })
  expect(receive).toHaveBeenLastCalledWith(undefined)
  await act(async () => { fireEvent.pointerEnter(source.getByRole('img')) })
  fireEvent.dragStart(source.getByRole('img'), { dataTransfer: data })
  source.unmount()
  fireEvent.drop(target.getByTestId('target'), { dataTransfer: data })
  expect(receive).toHaveBeenLastCalledWith(file)
  data.setData(IMAGE_DRAG_TOKEN_TYPE, 'foreign')
  fireEvent.drop(target.getByTestId('target'), { dataTransfer: data })
  expect(receive).toHaveBeenLastCalledWith(undefined)
  const token = service.actions.begin(file)
  data.setData(IMAGE_DRAG_TOKEN_TYPE, token)
  fireEvent.dragEnd(window)
  fireEvent.drop(target.getByTestId('target'), { dataTransfer: data })
  expect(receive).toHaveBeenLastCalledWith(undefined)
  data.setData(IMAGE_DRAG_TOKEN_TYPE, service.actions.begin(file))
  await owner.dispose()
  expect(runtime.ctx.get('imageDrag')).toBeUndefined()
  expect(runtime.slots.entries('shell.overlay')).toHaveLength(0)
  fireEvent.drop(target.getByTestId('target'), { dataTransfer: data })
  expect(receive).toHaveBeenLastCalledWith(undefined)
})

it('reports late native failure after source unmount, then dismisses its overlay toast', async () => {
  const pending = Promise.withResolvers<boolean>()
  const desktop: DesktopImageDrag = { prepare: vi.fn(async () => 'handle'), start: vi.fn(() => pending.promise), release: vi.fn() }
  vi.stubGlobal('dshDesktop', { protocolVersion: 1, imageDrag: desktop })
  const { service } = await bench()
  expect(service.actions.desktop).toBe(desktop)
  vi.stubGlobal('dshDesktop', { protocolVersion: 2 })
  expect(service.actions.desktop).toBe(desktop)
  const file = new NodeFile(['image'], 'image.png', { type: 'image/png' }) as File
  const source = render(<DraggableImage imageDrag={service.actions} src="blob:original" name={file.name}
    original={file} failureText="拖放失败，请重试" alt="original" />)
  await act(async () => { fireEvent.pointerEnter(source.getByRole('img')) })
  fireEvent.dragStart(source.getByRole('img'), { dataTransfer: transfer() })
  source.unmount()
  expect(desktop.release).toHaveBeenCalledWith('handle')
  vi.useFakeTimers()
  await act(async () => { pending.resolve(false); await pending.promise })
  expect(screen.getByRole('alert').textContent).toBe('拖放失败，请重试')
  await act(async () => { await vi.runAllTimersAsync() })
  expect(screen.queryByRole('alert')).toBeNull()
})

it('ignores an unsupported desktop protocol and removes feedback when the plugin leaves', async () => {
  vi.stubGlobal('dshDesktop', { protocolVersion: 2, imageDrag: {} })
  const { service, owner } = await bench()
  expect(service.actions.desktop).toBeUndefined()
  act(() => { service.actions.report('拖放失败，请重试') })
  expect(screen.getByRole('alert')).toBeTruthy()
  await owner.dispose()
  expect(screen.queryByRole('alert')).toBeNull()
})

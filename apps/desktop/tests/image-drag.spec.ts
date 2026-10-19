import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import type { BrowserWindow, IpcMainInvokeEvent, NativeImage, WebContents, WebFrameMain } from 'electron'
import { DESKTOP_IPC } from '../src/ipc.ts'

const electron = vi.hoisted(() => ({
  handle: vi.fn(), removeHandler: vi.fn(), getPath: vi.fn(), getFileIcon: vi.fn(), createFromPath: vi.fn(),
}))
vi.mock('electron', () => ({
  app: electron,
  ipcMain: electron,
  nativeImage: { createFromPath: electron.createFromPath },
}))
const { installDesktopImageDrag } = await import('../src/image-drag.ts')
afterEach(() => { vi.resetAllMocks() })

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-image-drag-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  electron.getPath.mockReturnValue(root)
  const icon: NativeImage = Object.assign({} as NativeImage, { isEmpty: () => false, resize: () => icon })
  electron.createFromPath.mockReturnValue(icon)
  const frame = Object.assign({} as WebFrameMain, { url: 'dsh-app://app/' })
  const window = Object.assign({} as BrowserWindow, { isDestroyed: () => false,
    webContents: Object.assign({} as WebContents, { mainFrame: frame, startDrag: vi.fn() }) })
  let current: BrowserWindow | undefined = window
  const dispose = installDesktopImageDrag(() => current)
  onTestFinished(dispose)
  const handlers = new Map<string, Handler>(electron.handle.mock.calls.map(([channel, handler]) => [channel, handler]))
  const event = Object.assign({} as IpcMainInvokeEvent, { sender: window.webContents, senderFrame: frame })
  const call = (channel: string, ...args: unknown[]) => (handlers.get(channel) as Handler)(event, ...args)
  return { root, window, frame, event, icon, call, dispose, detach: () => { current = undefined } }
}

it('stages original bytes before the gesture and synchronously starts an OS copy drag', async () => {
  const f = await fixture()
  const bytes = new Uint8Array([137, 80, 78, 71])
  const handle = await f.call(DESKTOP_IPC.imageDragPrepare, bytes, 'original.png', 'image/png')
  expect(f.window.webContents.startDrag).not.toHaveBeenCalled()
  expect(f.call(DESKTOP_IPC.imageDragStart, handle)).toBe(true)
  const [request] = f.window.webContents.startDrag.mock.calls[0] as [{ file: string; icon: NativeImage }]
  expect(request.icon).toBe(f.icon)
  expect(new Uint8Array(await readFile(request.file))).toEqual(bytes)
  await f.call(DESKTOP_IPC.imageDragRelease, handle)
  expect(new Uint8Array(await readFile(request.file))).toEqual(bytes)
  expect(f.call(DESKTOP_IPC.imageDragStart, handle)).toBe(false)
  await f.dispose()
  expect(await readdir(f.root)).toEqual([])
})

it('rejects foreign senders, subframes, revoked handles and native failures', async () => {
  const f = await fixture()
  expect(f.call(DESKTOP_IPC.imageDragStart, 'foreign')).toBe(false)
  const handle = await f.call(DESKTOP_IPC.imageDragPrepare, new Uint8Array([1]), 'x.png', 'image/png')
  f.window.webContents.startDrag.mockImplementationOnce(() => { throw new Error('OS rejected drag') })
  expect(f.call(DESKTOP_IPC.imageDragStart, handle)).toBe(false)
  f.frame.url = 'https://other.test/'
  expect(() => f.call(DESKTOP_IPC.imageDragStart, handle)).toThrow('unowned renderer')
  f.frame.url = 'dsh-app://app/'
  Object.assign(f.event, { senderFrame: { url: 'dsh-app://app/' } })
  expect(() => f.call(DESKTOP_IPC.imageDragStart, handle)).toThrow('Unowned image drag request')
  Object.assign(f.event, { senderFrame: f.frame, sender: {} })
  expect(() => f.call(DESKTOP_IPC.imageDragStart, handle)).toThrow('Unowned image drag request')
  f.detach()
  expect(() => f.call(DESKTOP_IPC.imageDragStart, handle)).toThrow('Unowned image drag request')
})

it('prepares the fallback icon before accepting a gesture and cancels late work on shutdown', async () => {
  const f = await fixture()
  electron.createFromPath.mockReturnValue({ isEmpty: () => true })
  const pending = Promise.withResolvers<NativeImage>()
  electron.getFileIcon.mockReturnValue(pending.promise)
  const prepare = f.call(DESKTOP_IPC.imageDragPrepare, new Uint8Array([1]), 'x.svg', 'image/svg+xml')
  const rejected = expect(prepare).rejects.toThrow('Unowned image drag request')
  await vi.waitFor(() => { expect(electron.getFileIcon).toHaveBeenCalledOnce() })
  let stopped = false
  const stopping = f.dispose().then(() => { stopped = true })
  await Promise.resolve()
  expect(stopped).toBe(false)
  pending.resolve(f.icon)
  await rejected
  await stopping
  expect(f.window.webContents.startDrag).not.toHaveBeenCalled()
  expect(await readdir(f.root)).toEqual([])
})

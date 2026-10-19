/** Native copy drags authorized only for the owning application window. */
import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type NativeImage } from 'electron'
import { DESKTOP_IPC, assertDesktopSender } from './ipc.ts'
import { ImageDragFiles } from './image-drag-files.ts'

/**
 * Register native image preparation and drag operations for the application window.
 * @param getWindow - current application window; subframes and other windows are rejected.
 * @returns cleanup that waits for preparation and removes all exported temporary files.
 */
export function installDesktopImageDrag(getWindow: () => BrowserWindow | undefined): () => Promise<void> {
  let disposed = false
  const closed = Promise.withResolvers<void>()
  const files = new ImageDragFiles(app.getPath('temp'))
  const pending = new Set<Promise<string>>()
  const icons = new Map<string, NativeImage>()
  const owner = (event: IpcMainInvokeEvent): BrowserWindow => {
    const window = getWindow()
    if (disposed || window === undefined || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unowned image drag request')
    assertDesktopSender(event, ['app'])
    return window
  }
  const prepare = async (event: IpcMainInvokeEvent, bytes: unknown, name: unknown, mediaType: unknown): Promise<string> => {
    owner(event)
    const handle = await files.prepare(bytes, name, mediaType)
    try {
      const file = files.take(handle, false)
      if (file === undefined) throw new Error('Image transfer closed')
      const icon = await Promise.race([app.getFileIcon(file, { size: 'normal' }), closed.promise])
      owner(event)
      if (icon === undefined) throw new Error('Image transfer closed')
      icons.set(handle, icon)
      return handle
    } catch (error) {
      await files.release(handle)
      throw error
    }
  }
  ipcMain.handle(DESKTOP_IPC.imageDragPrepare, (event, bytes: unknown, name: unknown, mediaType: unknown) => {
    const operation = prepare(event, bytes, name, mediaType)
    pending.add(operation)
    void operation.then(() => { pending.delete(operation) }, () => { pending.delete(operation) })
    return operation
  })
  ipcMain.handle(DESKTOP_IPC.imageDragStart, (event, handle: unknown) => {
    const window = owner(event)
    const icon = typeof handle === 'string' ? icons.get(handle) : undefined
    if (icon === undefined) return false
    const file = files.take(handle, false)
    if (file === undefined) return false
    try {
      window.webContents.startDrag({ file, icon })
      files.take(handle)
      return true
    } catch (_error) {
      if (typeof handle === 'string') icons.delete(handle)
      void files.release(handle).catch((error: unknown) => { console.error(error) })
      // The renderer reports one localized failure; no filesystem paths cross IPC.
      return false
    }
  })
  ipcMain.handle(DESKTOP_IPC.imageDragRelease, async (event, handle: unknown) => {
    owner(event)
    if (typeof handle === 'string') icons.delete(handle)
    await files.release(handle)
  })
  return async () => {
    if (!disposed) {
      disposed = true
      closed.resolve()
      ipcMain.removeHandler(DESKTOP_IPC.imageDragPrepare)
      ipcMain.removeHandler(DESKTOP_IPC.imageDragStart)
      ipcMain.removeHandler(DESKTOP_IPC.imageDragRelease)
    }
    await Promise.allSettled(pending)
    icons.clear()
    await files.dispose()
  }
}

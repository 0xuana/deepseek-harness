/** Native window preparation before an update confirmation can stop the Host. */
import type { BrowserWindow } from 'electron'

/**
 * Leave macOS fullscreen before creating or dismissing an installation overlay.
 * @param window - Product window that owns the update confirmation.
 * @returns Whether the window survived the native transition; destruction cancels installation.
 */
export async function prepareDesktopUpdateWindow(window: BrowserWindow): Promise<boolean> {
  if (window.isDestroyed()) return false
  if (process.platform !== 'darwin' || !window.isFullScreen()) return true
  return new Promise<boolean>((resolve) => {
    const finish = (available: boolean): void => {
      window.off('leave-full-screen', left)
      window.off('closed', closed)
      resolve(available)
    }
    const left = (): void => { finish(!window.isDestroyed()) }
    const closed = (): void => { finish(false) }
    window.once('leave-full-screen', left)
    window.once('closed', closed)
    window.setFullScreen(false)
  })
}

/** Process-owned original image files staged for native copy drags. */
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/bmp': 'bmp', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/svg+xml': 'svg',
}
// Limits the memory and temporary storage accepted from one renderer IPC request.
const MAX_IMAGE_BYTES = 64 * 1024 * 1024

interface ImageDragFile {
  readonly directory: string
  readonly path: string
  used: boolean
}

/** Original files belong to the application; handed-off files remain readable until app shutdown. */
export class ImageDragFiles {
  private readonly files = new Map<string, ImageDragFile>()
  private readonly pending = new Set<Promise<string>>()
  private disposed = false

  /** @param temporaryDirectory - OS temporary directory in which private export directories are allocated. */
  constructor(private readonly temporaryDirectory: string) {}

  /**
   * Validate renderer bytes and stage one original file without accepting renderer filesystem paths.
   * @param bytes - complete image bytes.
   * @param name - suggested filename; directory characters and platform-reserved characters are removed.
   * @param mediaType - supported image MIME type, which owns the output suffix.
   * @returns application-local opaque handle; failures retain no usable handle or partial file.
   */
  prepare(bytes: unknown, name: unknown, mediaType: unknown): Promise<string> {
    const extension = typeof mediaType === 'string' && Object.hasOwn(IMAGE_EXTENSIONS, mediaType)
      ? IMAGE_EXTENSIONS[mediaType] : undefined
    if (this.disposed || !(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES
      || typeof name !== 'string' || typeof mediaType !== 'string' || extension === undefined) {
      return Promise.reject(new Error('Invalid image transfer'))
    }
    const stem = name.replace(/\.[^.]*$/u, '').replace(/[<>:"/\\|?*\x00-\x1f]/gu, '_').replace(/^[. ]+|[. ]+$/gu, '').slice(0, 120) || 'image'
    const operation = this.write(bytes, `${stem}.${extension}`)
    this.pending.add(operation)
    void operation.then(() => { this.pending.delete(operation) }, () => { this.pending.delete(operation) })
    return operation
  }

  private async write(bytes: Uint8Array, name: string): Promise<string> {
    const directory = await mkdtemp(join(this.temporaryDirectory, 'dsh-image-drag-'))
    try {
      const path = join(directory, name)
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
      if (this.disposed) throw new Error('Image transfer closed')
      const handle = randomUUID()
      this.files.set(handle, { directory, path, used: false })
      return handle
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  /**
   * Resolve and retain a prepared file for an OS-owned drag.
   * @param handle - handle created by this application's preparation operation.
   * @param retain - whether the OS is taking ownership; false only during preparation.
   * @returns original file path, or undefined after release/disposal or for a foreign handle.
   */
  take(handle: unknown, retain = true): string | undefined {
    const file = typeof handle === 'string' ? this.files.get(handle) : undefined
    if (file === undefined || this.disposed) return undefined
    if (retain) file.used = true
    return file.path
  }

  /**
   * Release a preparation that no longer has a mounted image consumer.
   * @param handle - application-local handle; OS-used files stay until disposal.
   */
  async release(handle: unknown): Promise<void> {
    const file = typeof handle === 'string' ? this.files.get(handle) : undefined
    if (file === undefined || file.used) return
    this.files.delete(handle as string)
    await rm(file.directory, { recursive: true, force: true })
  }

  /** Stop preparation, await pending writes, and remove all owned files after native drags finish. */
  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.allSettled(this.pending)
    const files = [...this.files.values()]
    this.files.clear()
    await Promise.all(files.map(file => rm(file.directory, { recursive: true, force: true })))
  }
}

/** Process-owned original image files staged for native copy drags. */
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/bmp': 'bmp', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/svg+xml': 'svg',
}
// Bounds aggregate original bytes in preparation and retained temporary files.
const MAX_IMAGE_BYTES = 64 * 1024 * 1024

interface ImageDragFile {
  readonly directory: string
  readonly path: string
  readonly bytes: number
  used: boolean
}

/** Original files belong to the application; handed-off files remain readable until app shutdown. */
export class ImageDragFiles {
  private readonly files = new Map<string, ImageDragFile>()
  private readonly pending = new Set<Promise<string>>()
  private readonly releasing = new Map<string, Promise<void>>()
  private stagedBytes = 0
  private disposed = false

  /** @param temporaryDirectory - OS temporary directory in which private export directories are allocated. */
  constructor(private readonly temporaryDirectory: string) {}

  /**
   * Validate renderer bytes and stage one original file without accepting renderer filesystem paths.
   * @param bytes - complete image bytes; all pending and retained files share a 64 MiB budget.
   * @param name - suggested filename; directory characters and platform-reserved characters are removed.
   * @param mediaType - supported image MIME type, which owns the output suffix.
   * @returns application-local opaque handle; failures retain no usable handle or partial file.
   */
  prepare(bytes: unknown, name: unknown, mediaType: unknown): Promise<string> {
    const extension = typeof mediaType === 'string' && Object.hasOwn(IMAGE_EXTENSIONS, mediaType)
      ? IMAGE_EXTENSIONS[mediaType] : undefined
    if (this.disposed || !(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES - this.stagedBytes
      || typeof name !== 'string' || typeof mediaType !== 'string' || extension === undefined) {
      return Promise.reject(new Error('Invalid image transfer'))
    }
    let stem = name.replace(/\.[^.]*$/u, '').replace(/[<>:"/\\|?*\x00-\x1f]/gu, '_').replace(/^[. ]+|[. ]+$/gu, '').slice(0, 120) || 'image'
    if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(stem)) stem = `_${stem}`
    this.stagedBytes += bytes.byteLength
    const operation = this.write(bytes, `${stem}.${extension}`).catch((error: unknown) => {
      this.stagedBytes -= bytes.byteLength
      throw error
    })
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
      this.files.set(handle, { directory, path, bytes: bytes.byteLength, used: false })
      return handle
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  /**
   * Resolve and retain a prepared file for an OS-owned drag.
   * @param handle - handle created by this application's preparation operation.
   * @param retain - whether the OS accepted the file; false while preparing or attempting a drag.
   * @returns original file path, or undefined after release/disposal or for a foreign handle.
   */
  take(handle: unknown, retain = true): string | undefined {
    if (typeof handle !== 'string') return undefined
    const file = this.files.get(handle)
    if (file === undefined || this.disposed || this.releasing.has(handle)) return undefined
    if (retain) file.used = true
    return file.path
  }

  /**
   * Release a preparation that no longer has a mounted image consumer.
   * @param handle - application-local handle; OS-used files stay until disposal.
   */
  async release(handle: unknown): Promise<void> {
    if (typeof handle !== 'string') return
    const file = this.files.get(handle)
    if (file === undefined || file.used) return
    await this.remove(handle, file)
  }

  private remove(handle: string, file: ImageDragFile): Promise<void> {
    const existing = this.releasing.get(handle)
    if (existing !== undefined) return existing
    const operation = rm(file.directory, { recursive: true, force: true }).then(() => {
      this.files.delete(handle)
      this.stagedBytes -= file.bytes
    }).finally(() => { this.releasing.delete(handle) })
    this.releasing.set(handle, operation)
    return operation
  }

  /** Stop preparation, await writes and releases, and report removal failure only after all files settle. */
  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.allSettled(this.pending)
    await Promise.allSettled(this.releasing.values())
    const results = await Promise.allSettled([...this.files].map(([handle, file]) => this.remove(handle, file)))
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }
}

/** Bounded, cancellable reads of Desktop-owned plugin operation history. */
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { parsePluginOperationRecord, type PluginOperationRecord } from '@deepseek-ai/dsh-plugin-manager/diagnostic'

/** Resource budgets for auxiliary history collection, independent of basic crash report writing. */
export interface OperationHistoryReadLimits {
  readonly bytes: number
  readonly recordBytes: number
  readonly records: number
}

/** Collection facts; incomplete history must not be interpreted as absence of plugin changes. */
export interface OperationHistoryReadResult {
  readonly records: readonly PluginOperationRecord[]
  readonly bytesRead: number
  /** Distinct files from which at least one byte was read. */
  readonly filesRead: number
  readonly truncated: boolean
  readonly invalidRecords: number
  readonly unavailableFiles: number
  readonly cancelled: boolean
}

/**
 * Read only the bounded tails of the two owned history files, newest segment first.
 * Cancellation stops subsequent I/O and parsing; an already-issued OS read must settle before its handle closes.
 * @param directory - Desktop's operation history directory; unrelated files are never enumerated.
 * @param limits - Positive byte, record-size and record-count budgets.
 * @param signal - Caller-owned collection deadline or shutdown cancellation.
 * @returns Partial records and explicit omissions; filesystem failures never reject the collection.
 */
export async function readOperationHistory(
  directory: string, limits: OperationHistoryReadLimits, signal: AbortSignal,
): Promise<OperationHistoryReadResult> {
  if (![limits.bytes, limits.recordBytes, limits.records].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new RangeError('Operation history budgets must be positive safe integers')
  }
  const cancelled = (): boolean => signal.aborted
  const records: PluginOperationRecord[] = []
  let bytesRead = 0
  const seenFiles = new Set<string>()
  let truncated = false
  let invalidRecords = 0
  let unavailableFiles = 0
  for (const name of ['operations.jsonl', 'operations.previous.jsonl']) {
    if (cancelled()) break
    try {
      await using handle = await open(join(directory, name), 'r')
      if (cancelled()) break
      const stat = await handle.stat()
      if (cancelled()) break
      if (!stat.isFile()) { unavailableFiles++; continue }
      const identity = `${String(stat.dev)}:${String(stat.ino)}`
      if (seenFiles.has(identity)) { truncated = true; continue }
      if (stat.size > 0 && (bytesRead >= limits.bytes || records.length >= limits.records)) { truncated = true; break }
      const length = Math.min(stat.size, limits.bytes - bytesRead)
      const start = stat.size - length
      const buffer = Buffer.alloc(length)
      let offset = 0
      while (offset < length && !cancelled()) {
        const read = await handle.read(buffer, offset, Math.min(16 * 1024, length - offset), start + offset)
        bytesRead += read.bytesRead
        if (read.bytesRead === 0) break
        offset += read.bytesRead
      }
      if (offset > 0) seenFiles.add(identity)
      if (cancelled()) break
      truncated ||= start > 0 || offset < length
      // An unterminated last record can still be in flight; never parse it as a committed record.
      if (offset === 0) continue
      let end = buffer.lastIndexOf(10, offset - 1)
      if (end !== offset - 1) truncated = true
      while (end >= 0 && records.length < limits.records && !cancelled()) {
        const preceding = end === 0 ? -1 : buffer.lastIndexOf(10, end - 1)
        if (preceding < 0 && start > 0) { truncated = true; break }
        const size = end - preceding - 1
        if (size > limits.recordBytes) {
          invalidRecords++
        } else if (size > 0) {
          try {
            const value: unknown = JSON.parse(buffer.subarray(preceding + 1, end).toString('utf8'))
            const record = parsePluginOperationRecord(value)
            if (record === undefined) invalidRecords++
            else records.push(record)
          } catch (_error) {
            // A corrupt record does not invalidate independently delimited older records.
            invalidRecords++
          }
        }
        end = preceding
      }
      if (end >= 0) truncated = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unavailableFiles++
    }
  }
  return { records, bytesRead, filesRead: seenFiles.size, truncated, invalidRecords, unavailableFiles, cancelled: cancelled() }
}

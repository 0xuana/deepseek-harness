/** Worker lifetime for an auxiliary report; completion includes worker exit. */
import { Worker } from 'node:worker_threads'
import type { OperationReportLimits } from './operation-report.ts'
import type { OperationJournalStatus } from './operation-journal.ts'

/** Facts passed to the isolated collector after the basic report is saved. */
export interface OperationReportJobInput {
  readonly reportPath: string
  readonly directory: string
  readonly limits: OperationReportLimits
  readonly journal: OperationJournalStatus | null
}

/** Collection and cooperative shutdown share one total budget. */
export interface OperationReportJobOptions {
  /** Deadline for requesting forced termination, including Worker startup. */
  readonly timeoutMs: number
  /** Reserved part of timeoutMs for cancellation and resource cleanup. */
  readonly cancellationGraceMs: number
}

/** Cancellation can leave a partial append; the independently saved basic report remains valid. */
export interface OperationReportJobResult {
  readonly appended: boolean
  readonly timedOut: boolean
  readonly cancelled: boolean
}

/**
 * Collect history, request cooperative cancellation, then force termination if cleanup exceeds its budget.
 * @param input - Bounded collection request for an existing basic report.
 * @param options - Total deadline and the cleanup window reserved within it.
 * @param signal - Application shutdown or recovery cancellation; an already-aborted signal prevents startup.
 * @returns Append outcome only after Worker exit; cancellation or termination requests alone do not confirm exit.
 */
export async function runOperationReportJob(
  input: OperationReportJobInput, options: OperationReportJobOptions, signal: AbortSignal,
): Promise<OperationReportJobResult> {
  const { timeoutMs, cancellationGraceMs } = options
  if (!Number.isSafeInteger(timeoutMs) || !Number.isSafeInteger(cancellationGraceMs)
    || cancellationGraceMs < 1 || timeoutMs <= cancellationGraceMs) throw new RangeError('Invalid operation report deadlines')
  if (signal.aborted) return { appended: false, timedOut: false, cancelled: true }
  const deadline = performance.now() + timeoutMs
  let worker: Worker
  try {
    worker = new Worker(new URL('./operation-report-worker.js', import.meta.url), {
      workerData: input, resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 },
    })
  }
  catch (_error) { return { appended: false, timedOut: false, cancelled: false } }
  return new Promise((resolve) => {
    let appended = false
    let failed = false
    let timedOut = false
    let cancelled = false
    let termination: ReturnType<typeof setTimeout> | undefined
    const force = (): void => { void worker.terminate().catch(() => { failed = true }) }
    const cancel = (): void => {
      if (cancelled) return
      cancelled = true
      clearTimeout(collection)
      try { worker.postMessage('cancel') }
      catch (_error) { failed = true }
      termination = setTimeout(force, Math.max(0, Math.min(cancellationGraceMs, deadline - performance.now())))
    }
    const collection = setTimeout(() => {
      timedOut = true
      cancel()
    }, Math.max(0, deadline - performance.now() - cancellationGraceMs))
    signal.addEventListener('abort', cancel, { once: true })
    worker.on('message', (message: unknown) => { appended = message === true })
    worker.once('error', () => { failed = true })
    worker.once('exit', (code) => {
      clearTimeout(collection)
      clearTimeout(termination)
      signal.removeEventListener('abort', cancel)
      resolve({ appended: appended && code === 0 && !failed && !cancelled, timedOut, cancelled })
    })
    if (signal.aborted) cancel()
  })
}

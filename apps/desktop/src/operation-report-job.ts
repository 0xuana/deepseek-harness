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

/** A timed-out job can have appended a partial section; the saved basic report remains valid. */
export interface OperationReportJobResult {
  readonly appended: boolean
  readonly timedOut: boolean
}

/**
 * Start one isolated collector and await its exit, terminating it at the deadline.
 * @param input - Bounded collection request for an existing basic report.
 * @param timeoutMs - Wall-clock budget including worker startup, before termination is requested.
 * @returns Append outcome only after the worker exits; worker startup/error failures remain auxiliary failures.
 */
export async function runOperationReportJob(input: OperationReportJobInput, timeoutMs: number): Promise<OperationReportJobResult> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new RangeError('Invalid operation report deadline')
  let worker: Worker
  try {
    worker = new Worker(new URL('./operation-report-worker.js', import.meta.url), {
      workerData: input, resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 },
    })
  }
  catch (_error) { return { appended: false, timedOut: false } }
  return new Promise((resolve) => {
    let appended = false
    let failed = false
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      void worker.terminate().catch(() => { failed = true })
    }, timeoutMs)
    worker.on('message', (message: unknown) => { appended = message === true })
    worker.once('error', () => { failed = true })
    worker.once('exit', (code) => {
      clearTimeout(timer)
      resolve({ appended: appended && code === 0 && !failed && !timedOut, timedOut })
    })
  })
}

/** Isolated auxiliary-report I/O; the shell owns termination and observes worker exit. */
import { parentPort, workerData } from 'node:worker_threads'
import { z } from 'zod'
import { appendOperationReport } from './operation-report.ts'

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const input = z.object({
  reportPath: z.string(), directory: z.string(),
  limits: z.object({ bytes: positive, recordBytes: positive, records: positive, outputBytes: positive }),
  journal: z.object({ dropped: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
    repairedSegments: z.number().int().nonnegative(), queuedBytes: z.number().int().nonnegative(), disabled: z.boolean() }).nullable(),
}).parse(workerData)

const appended = await appendOperationReport(input.reportPath, input.directory, input.limits, new AbortController().signal, input.journal)
parentPort?.postMessage(appended)

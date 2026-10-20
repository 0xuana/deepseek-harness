/** Built job and packaged Worker acceptance without provider credentials. */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it, onTestFinished } from 'vitest'

const job = new URL('../lib/types/operation-report-job.js', import.meta.url)
const worker = new URL('../lib/operation-report-worker.js', import.meta.url)

it.skipIf(!existsSync(new URL('../lib/types/', import.meta.url)))('appends operation history through the built job and packaged Worker', async () => {
  expect(existsSync(job), 'built report job').toBe(true)
  expect(existsSync(worker), 'packaged report Worker').toBe(true)
  const directory = await mkdtemp(join(tmpdir(), 'desktop-operation-worker-'))
  onTestFinished(async () => { await rm(directory, { recursive: true, force: true }) })
  const record = { runId: 'c254ab28-97c9-4382-95e6-2db9c66f98c8', transportDropped: 0,
    operation: { id: 'c254ab28-97c9-4382-95e6-2db9c66f98c9', time: '2026-10-19T00:00:00.000Z',
      reason: 'bundle', phase: 'started', target: 'real-worker-test', stage: 'enable' } }
  await writeFile(join(directory, 'operations.jsonl'), JSON.stringify(record) + '\n')
  for (const mode of ['job', 'packaged']) {
    const reportPath = join(directory, mode + '.log')
    await writeFile(reportPath, 'basic report\n')
    const input = { reportPath, directory, journal: null,
      limits: { bytes: 65536, recordBytes: 4096, records: 100, outputBytes: 65536 } }
    const script = join(directory, mode + '.mjs')
    await writeFile(script, mode === 'job'
      ? `import { runOperationReportJob } from ${JSON.stringify(job.href)};\nconsole.log(JSON.stringify(await runOperationReportJob(${JSON.stringify(input)}, 10000)));\n`
      : `import { Worker } from 'node:worker_threads';\nconst worker = new Worker(${JSON.stringify(fileURLToPath(worker))}, { workerData: ${JSON.stringify(input)} });\nworker.on('error', error => { throw error });\nworker.on('exit', code => { if (code !== 0) process.exitCode = 1 });\n`)
    const result = await execa(process.execPath, [script], { timeout: 30000, reject: false })
    expect(result.timedOut).toBe(false)
    expect(result.signal).toBeUndefined()
    expect(result.exitCode, result.stderr).toBe(0)
    if (mode === 'job') expect(JSON.parse(result.stdout)).toEqual({ appended: true, timedOut: false })
    const report = await readFile(reportPath, 'utf8')
    expect(report.startsWith('basic report\n')).toBe(true)
    const summary = JSON.parse(report.split('\n').find(line => line.startsWith('{'))!) as { records: unknown[] }
    expect(summary.records).toEqual([record])
    expect(report).toContain('operation history collection complete')
  }
})

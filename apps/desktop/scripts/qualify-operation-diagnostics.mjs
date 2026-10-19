/** Manual built-code qualification: fresh processes, bounded work, and retained report output. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { readOperationHistory } from '../lib/types/operation-history.js'
import { appendOperationReport } from '../lib/types/operation-report.js'
import { writeCrashReport } from '../lib/types/crash-report.js'

const limits = { bytes: 65536, recordBytes: 4096, records: 100, outputBytes: 65536 }
const record = index => ({
  runId: 'c254ab28-97c9-4382-95e6-2db9c66f98c8', transportDropped: 0,
  operation: { id: `c254ab28-97c9-4382-95e6-${index.toString(16).padStart(12, '0')}`,
    time: '2026-10-19T00:00:00.000Z', reason: 'bundle', phase: 'settled', target: `synthetic-plugin-${index % 50}`,
    stage: 'enable', application: 'restart-required', changed: true, version: '1.0.0' },
})

if (process.argv[2] === '--sample') {
  const directory = process.argv[3]
  global.gc?.()
  const baseline = { ...process.memoryUsage(), maxRssKiB: process.resourceUsage().maxRSS }
  const start = performance.now()
  const report = await writeCrashReport(directory, {
    source: 'host', phase: 'startup', error: new Error('synthetic startup failure'), rendererConsole: [],
    operationHistoryPlanned: true, time: new Date(),
    app: { name: 'qualification', version: 'test', platform: process.platform, arch: process.arch,
      electron: 'not-running', node: process.version, locale: 'zh-CN' },
  })
  assert.ok(report)
  const basicMs = performance.now() - start
  const basic = await readFile(report)
  const collectStart = performance.now()
  const history = await readOperationHistory(directory, limits, new AbortController().signal)
  const collectMs = performance.now() - collectStart
  assert.ok(history.filesRead <= 2)
  assert.ok(history.bytesRead <= limits.bytes)
  assert.ok(history.records.length <= limits.records)
  assert.ok(history.records.length >= 50)
  const appendStart = performance.now()
  assert.equal(await appendOperationReport(report, directory, limits, AbortSignal.timeout(500), null), true)
  const appendMs = performance.now() - appendStart
  const output = await readFile(report)
  assert.equal(output.subarray(0, basic.length).equals(basic), true)
  assert.ok(output.length - basic.length <= limits.outputBytes)
  global.gc?.()
  const retained = process.memoryUsage()
  console.log(JSON.stringify({ basicMs, collectMs, appendMs, filesRead: history.filesRead, bytesRead: history.bytesRead,
    records: history.records.length, invalidRecords: history.invalidRecords, reportBytes: output.length,
    baseline, retained, peakRssKiB: process.resourceUsage().maxRSS, retainedOutputBytes: output.length }))
} else {
  const outputPath = process.argv[2]
  if (outputPath === undefined) throw new Error('Provide an output JSON path; build Desktop Host TypeScript first')
  const root = await mkdtemp(join(tmpdir(), 'dsh-diagnostic-qualification-'))
  const samples = []
  try {
    for (const scenario of ['ordinary-50', 'two-gib', 'many-unrelated-files', 'dense-and-corrupt']) {
      const directory = join(root, scenario)
      await mkdir(directory)
      const fixtureStart = performance.now()
      const tail = Array.from({ length: scenario === 'dense-and-corrupt' ? 2000 : 50 }, (_, i) => JSON.stringify(record(i))).join('\n') + '\n'
      if (scenario === 'two-gib') {
        await using file = await open(join(directory, 'operations.jsonl'), 'w')
        const size = 2 * 1024 ** 3
        await file.truncate(size)
        const bytes = Buffer.from('\n' + tail)
        await file.write(bytes, 0, bytes.length, size - bytes.length)
      } else {
        await writeFile(join(directory, 'operations.jsonl'), tail
          + (scenario === 'dense-and-corrupt' ? '{broken}\n' + 'x'.repeat(16384) + '\n{"partial":' : ''))
      }
      if (scenario === 'many-unrelated-files') {
        await using raw = await open(join(directory, 'pnpm.log'), 'w')
        await raw.truncate(2 * 1024 ** 3)
        for (let batch = 0; batch < 100; batch++) {
          await Promise.all(Array.from({ length: 50 }, (_, i) => writeFile(join(directory, `rotated-${batch * 50 + i}.log`), 'unrelated')))
        }
      }
      const fixtureMs = performance.now() - fixtureStart
      for (let trial = 0; trial < 3; trial++) {
        const child = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=64', fileURLToPath(import.meta.url), '--sample', directory], {
          encoding: 'utf8', timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024,
        })
        assert.equal(child.error, undefined)
        assert.equal(child.signal, null)
        assert.equal(child.status, 0, child.stderr)
        samples.push({ scenario, trial, fixtureMs, ...JSON.parse(child.stdout) })
      }
    }
    const evidence = { runtime: process.version, platform: process.platform, arch: process.arch,
      scope: 'Built component/report calls in fresh Node processes; not packaged Electron or cold filesystem cache. Fixture setup excluded. Heap capped at 64 MiB; peak RSS includes runtime/imports.',
      limits, samples }
    await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n')
    console.log(JSON.stringify(evidence))
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    await rm(root, { recursive: true, force: true })
  }
}

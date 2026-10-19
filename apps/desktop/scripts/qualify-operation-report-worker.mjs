/** Built Worker qualification with an injected stalled read; no product fault-injection option. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { runOperationReportJob } from '../lib/types/operation-report-job.js'

if (process.argv[2] === '--sample') {
  const directory = process.argv[3]
  const stalled = process.argv[4] === 'stalled'
  const reportPath = join(directory, 'basic.log')
  const basic = 'Independent basic crash report\n'
  await writeFile(reportPath, basic)
  const start = performance.now()
  const result = await runOperationReportJob({ reportPath, directory, journal: null,
    limits: { bytes: 65536, recordBytes: 4096, records: 100, outputBytes: 65536 } }, stalled ? 2000 : 500)
  const elapsedMs = performance.now() - start
  const output = await readFile(reportPath, 'utf8')
  if (stalled) {
    assert.equal(await readFile(join(directory, 'read-entered'), 'utf8'), 'ready')
    assert.deepEqual(result, { appended: false, timedOut: true })
    assert.equal(output, basic)
  } else {
    assert.deepEqual(result, { appended: true, timedOut: false })
    assert.ok(output.startsWith(basic))
  }
  console.log(JSON.stringify({ stalled, elapsedMs, result, reportBytes: Buffer.byteLength(output), peakRssKiB: process.resourceUsage().maxRSS }))
} else {
  const root = await mkdtemp(join(tmpdir(), 'dsh-worker-qualification-'))
  const samples = []
  try {
    for (const stalled of [false, true]) {
      const child = spawnSync(process.execPath, [
        ...(stalled ? ['--import', new URL('../tests/fixtures/operation-read-stall.mjs', import.meta.url).href] : []),
        fileURLToPath(import.meta.url), '--sample', root, stalled ? 'stalled' : 'normal',
      ], { windowsHide: true, timeout: 15000, encoding: 'utf8', maxBuffer: 1024 * 1024 })
      assert.equal(child.error, undefined)
      assert.equal(child.signal, null)
      assert.equal(child.status, 0, child.stderr)
      samples.push(JSON.parse(child.stdout))
    }
    const evidence = { runtime: process.version, platform: process.platform,
      scope: 'Real built Worker exit after normal collection and injected pending asynchronous read; not a kernel-hung filesystem or Electron measurement.', samples }
    if (process.argv[2] !== undefined) await writeFile(process.argv[2], JSON.stringify(evidence, null, 2) + '\n')
    console.log(JSON.stringify(evidence))
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    await rm(root, { recursive: true, force: true })
  }
}

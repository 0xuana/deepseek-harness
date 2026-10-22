/** Operator-only comparison of serial signing, post-sign overlap and two concurrent hardware requests. */
import { execFile } from 'node:child_process'
import { createHash, X509Certificate } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, cpus, totalmem } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { loadDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'
import { createPackagingRun, recordPackagingEvent } from '../scripts/packaging-run.mjs'
import { beginWindowsSigningAttempt } from '../scripts/windows-signing-state.mjs'
import { withWindowsSigningStage } from '../scripts/windows-signing-stage.mjs'
import { inspectWindowsTokenIdentity, windowsTokenIdentityFailure } from '../scripts/windows-token-identity.ts'
import { buildWindowsSigningEnvironment, createWindowsTokenSigner, scrubWindowsSigningEnvironment } from '../scripts/windows-sign.mjs'
import { inspectWindowsRuntimeSignature } from '../scripts/windows-runtime-signature.mjs'
import { completeWindowsSignature, normalizeWindowsSignature } from '../scripts/windows-timestamp.mjs'
import { runSigningExperimentBatch } from './helpers/windows-signing-experiment.ts'

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url))
const MODES = [
  { name: 'serial', jobs: 1, hardwareConcurrency: 1 },
  { name: 'pipeline', jobs: 2, hardwareConcurrency: 1 },
  { name: 'hardware2', jobs: 2, hardwareConcurrency: 2 },
] as const

/**
 * Run an explicitly opted-in hardware experiment, retaining all generated probes and audit records.
 * @param args CLI arguments; omission uses the current process arguments.
 * @returns Resolves after all requested batches verify; any failure retains the batch interlock and stops later modes.
 */
export async function runWindowsSigningConcurrencyExperiment(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({ args, options: {
    execute: { type: 'boolean' }, 'config-root': { type: 'string' }, rounds: { type: 'string', default: '2' },
  } })
  if (!values.execute) {
    console.log('Operator hardware experiment: node apps/desktop/tests/windows-signing-concurrency.perf.ts --execute --config-root <absolute-machine-packaging-directory> [--rounds 1|2]')
    return
  }
  if (process.platform !== 'win32' || !values['config-root'] || !isAbsolute(values['config-root'])
    || !['1', '2'].includes(values.rounds)) throw new Error('Requires Windows, an absolute config-root and rounds 1 or 2')
  const environment = loadDesktopPackageEnvironment('win32', {
    ...process.env, DSH_PACKAGING_PRESET: 'test', DSH_PACKAGING_CONFIG_DIR: values['config-root'],
  })
  const certificateFile = environment.DSH_DESKTOP_WINDOWS_CER_FILE!
  const signTool = environment.DSH_DESKTOP_WINDOWS_SIGNTOOL!
  const tokenPin = environment.DSH_DESKTOP_WINDOWS_TOKEN_PIN!
  const keyContainer = environment.DSH_DESKTOP_WINDOWS_KEY_CONTAINER!.trim()
  // Construction validates the same signing inputs; the production serial hook is never invoked here.
  createWindowsTokenSigner({ certificateFile, signTool, tokenPin, keyContainer })
  const certificate = await readFile(certificateFile)
  const leaf = new X509Certificate(certificate)
  if (Date.now() < Date.parse(leaf.validFrom) || Date.now() > Date.parse(leaf.validTo)) {
    throw new Error('Signing experiment requires a currently valid public certificate')
  }
  const thumbprint = leaf.fingerprint.replaceAll(':', '')
  const safeEnvironment = scrubWindowsSigningEnvironment(environment)
  delete safeEnvironment.NODE_OPTIONS
  delete safeEnvironment.NODE_PATH
  const run = createPackagingRun(join(APP_ROOT, '.desktop-build', 'qualification', 'signing-concurrency'), {
    kind: 'operator-signing-concurrency', certificateSha256: createHash('sha256').update(certificate).digest('hex'),
    node: process.version, cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(),
    rounds: Number(values.rounds), resourceBytes: [0, 1024 * 1024, 16 * 1024 * 1024], filesPerBatch: 6,
    cache: 'disabled', probeExecuted: false,
  }, { parallel: true, secrets: [tokenPin, keyContainer] })
  console.log(`SIGNING_EXPERIMENT_RECORD ${run.directory}`)
  const controller = new AbortController()
  const abort = (): void => { controller.abort(new Error('Operator interrupted the signing experiment')) }
  process.once('SIGINT', abort)
  process.once('SIGTERM', abort)
  const record = (event: object): void => { recordPackagingEvent(run.directory, event) }
  let success = false
  try {
    await withWindowsSigningStage({ stage: 'operator-signing-concurrency', signal: controller.signal, record }, async () => {
      if (existsSync(join(homedir(), '.dsh-desktop-signing', 'attempt.json'))) {
        throw new Error('Retained signing interlock requires operator inspection; experiment refused')
      }
      const identity = await inspectWindowsTokenIdentity({ certificate, container: keyContainer, environment: safeEnvironment })
      record({ type: 'experiment-public-identity', result: identity, pinSupplied: false })
      if (identity !== 'matched') throw new Error(windowsTokenIdentityFailure(identity))
      const templates: string[] = []
      const source = join(run.directory, 'probe.cs')
      await writeFile(source, 'internal static class SigningProbe { private static int Main() { return 0; } }\n', { flag: 'wx' })
      for (const size of [0, 1024 * 1024, 16 * 1024 * 1024]) {
        controller.signal.throwIfAborted()
        const resource = join(run.directory, `resource-${size}.bin`)
        if (size) await writeFile(resource, Buffer.alloc(size, 0x5a), { flag: 'wx' })
        const output = join(run.directory, `unsigned-${size}.exe`)
        await run.run(`compile-probe-${size}`, join(environment.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
          ['/nologo', '/target:exe', '/platform:x64', `/out:${output}`, ...(size ? [`/resource:${resource}`] : []), source],
          { cwd: run.directory, env: safeEnvironment, timeoutMs: 30_000 })
        if ((await inspectWindowsRuntimeSignature(output)).status !== 'NotSigned') throw new Error('Probe must be unsigned')
        templates.push(output)
      }
      const results: { round: number; mode: string; elapsedMs: number; files: number }[] = []
      for (let round = 1; round <= Number(values.rounds); round++) {
        const order = round % 2 ? MODES : [...MODES].reverse()
        for (const mode of order) {
          controller.signal.throwIfAborted()
          const directory = join(run.directory, `round-${round}-${mode.name}`)
          await mkdir(directory)
          const files: string[] = []
          for (let index = 0; index < templates.length * 2; index++) {
            const file = join(directory, `probe-${index}.exe`)
            await copyFile(templates[Math.floor(index / 2)]!, file)
            files.push(file)
          }
          record({ type: 'experiment-batch-plan', round, ...mode, files })
          const attempt = beginWindowsSigningAttempt({ runDirectory: run.directory, target: directory })
          let commandIndex = 0
          const started = performance.now()
          try {
            await runSigningExperimentBatch(files, {
              ...mode, signal: controller.signal,
              sign: async (_file, path) => {
                controller.signal.throwIfAborted()
                const stage = `experiment-sign-${round}-${mode.name}-${commandIndex++}`
                record({ type: 'experiment-hardware-start', stage, path })
                const interpreter = environment.ComSpec ?? join(environment.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe')
                await run.run(stage, interpreter,
                  ['/d', '/v:off', '/c', 'windows-sign.cmd'], {
                    cwd: join(APP_ROOT, 'scripts'), timeoutMs: 60_000,
                    env: buildWindowsSigningEnvironment(safeEnvironment, {
                      certificateFile, signTool, tokenPin, keyContainer, path, isNest: false,
                    }),
                  })
                record({ type: 'experiment-hardware-exited', stage, path })
                const signature = await inspectWindowsRuntimeSignature(path)
                if (signature.status !== 'Valid' || signature.timestamped || signature.thumbprint?.toUpperCase() !== thumbprint.toUpperCase()) {
                  throw new Error('Primary signature verification failed')
                }
                record({ type: 'experiment-hardware-verified', stage, path })
              },
              complete: async (path, sign) => {
                await completeWindowsSignature(path, {
                  thumbprint, sign, inspect: inspectWindowsRuntimeSignature, evidenceDirectory: run.directory, record,
                  normalize: file => normalizeWindowsSignature(file, signTool, safeEnvironment),
                  timestamp: async (file) => {
                    await promisify(execFile)(signTool, ['timestamp', '/v', '/tr', 'http://timestamp.digicert.com', '/td', 'sha256', file], {
                      env: safeEnvironment, windowsHide: true, timeout: 60_000,
                    })
                  },
                })
                const signature = await inspectWindowsRuntimeSignature(path)
                if (signature.status !== 'Valid' || !signature.timestamped || signature.thumbprint?.toUpperCase() !== thumbprint.toUpperCase()) {
                  throw new Error('Published probe signature verification failed')
                }
                record({ type: 'experiment-file-verified', path, ...signature,
                  sha256: createHash('sha256').update(await readFile(path)).digest('hex') })
              },
            })
            controller.signal.throwIfAborted()
            const result = { round, mode: mode.name, elapsedMs: performance.now() - started, files: files.length }
            results.push(result)
            record({ type: 'experiment-batch-complete', ...result })
            await writeFile(join(run.directory, 'measurements.json'), `${JSON.stringify(results, null, 2)}\n`, { flush: true })
            attempt.success()
            console.log(`SIGNING_EXPERIMENT_SAMPLE ${JSON.stringify(result)}`)
          } catch (error) {
            attempt.failure(null, 'Signing concurrency experiment failed; inspect retained records before recovery')
            throw error
          }
        }
      }
    })
    success = true
  } finally {
    process.removeListener('SIGINT', abort)
    process.removeListener('SIGTERM', abort)
    run.finish(success)
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWindowsSigningConcurrencyExperiment().catch(() => {
    // Child-process errors can embed arguments; the retained supervisor output is already redacted.
    console.error('Signing experiment stopped; inspect its retained record. No automatic hardware retry or interlock recovery.')
    process.exitCode = 1
  })
}

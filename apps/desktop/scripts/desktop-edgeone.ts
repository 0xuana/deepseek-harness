/** Refresh production fixed-installer URLs through EdgeOne with resumable task tracking. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { teo } from 'tencentcloud-sdk-nodejs-teo'
import type { DesktopPackageTargetName } from './package-target.ts'
import { desktopLatestInstallerFilename, resolveDesktopAutoUpdateConfig } from './desktop-auto-update-environment.mjs'
import { recordPackagingEvent } from './packaging-run.mjs'

/** Validated production destination and credentials; never serialize this value. */
export interface DesktopPurgeConfig {
  readonly target: DesktopPackageTargetName
  readonly zoneId: string
  readonly publicUrl: string
  readonly secretId: string
  readonly secretKey: string
  readonly timeoutMs: number
  readonly pollIntervalMs: number
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new DesktopPurgeError(`desktop purge: ${name} must be set in the target dotenv`)
  return value
}

function milliseconds(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  if (env[name] === undefined) return fallback
  const value = Number(env[name])
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new DesktopPurgeError(`desktop purge: ${name} must be a positive timer duration in milliseconds`)
  }
  return value
}

/**
 * Resolve the production URL, EO zone and existing COS credentials before any upload.
 * @param env Target dotenv settings, with any credential-launcher replacement already applied.
 * @param target Fixed installer selected by the operator.
 * @returns Required EO settings; test deployments and invalid settings throw before network writes.
 */
export function resolveDesktopPurgeConfig(env: NodeJS.ProcessEnv, target: DesktopPackageTargetName): DesktopPurgeConfig {
  if (env.DSH_DESKTOP_AUTO_UPDATE_ENV?.trim() !== 'production') throw new DesktopPurgeError('desktop purge: production is required')
  const update = resolveDesktopAutoUpdateConfig(env, target === 'win-x64' ? 'win32' : 'darwin', target === 'mac-arm64' ? 'arm64' : 'x64')
  const zoneId = required(env, 'DOWNLOAD_PROD_EO_ZONE_ID')
  if (!/^zone-[a-z0-9]+$/u.test(zoneId)) throw new DesktopPurgeError('desktop purge: DOWNLOAD_PROD_EO_ZONE_ID must name one EO zone')
  const timeoutMs = milliseconds(env, 'DOWNLOAD_PROD_EO_TIMEOUT_MS', 300_000)
  const pollIntervalMs = milliseconds(env, 'DOWNLOAD_PROD_EO_POLL_INTERVAL_MS', 5_000)
  if (pollIntervalMs > timeoutMs) throw new DesktopPurgeError('desktop purge: poll interval must not exceed timeout')
  return {
    target, zoneId, publicUrl: `${update.origin}/desktop/${desktopLatestInstallerFilename(target)}`,
    secretId: required(env, 'DOWNLOAD_PROD_COS_SECRET_ID'), secretKey: required(env, 'DOWNLOAD_PROD_COS_SECRET_KEY'),
    timeoutMs, pollIntervalMs,
  }
}

/** A failed or incomplete purge, with only safe diagnostics available to CLI callers. */
export class DesktopPurgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DesktopPurgeError'
  }
}

function safeField(value: unknown, config: DesktopPurgeConfig): string | undefined {
  if (typeof value !== 'string' || !/^[\w.-]{1,128}$/u.test(value)
    || value.includes(config.secretId) || value.includes(config.secretKey)) return undefined
  return value
}

/**
 * Submit one URL purge, or wait for an existing task without submitting again.
 * @param config Validated production destination and credentials.
 * @param recordsRoot Parent directory for separate purge records; upload records remain intact.
 * @param existingJobId EO task to resume; omitted submits once, without automatic write retries.
 * @returns Resolves only after EO reports success for the exact target URL and task ID.
 * @throws DesktopPurgeError on failure, timeout or unknown submission outcome; uploaded bytes remain unchanged.
 */
export async function purgeDesktopInstaller(config: DesktopPurgeConfig, recordsRoot: string, existingJobId?: string): Promise<void> {
  if (existingJobId !== undefined && !/^[a-zA-Z0-9-]{1,128}$/u.test(existingJobId)) {
    throw new DesktopPurgeError('desktop purge: invalid --job-id')
  }
  let directory: string | undefined
  let jobId = existingJobId
  let stage = 'prepare'
  let success = false
  let failure: string | undefined
  let rejected = false
  let report: DesktopPurgeError | undefined
  try {
    await mkdir(recordsRoot, { recursive: true })
    directory = await mkdtemp(join(recordsRoot, `production-${config.target}-purge-`))
    process.stdout.write(`desktop purge: record ${directory}\n`)
    await writeFile(join(directory, 'events.jsonl'), '', { flag: 'wx', mode: 0o600, flush: true })
    await writeFile(join(directory, 'plan.json'), `${JSON.stringify({ zoneId: config.zoneId, publicUrl: config.publicUrl,
      target: config.target, jobId, timeoutMs: config.timeoutMs, pollIntervalMs: config.pollIntervalMs })}\n`,
    { flag: 'wx', mode: 0o600, flush: true })
    const httpProfile = { endpoint: 'teo.tencentcloudapi.com', reqTimeout: Math.min(30, config.timeoutMs / 1000) }
    const client = new teo.v20220901.Client({
      credential: { secretId: config.secretId, secretKey: config.secretKey }, region: '',
      profile: { httpProfile },
    })
    const deadline = performance.now() + config.timeoutMs
    if (jobId === undefined) {
      stage = 'CreatePurgeTask'
      recordPackagingEvent(directory, { type: 'purge-intent', url: config.publicUrl })
      const response = await client.CreatePurgeTask({ ZoneId: config.zoneId, Type: 'purge_url', Targets: [config.publicUrl] })
      jobId = safeField(response.JobId, config)
      if (jobId) process.stdout.write(`desktop purge: task ${jobId}\n`)
      recordPackagingEvent(directory, { type: 'purge-submitted', jobId, requestId: safeField(response.RequestId, config) })
      if ((response.FailedList?.length ?? 0) > 0) {
        rejected = true
        throw new DesktopPurgeError('EO rejected the URL purge')
      }
      if (!jobId) throw new DesktopPurgeError('EO returned no task ID; submission outcome is unknown')
    }
    stage = 'DescribePurgeTasks'
    while (performance.now() < deadline) {
      client.profile.httpProfile = { ...httpProfile, reqTimeout: Math.min(30, Math.max(0.001, (deadline - performance.now()) / 1000)) }
      const response = await client.DescribePurgeTasks({ ZoneId: config.zoneId, Limit: 1000,
        Filters: [{ Name: 'job-id', Values: [jobId] }, { Name: 'target', Values: [config.publicUrl] }] })
      if ((response.TotalCount ?? 0) > 1000) throw new DesktopPurgeError('EO task query exceeded its page limit')
      const tasks = response.Tasks?.filter(task => task.JobId === jobId && task.Target === config.publicUrl && task.Type === 'purge_url') ?? []
      const task = tasks[0]
      if (tasks.length > 1) throw new DesktopPurgeError('EO returned multiple entries for the URL and task ID')
      const status = task?.Status
      recordPackagingEvent(directory, { type: 'purge-status', jobId, status: safeField(status, config), requestId: safeField(response.RequestId, config) })
      if (status === 'success') {
        success = true
        stage = 'complete'
        break
      }
      rejected = status === 'failed' || status === 'timeout' || status === 'canceled'
      if (task !== undefined && status !== 'processing') throw new DesktopPurgeError(`EO task did not succeed (${safeField(status, config) ?? 'unknown status'})`)
      const remaining = deadline - performance.now()
      if (remaining > 0) await delay(Math.min(config.pollIntervalMs, remaining))
    }
    if (!success) throw new DesktopPurgeError('timed out waiting for EO; task completion is unknown')
  } catch (error) {
    const code = safeField(typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined, config)
    failure = error instanceof DesktopPurgeError ? error.message : `${stage} failed (${code ?? 'unclassified error'})`
    const recovery = rejected
      ? `Resolve the EO failure, then retry with pnpm run purge:latest ${config.target}.`
      : jobId ? `Resume with pnpm run purge:latest ${config.target} --job-id ${jobId}.`
        : 'Inspect EO task history before submitting another purge.'
    const permission = code?.startsWith('AuthFailure') || code?.startsWith('UnauthorizedOperation')
      ? ' Check teo:CreatePurgeTask and teo:DescribePurgeTasks permissions.' : ''
    report = new DesktopPurgeError(`desktop purge: ${failure}.${permission} ${recovery}`)
  } finally {
    if (directory !== undefined) {
      try {
        await writeFile(join(directory, 'result.json'), `${JSON.stringify({ success, stage, jobId, failure, publicUrl: config.publicUrl })}\n`,
        { flag: 'wx', mode: 0o600, flush: true })
      } catch (error) {
        // An unavailable journal cannot establish completion for a subsequent process.
        report = new DesktopPurgeError(`desktop purge: cannot save result; inspect EO task ${jobId ?? 'history'} and ${directory} before recovery`)
      }
    }
  }
  if (report !== undefined) throw report
  process.stdout.write(`desktop purge: completed ${config.publicUrl}\n`)
}

/** Refresh production fixed-installer URLs through EdgeOne with resumable task tracking. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { teo } from 'tencentcloud-sdk-nodejs-teo'
import type { DesktopPackageTargetName } from './package-target.ts'
import { desktopLatestInstallerFilename, requiredEnvironmentValue, resolveDesktopAutoUpdateEnvironment, resolveDesktopUploadConfig } from './desktop-auto-update-environment.mjs'
import { desktopTargetPlatform } from './desktop-build-paths.mjs'
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

/** SDK operations used by one purge; callers may supply an isolated client. */
export type DesktopPurgeClient = Pick<InstanceType<typeof teo.v20220901.Client>, 'profile' | 'CreatePurgeTask' | 'DescribePurgeTasks'>

/** Optional existing task, credential-launcher context, and caller-owned SDK client. */
export interface DesktopPurgeOptions {
  readonly jobId?: string
  readonly credentialLauncher?: boolean
  readonly client?: DesktopPurgeClient
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
 * @param publicUrl Uploaded object URL; omitted derives the fixed URL for cache-only recovery.
 * @returns Required EO settings; test deployments and invalid settings throw before network writes.
 */
export function resolveDesktopPurgeConfig(env: NodeJS.ProcessEnv, target: DesktopPackageTargetName,
  publicUrl?: string,
): DesktopPurgeConfig {
  if (resolveDesktopAutoUpdateEnvironment(env) !== 'production') throw new DesktopPurgeError('desktop purge: production is required')
  const { platform, arch } = desktopTargetPlatform(target)
  const update = resolveDesktopUploadConfig(env, platform, arch)
  const zoneId = requiredEnvironmentValue(env, 'DOWNLOAD_PROD_EO_ZONE_ID')
  if (!/^zone-[a-z0-9]+$/u.test(zoneId)) throw new DesktopPurgeError('desktop purge: DOWNLOAD_PROD_EO_ZONE_ID must name one EO zone')
  const timeoutMs = milliseconds(env, 'DOWNLOAD_PROD_EO_TIMEOUT_MS', 300_000)
  const pollIntervalMs = milliseconds(env, 'DOWNLOAD_PROD_EO_POLL_INTERVAL_MS', 5_000)
  if (pollIntervalMs > timeoutMs) throw new DesktopPurgeError('desktop purge: poll interval must not exceed timeout')
  return {
    target, zoneId, publicUrl: publicUrl ?? `${update.origin}/desktop/${desktopLatestInstallerFilename(target)}`,
    secretId: requiredEnvironmentValue(env, update.secretIdEnvName), secretKey: requiredEnvironmentValue(env, update.secretKeyEnvName),
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

function errorCode(error: unknown, config: DesktopPurgeConfig): string | undefined {
  return safeField(typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined, config)
}

function transientQueryError(error: unknown, config: DesktopPurgeConfig): boolean {
  const code = errorCode(error, config)
  // The pinned SDK wraps transport failures without preserving their original code.
  if (code === undefined && error instanceof Error && 'getRequestId' in error && 'getTraceId' in error) {
    return !('httpCode' in error) || (typeof error.httpCode === 'number' && (error.httpCode === 429 || error.httpCode >= 500))
  }
  return code !== undefined && (['RequestLimitExceeded', 'InternalError'].includes(code.split('.')[0]!)
    || ['ClientNetworkError', 'ClientNetworkSocketTimeoutError', 'ClientNetworkConnectTimeoutError',
      'RequestTimeout', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code))
}

/**
 * Submit one URL purge, or wait for an existing task without submitting again.
 * @param config Validated production destination and credentials.
 * @param recordsRoot Parent directory for separate purge records; upload records remain intact.
 * @param options Existing task, launcher context, and optional SDK client; submission is never retried.
 * @returns Resolves only after EO reports success for the exact target URL and task ID.
 * @throws DesktopPurgeError on failure, timeout or unknown submission outcome; uploaded bytes remain unchanged.
 */
export async function purgeDesktopInstaller(config: DesktopPurgeConfig, recordsRoot: string,
  options: DesktopPurgeOptions = {},
): Promise<void> {
  const existingJobId = options.jobId
  if (existingJobId !== undefined && !/^[a-zA-Z0-9-]{1,128}$/u.test(existingJobId)) {
    throw new DesktopPurgeError('desktop purge: invalid --job-id')
  }
  let directory: string | undefined
  let jobId = existingJobId
  let stage = 'prepare'
  let success = false
  let observedTask = false
  let lastQueryFailed = false
  let failure: string | undefined
  let rejected = false
  let report: DesktopPurgeError | undefined
  try {
    await mkdir(recordsRoot, { recursive: true })
    directory = await mkdtemp(join(recordsRoot, `production-${config.target}-purge-`))
    process.stdout.write(`desktop purge: record ${directory}\n`)
    await writeFile(join(directory, 'events.jsonl'), '', { flag: 'wx', mode: 0o600, flush: true })
    const sourceSha256 = { 'desktop-edgeone.ts': createHash('sha256').update(await readFile(import.meta.filename)).digest('hex') }
    await writeFile(join(directory, 'plan.json'), `${JSON.stringify({ schemaVersion: 1, sourceSha256, zoneId: config.zoneId, publicUrl: config.publicUrl,
      target: config.target, jobId, timeoutMs: config.timeoutMs, pollIntervalMs: config.pollIntervalMs })}\n`,
    { flag: 'wx', mode: 0o600, flush: true })
    const httpProfile = { endpoint: 'teo.tencentcloudapi.com', reqTimeout: Math.min(30, config.timeoutMs / 1000) }
    const client = options.client ?? new (await import('tencentcloud-sdk-nodejs-teo')).teo.v20220901.Client({
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
      client.profile.httpProfile!.reqTimeout = Math.min(30, Math.max(0.001, (deadline - performance.now()) / 1000))
      let response: Awaited<ReturnType<DesktopPurgeClient['DescribePurgeTasks']>>
      try {
        response = await client.DescribePurgeTasks({ ZoneId: config.zoneId, Limit: 1000,
          Filters: [{ Name: 'job-id', Values: [jobId] }] })
      } catch (error) {
        const code = errorCode(error, config)
        if (!transientQueryError(error, config)) throw error
        lastQueryFailed = true
        recordPackagingEvent(directory, { type: 'purge-query-retry', jobId, code: code ?? 'SDKTransportError' })
        const remaining = deadline - performance.now()
        if (remaining > 0) await delay(Math.min(config.pollIntervalMs, remaining))
        continue
      }
      lastQueryFailed = false
      if ((response.TotalCount ?? 0) > 1000) throw new DesktopPurgeError('EO task query exceeded its page limit')
      const tasks = response.Tasks?.filter(task => task.JobId === jobId && task.Target === config.publicUrl && task.Type === 'purge_url') ?? []
      if ((response.Tasks?.length ?? 0) > 0 && tasks.length === 0) {
        throw new DesktopPurgeError('EO job does not contain the expected URL purge; check the zone, job ID and target')
      }
      const task = tasks[0]
      observedTask ||= task !== undefined
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
    if (!success) throw new DesktopPurgeError(observedTask || lastQueryFailed
      ? 'timed out waiting for EO; task completion is unknown'
      : 'EO task was not found before the deadline; check the zone, job ID and EO task history')
  } catch (error) {
    const code = errorCode(error, config)
    failure = error instanceof DesktopPurgeError ? error.message : `${stage} failed (${code ?? 'unclassified error'})`
    const command = options.credentialLauncher
      ? `rerun upload-with-credentials.ps1 with the original -CredentialFile, -Environment production, -Target ${config.target} and -Bucket; include -Upload -Latest -PurgeOnly${!rejected && jobId ? ` -JobId ${jobId}` : ''}`
      : `pnpm run purge:latest ${config.target}${!rejected && jobId ? ` --job-id ${jobId}` : ''}`
    const recovery = rejected
      ? `Resolve the EO failure, then ${command}.`
      : jobId ? `Resume with ${command}.`
        : 'Inspect EO task history before submitting another purge.'
    const permission = code?.startsWith('AuthFailure') || code?.startsWith('UnauthorizedOperation')
      ? ' Check teo:CreatePurgeTask and teo:DescribePurgeTasks permissions.' : ''
    report = new DesktopPurgeError(`desktop purge: ${failure}.${permission} ${recovery}`)
  } finally {
    if (directory !== undefined) {
      try {
        await writeFile(join(directory, 'result.json'), `${JSON.stringify({ schemaVersion: 1, success, stage, jobId, failure, publicUrl: config.publicUrl })}\n`,
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

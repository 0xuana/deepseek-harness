import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { teo } from 'tencentcloud-sdk-nodejs-teo'
import { purgeDesktopInstaller, resolveDesktopPurgeConfig, type DesktopPurgeClient } from '../scripts/desktop-edgeone.ts'

const environment = {
  DSH_DESKTOP_AUTO_UPDATE_ENV: 'production', DOWNLOAD_PROD_COS_BUCKET: 'fixture-bucket',
  DOWNLOAD_PROD_COS_SECRET_ID: 'fixture-secret-id', DOWNLOAD_PROD_COS_SECRET_KEY: 'fixture-secret-key',
  DOWNLOAD_PROD_EO_ZONE_ID: 'zone-fixture', DOWNLOAD_PROD_EO_TIMEOUT_MS: '30', DOWNLOAD_PROD_EO_POLL_INTERVAL_MS: '10',
}
const config = resolveDesktopPurgeConfig(environment, 'mac-arm64')
const task = { JobId: 'job-1', Target: config.publicUrl, Type: 'purge_url', Status: 'success' }
const roots: string[] = []
let time = 0

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async (ms: number) => { time += ms }) }))

beforeEach(() => {
  time = 0
  vi.spyOn(performance, 'now').mockImplementation(() => time)
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-purge-'))
  roots.push(root)
  // Real SDK initialization, with both network operations replaced before use.
  const client = new teo.v20220901.Client({ credential: { secretId: config.secretId, secretKey: config.secretKey } })
  const create = vi.spyOn(client, 'CreatePurgeTask').mockResolvedValue({ JobId: 'job-1', RequestId: 'request-1' })
  const describe = vi.spyOn(client, 'DescribePurgeTasks').mockResolvedValue({ TotalCount: 1, Tasks: [task] })
  const run = (options: { jobId?: string; credentialLauncher?: boolean } = {}) =>
    purgeDesktopInstaller(config, root, { ...options, client })
  const directory = async () => join(root, (await readdir(root))[0]!)
  const result = async (): Promise<unknown> => JSON.parse(await readFile(join(await directory(), 'result.json'), 'utf8'))
  return { root, client, create, describe, run, directory, result }
}

function sdkError(code: string) {
  return Object.assign(new Error('private service details fixture-secret-key'), { code })
}

describe('production EdgeOne configuration', () => {
  it.each([
    [{ DSH_DESKTOP_AUTO_UPDATE_ENV: 'test' }, /production is required/u],
    [{ DSH_DESKTOP_AUTO_UPDATE_ENV: 'prod' }, /must be "test" or "production"/u],
    [{ DOWNLOAD_PROD_EO_ZONE_ID: '' }, /DOWNLOAD_PROD_EO_ZONE_ID/u],
    [{ DOWNLOAD_PROD_EO_ZONE_ID: 'invalid' }, /must name one EO zone/u],
    [{ DOWNLOAD_PROD_COS_SECRET_KEY: '' }, /DOWNLOAD_PROD_COS_SECRET_KEY/u],
    [{ DOWNLOAD_PROD_EO_TIMEOUT_MS: '0' }, /positive timer/u],
    [{ DOWNLOAD_PROD_EO_POLL_INTERVAL_MS: '31' }, /must not exceed timeout/u],
  ] as const)('rejects invalid settings %j', (patch, message) => {
    expect(() => resolveDesktopPurgeConfig({ ...environment, ...patch }, 'mac-arm64')).toThrow(message)
  })

  it('uses the upload plan URL verbatim and derives only cache-only destinations', () => {
    const url = 'https://download.deepseek.com/changed/installer.dmg'
    expect(resolveDesktopPurgeConfig(environment, 'mac-arm64', url).publicUrl).toBe(url)
    expect(resolveDesktopPurgeConfig(environment, 'win-x64').publicUrl).toBe('https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe')
    expect(resolveDesktopPurgeConfig(environment, 'mac-x64').publicUrl).toBe('https://download.deepseek.com/desktop/dsh-latest-macos-x64.dmg')
  })
})

describe('EdgeOne task tracking', () => {
  it('preserves SDK HTTP defaults through delayed visibility and processing, and records only safe evidence', async () => {
    const f = await fixture()
    const profile = f.client.profile.httpProfile
    f.describe.mockResolvedValueOnce({ Tasks: [] }).mockResolvedValueOnce({ Tasks: [{ ...task, Status: 'processing' }] })
    await f.run()
    expect(f.create).toHaveBeenCalledExactlyOnceWith({ ZoneId: config.zoneId, Type: 'purge_url', Targets: [config.publicUrl] })
    expect(f.describe).toHaveBeenCalledTimes(3)
    expect(f.describe).toHaveBeenLastCalledWith({ ZoneId: config.zoneId, Limit: 1000, Filters: [{ Name: 'job-id', Values: ['job-1'] }] })
    expect(f.client.profile.httpProfile).toBe(profile)
    expect(profile).toMatchObject({ reqMethod: 'POST', protocol: 'https://', reqTimeout: 0.01 })
    expect(await f.result()).toMatchObject({ schemaVersion: 1, success: true, stage: 'complete', jobId: 'job-1' })
    const plan = await readFile(join(await f.directory(), 'plan.json'), 'utf8')
    const hash = createHash('sha256').update(await readFile(new URL('../scripts/desktop-edgeone.ts', import.meta.url))).digest('hex')
    expect(JSON.parse(plan)).toMatchObject({ schemaVersion: 1, sourceSha256: { 'desktop-edgeone.ts': hash } })
    expect(plan).not.toContain(config.secretId)
    expect(plan).not.toContain(config.secretKey)
  })

  it('resumes an existing multi-URL job without resubmission', async () => {
    const f = await fixture()
    f.describe.mockResolvedValue({ Tasks: [{ ...task, Target: 'https://example.com/other' }, task] })
    await f.run({ jobId: 'job-1' })
    expect(f.create).not.toHaveBeenCalled()
    expect(await f.result()).toMatchObject({ success: true })
  })

  it.each(['RequestLimitExceeded', 'InternalError.Backend', 'ECONNRESET'])('retries %s queries within the deadline', async (code) => {
    const f = await fixture()
    f.describe.mockRejectedValueOnce(sdkError(code))
    await f.run()
    expect(f.create).toHaveBeenCalledOnce()
    expect(f.describe).toHaveBeenCalledTimes(2)
  })

  it.each([undefined, 503])('bounds code-less SDK transport failures with HTTP status %s', async (httpCode) => {
    const f = await fixture()
    const error = Object.assign(new Error('private network details'), { getRequestId: () => '', getTraceId: () => '',
      ...httpCode === undefined ? {} : { httpCode } })
    f.describe.mockRejectedValue(error)
    await expect(f.run()).rejects.toThrow(/timed out.*--job-id job-1/u)
    expect(f.describe).toHaveBeenCalledTimes(3)
    expect(await f.result()).toMatchObject({ success: false })
  })

  it.each(['AuthFailure', 'UnauthorizedOperation', 'InvalidParameter', 'InvalidParameterValue', 'MissingParameter'])('stops immediately on %s', async (code) => {
    const f = await fixture()
    f.describe.mockRejectedValue(sdkError(code))
    await expect(f.run()).rejects.toThrow(new RegExp(`${code}.*--job-id job-1`, 'u'))
    expect(f.describe).toHaveBeenCalledOnce()
    expect(await f.result()).toMatchObject({ success: false })
    const evidence = await readFile(join(await f.directory(), 'result.json'), 'utf8')
    expect(evidence).not.toContain('private service details')
    expect(evidence).not.toContain(config.secretKey)
  })

  it.each(['failed', 'timeout', 'canceled'])('reports terminal %s with a fresh-purge recovery command', async (status) => {
    const f = await fixture()
    f.describe.mockResolvedValue({ Tasks: [{ ...task, Status: status }] })
    await expect(f.run()).rejects.toThrow('Resolve the EO failure, then pnpm run purge:latest mac-arm64.')
    expect(f.describe).toHaveBeenCalledOnce()
  })

  it('does not poll a rejected submission', async () => {
    const f = await fixture()
    f.create.mockResolvedValue({ FailedList: [{ Targets: [config.publicUrl], Reason: 'rejected' }] })
    await expect(f.run()).rejects.toThrow(/EO rejected.*Resolve the EO failure/u)
    expect(f.describe).not.toHaveBeenCalled()
  })

  it.each([{}, { RequestId: config.secretKey }])('reports unknown submission outcome when no job ID is returned', async (response) => {
    const f = await fixture()
    f.create.mockResolvedValue(response)
    await expect(f.run()).rejects.toThrow(/no task ID.*Inspect EO task history/u)
    expect(f.create).toHaveBeenCalledOnce()
    expect(f.describe).not.toHaveBeenCalled()
  })

  it('never retries a submission with an unknown outcome', async () => {
    const f = await fixture()
    f.create.mockRejectedValue(sdkError('ECONNRESET'))
    await expect(f.run()).rejects.toThrow(/Inspect EO task history/u)
    expect(f.create).toHaveBeenCalledOnce()
    expect(f.describe).not.toHaveBeenCalled()
  })

  it.each([
    [{ Tasks: [] }, /task was not found/u],
    [{ Tasks: [{ ...task, Status: 'processing' }] }, /task completion is unknown/u],
  ])('distinguishes invisible tasks from unfinished tasks: %j', async (response, message) => {
    const f = await fixture()
    f.describe.mockResolvedValue(response)
    await expect(f.run({ jobId: 'job-1' })).rejects.toThrow(message)
    expect(f.describe).toHaveBeenCalledTimes(3)
  })

  it.each([
    [{ TotalCount: 1001 }, /page limit/u],
    [{ Tasks: [task, task] }, /multiple entries/u],
    [{ Tasks: [{ ...task, Target: 'https://example.com/wrong' }] }, /does not contain the expected URL/u],
    [{ Tasks: [{ ...task, Status: 'unexpected' }] }, /did not succeed/u],
  ])('refuses ambiguous or mismatched task responses: %j', async (response, message) => {
    const f = await fixture()
    f.describe.mockResolvedValue(response)
    await expect(f.run()).rejects.toThrow(message)
  })

  it('retains the DPAPI launcher and original identity in recovery instructions', async () => {
    const f = await fixture()
    f.describe.mockRejectedValue(sdkError('UnauthorizedOperation'))
    await expect(f.run({ credentialLauncher: true })).rejects
      .toThrow(/original -CredentialFile.*-Bucket.*-Upload -Latest -PurgeOnly -JobId job-1/u)
  })

  it('does not report completion when the final record cannot be saved', async () => {
    const f = await fixture()
    f.describe.mockImplementation(async () => {
      await writeFile(join(await f.directory(), 'result.json'), 'occupied')
      return { Tasks: [task] }
    })
    await expect(f.run()).rejects.toThrow(/cannot save result; inspect EO task job-1/u)
    const output = vi.spyOn(process.stdout, 'write')
    expect(output).not.toHaveBeenCalledWith(expect.stringContaining('desktop purge: completed'))
  })

  it('rejects malformed recovery IDs before allocating a record or contacting EO', async () => {
    const f = await fixture()
    await expect(f.run({ jobId: 'unsafe value' })).rejects.toThrow(/invalid --job-id/u)
    expect(await readdir(f.root)).toEqual([])
    expect(f.create).not.toHaveBeenCalled()
    expect(f.describe).not.toHaveBeenCalled()
  })

  it('lazily initializes the pinned SDK when no client is supplied', async () => {
    const f = await fixture()
    vi.spyOn(teo.v20220901.Client.prototype, 'CreatePurgeTask').mockResolvedValue({ JobId: 'job-1' })
    vi.spyOn(teo.v20220901.Client.prototype, 'DescribePurgeTasks').mockImplementation(async function (this: InstanceType<typeof teo.v20220901.Client>) {
      expect(this.profile.httpProfile).toMatchObject({ reqMethod: 'POST', protocol: 'https://' })
      return { Tasks: [task] }
    })
    await purgeDesktopInstaller(config, f.root)
    expect(await f.result()).toMatchObject({ success: true })
  })

  it('accepts the minimal caller-owned client', async () => {
    const f = await fixture()
    const client: DesktopPurgeClient = { profile: f.client.profile, CreatePurgeTask: f.create, DescribePurgeTasks: f.describe }
    await purgeDesktopInstaller(config, f.root, { client })
    expect(await f.result()).toMatchObject({ success: true })
  })
})

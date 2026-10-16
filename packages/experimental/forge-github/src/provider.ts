/** GitHub implementation of the forge provider contract. */

import { changeRequestKey } from '@deepseek-ai/dsh-experimental-forge'
import type {
  ChangeRequestKey, ChangeRequestRef, ChangeRequestSnapshot, ForgeActionFailure, ForgeFailure, ForgeProvider, ForgeReadiness,
  ForgeRepository, MergeRequest,
} from '@deepseek-ai/dsh-experimental-forge'
import { GhUnavailableError } from './gh.ts'
import type { GhRunner } from './gh.ts'
import { HEAD_QUERY, mapHeadResponse, mapSnapshotResponse, snapshotQuery } from './graphql.ts'
import { checkedRepository, parsePullRequestUrl, parseRemoteUrl } from './urls.ts'

const AUTHENTICATION = /gh auth login|authentication|bad credentials|HTTP 401/i

/** Status code `gh api` appends to the message of a failed request. */
const HTTP_STATUS = /\(HTTP (\d{3})\)/

/** A full SHA-1 or SHA-256 object name. */
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i

/** Reads GitHub and GitHub Enterprise pull requests through a `gh` runner. */
export class GitHubProvider implements ForgeProvider {
  readonly forge = 'github'
  private readonly hosts: ReadonlySet<string>

  /**
   * @param gh - runner that executes `gh` on the host.
   * @param hosts - host names this provider serves, such as `github.com` and Enterprise hosts.
   */
  constructor(private readonly gh: GhRunner, hosts: readonly string[]) {
    this.hosts = new Set(hosts.map(host => host.toLowerCase()))
  }

  repositoryFromRemote(url: string): ForgeRepository | undefined {
    const location = parseRemoteUrl(url)
    if (location === undefined || !this.hosts.has(location.host)) return undefined
    return { forge: this.forge, ...location }
  }

  changeRequestFromUrl(url: string): ChangeRequestRef | undefined {
    const parsed = parsePullRequestUrl(url)
    if (parsed === undefined || !this.hosts.has(parsed.host)) return undefined
    return { repository: { forge: this.forge, host: parsed.host, owner: parsed.owner, name: parsed.name }, number: parsed.number }
  }

  changeRequestUrl(ref: ChangeRequestRef): string {
    const { host, owner, name } = ref.repository
    return `https://${host}/${owner}/${name}/pull/${ref.number}`
  }

  async fetch(
    refs: readonly ChangeRequestRef[],
    signal: AbortSignal,
  ): Promise<ReadonlyMap<ChangeRequestKey, ChangeRequestSnapshot | ForgeFailure>> {
    const byHost = new Map<string, ChangeRequestRef[]>()
    for (const ref of refs) {
      const group = byHost.get(ref.repository.host)
      if (group === undefined) byHost.set(ref.repository.host, [ref])
      else group.push(ref)
    }
    const results = new Map<ChangeRequestKey, ChangeRequestSnapshot | ForgeFailure>()
    for (const [host, group] of byHost) {
      for (const [key, result] of await this.fetchHost(host, group, signal)) results.set(key, result)
    }
    return results
  }

  async findByHead(repository: ForgeRepository, branch: string, signal: AbortSignal): Promise<readonly ChangeRequestRef[]> {
    const output = await this.gh([
      'api', 'graphql', '--hostname', repository.host,
      '-f', `query=${HEAD_QUERY}`, '-f', `owner=${repository.owner}`, '-f', `name=${repository.name}`, '-f', `branch=${branch}`,
    ], signal)
    const body = parseJson(output.stdout)
    if (body === undefined) throw new Error(`forge-github: head branch lookup failed: ${firstLine(output.stderr) ?? `gh exited with ${output.exitCode}`}`)
    return mapHeadResponse(body, repository, branch)
  }

  /**
   * Mark a draft pull request ready for review with `gh pr ready`; one that
   * is already ready stays ready.
   */
  async markReady(ref: ChangeRequestRef, signal: AbortSignal): Promise<ForgeActionFailure | undefined> {
    const { host, owner, name } = checkedRepository(ref)
    return await this.act(['pr', 'ready', String(ref.number), '--repo', `${host}/${owner}/${name}`], signal)
  }

  /**
   * Merge a pull request through the REST merge endpoint with the expected
   * head commit, so GitHub refuses with 409 once new commits arrived. Unlike
   * `gh pr merge`, it never enables auto-merge, never joins a merge queue, and
   * never deletes the head branch.
   */
  async merge(ref: ChangeRequestRef, request: MergeRequest, signal: AbortSignal): Promise<ForgeActionFailure | undefined> {
    const { host, owner, name } = checkedRepository(ref)
    if (!COMMIT.test(request.headSha)) throw new Error(`forge-github: invalid head commit ${JSON.stringify(request.headSha)}`)
    return await this.act([
      'api', '--hostname', host, '--method', 'PUT', `repos/${owner}/${name}/pulls/${ref.number}/merge`,
      '-f', `merge_method=${request.method}`, '-f', `sha=${request.headSha}`,
    ], signal)
  }

  async readiness(host: string, signal: AbortSignal): Promise<ForgeReadiness> {
    try {
      const output = await this.gh(['auth', 'status', '--hostname', host], signal)
      if (output.exitCode === 0) return { state: 'ready', message: null }
      return { state: 'unauthenticated', message: firstLine(output.stderr) ?? firstLine(output.stdout) ?? `gh is not signed in to ${host}` }
    } catch (error) {
      if (error instanceof GhUnavailableError) return { state: 'unavailable', message: error.message }
      throw error
    }
  }

  /** Run one changing `gh` command; a refusal or a `gh` that cannot start becomes a failure. */
  private async act(args: readonly string[], signal: AbortSignal): Promise<ForgeActionFailure | undefined> {
    let output
    try {
      output = await this.gh(args, signal)
    } catch (error) {
      if (error instanceof GhUnavailableError) return { code: 'failed', message: error.message }
      throw error
    }
    if (output.exitCode === 0) return undefined
    const message = hostMessage(output.stdout) ?? firstLine(output.stderr) ?? `gh exited with ${output.exitCode}`
    const status = HTTP_STATUS.exec(output.stderr)?.[1]
    if (status === '409') return { code: 'stale', message }
    if (AUTHENTICATION.test(output.stderr)) return { code: 'unauthenticated', message }
    return { code: 'failed', message }
  }

  private async fetchHost(
    host: string,
    refs: readonly ChangeRequestRef[],
    signal: AbortSignal,
  ): Promise<ReadonlyMap<ChangeRequestKey, ChangeRequestSnapshot | ForgeFailure>> {
    const query = snapshotQuery(refs)
    const output = await this.gh(['api', 'graphql', '--hostname', host, '-f', `query=${query.document}`], signal)
    const body = parseJson(output.stdout)
    if (body !== undefined) return mapSnapshotResponse(body, query)
    const failure: ForgeFailure = {
      code: AUTHENTICATION.test(output.stderr) ? 'unauthenticated' : 'unavailable',
      message: firstLine(output.stderr) ?? `gh exited with ${output.exitCode}`,
    }
    return new Map([...query.targets.values()].map(ref => [changeRequestKey(ref), failure] as const))
  }
}

/** The `message` of the JSON error body `gh api` prints for a failed request. */
function hostMessage(stdout: string): string | undefined {
  const body = parseJson(stdout)
  if (typeof body !== 'object' || body === null || !('message' in body) || typeof body.message !== 'string') return undefined
  return body.message.trim().length > 0 ? body.message : undefined
}

function parseJson(text: string): unknown {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    void error // gh prints diagnostics instead of JSON when a request fails before GitHub answers.
    return undefined
  }
  return value
}

function firstLine(text: string): string | undefined {
  return text.split('\n').map(line => line.trim()).find(line => line.length > 0)
}

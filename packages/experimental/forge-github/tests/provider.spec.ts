import { changeRequestKey } from '@deepseek-ai/dsh-experimental-forge'
import { describe, expect, it } from 'vitest'
import type { GhOutput, GhRunner } from '../src/gh.ts'
import { GitHubProvider } from '../src/provider.ts'
import { demo, pull, pullRequestNode } from './fixtures.ts'

const enterprise = { forge: 'github', host: 'ghe.corp.example', owner: 'team', name: 'svc' }
const signal = new AbortController().signal

function fakeGh(handler: (args: readonly string[]) => GhOutput | Promise<GhOutput>): { run: GhRunner; calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    run: async (args) => {
      calls.push([...args])
      return await handler(args)
    },
  }
}

function output(stdout: unknown, exitCode = 0, stderr = ''): GhOutput {
  return { exitCode, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr }
}

function provider(run: GhRunner): GitHubProvider {
  return new GitHubProvider(run, ['github.com', 'GHE.corp.example'])
}

describe('GitHub provider addressing', () => {
  const subject = provider(fakeGh(() => output('')).run)

  it('serves remotes and pull request URLs on configured hosts only', () => {
    expect(subject.repositoryFromRemote('git@github.com:octo/demo.git')).toEqual(demo)
    expect(subject.repositoryFromRemote('https://ghe.corp.example/team/svc')).toEqual(enterprise)
    expect(subject.repositoryFromRemote('https://gitlab.com/octo/demo')).toBeUndefined()
    expect(subject.repositoryFromRemote('/local/repo')).toBeUndefined()
    expect(subject.changeRequestFromUrl('https://github.com/octo/demo/pull/4')).toEqual(pull(4))
    expect(subject.changeRequestFromUrl('https://gitlab.com/octo/demo/pull/4')).toBeUndefined()
    expect(subject.changeRequestFromUrl('https://github.com/octo/demo/issues/4')).toBeUndefined()
  })

  it('builds canonical pull request URLs', () => {
    expect(subject.changeRequestUrl(pull(4, enterprise))).toBe('https://ghe.corp.example/team/svc/pull/4')
  })
})

describe('GitHub provider fetch', () => {
  it('rejects unconfigured hosts without querying them and still fetches allowed hosts', async () => {
    const gh = fakeGh(() => output({ data: { r0: { p0: pullRequestNode(1) } } }))
    const denied = pull(2, { ...enterprise, host: 'unconfigured.example' })
    const results = await provider(gh.run).fetch([denied, pull(1)], signal)
    expect(gh.calls.map(call => call[3])).toEqual(['github.com'])
    expect(results.get(changeRequestKey(denied))).toEqual({ code: 'unavailable', message: 'forge-github: host "unconfigured.example" is not configured' })
    expect(results.get(changeRequestKey(pull(1)))).toMatchObject({ title: 'Change 1' })
  })

  it('rejects references retained after their host was removed from configuration', async () => {
    const gh = fakeGh(() => output(''))
    const retained = provider(gh.run).changeRequestFromUrl('https://ghe.corp.example/team/svc/pull/2')!
    const replacement = new GitHubProvider(gh.run, ['github.com'])
    const results = await replacement.fetch([retained], signal)
    await expect(replacement.findByHead(retained.repository, 'topic', signal)).rejects.toThrow('is not configured')
    expect(results.get(changeRequestKey(retained))).toMatchObject({ code: 'unavailable' })
    expect(gh.calls).toEqual([])
  })

  it('runs one GraphQL request per host and merges the results', async () => {
    const gh = fakeGh((args) => {
      const host = args[3]
      return output({ data: { r0: { p0: pullRequestNode(host === 'github.com' ? 1 : 2) } } })
    })

    const results = await provider(gh.run).fetch([pull(1), pull(2, enterprise)], signal)

    expect(gh.calls.map(call => call.slice(0, 5))).toEqual([
      ['api', 'graphql', '--hostname', 'github.com', '-f'],
      ['api', 'graphql', '--hostname', 'ghe.corp.example', '-f'],
    ])
    expect(gh.calls[0]?.[5]).toMatch(/^query=query \{ r0: repository\(owner: "octo", name: "demo"\)/)
    expect(results.get(changeRequestKey(pull(1)))).toMatchObject({ title: 'Change 1' })
    expect(results.get(changeRequestKey(pull(2, enterprise)))).toMatchObject({ title: 'Change 2' })
  })

  it('maps the JSON of a partial-error response that exits with 1', async () => {
    const gh = fakeGh(() => output({
      data: { r0: { p0: null } },
      errors: [{ type: 'NOT_FOUND', path: ['r0', 'p0'], message: 'Could not resolve to a PullRequest with the number of 1.' }],
    }, 1, 'gh: Could not resolve to a PullRequest with the number of 1.'))

    const results = await provider(gh.run).fetch([pull(1)], signal)

    expect(results.get(changeRequestKey(pull(1)))).toEqual({ code: 'not-found', message: 'Could not resolve to a PullRequest with the number of 1.' })
  })

  it.each([
    ['To get started with GitHub CLI, please run:  gh auth login', 'unauthenticated'],
    ['HTTP 401: Bad credentials (https://api.github.com/graphql)', 'unauthenticated'],
    ['error connecting to api.github.com', 'unavailable'],
  ])('classifies a failure without JSON: %s', async (stderr, code) => {
    const gh = fakeGh(() => output('', 1, `\n${stderr}\n`))

    const results = await provider(gh.run).fetch([pull(1), pull(2)], signal)

    expect([...results.values()]).toEqual([{ code, message: stderr }, { code, message: stderr }])
  })

  it('names the exit code when gh prints nothing', async () => {
    const results = await provider(fakeGh(() => output('', 4)).run).fetch([pull(1)], signal)

    expect(results.get(changeRequestKey(pull(1)))).toEqual({ code: 'unavailable', message: 'gh exited with 4' })
  })

  it('propagates a runner rejection', async () => {
    const subject = provider(async () => {
      throw new Error('aborted')
    })

    await expect(subject.fetch([pull(1)], signal)).rejects.toThrow('aborted')
  })
})

describe('GitHub provider head branch lookup', () => {
  it('passes the repository and branch as GraphQL variables', async () => {
    const gh = fakeGh(() => output({ data: { repository: { defaultBranchRef: { name: 'master' }, pullRequests: { nodes: [{ number: 5, isCrossRepository: false }] } } } }))

    await expect(provider(gh.run).findByHead(demo, 'topic', signal)).resolves.toEqual([pull(5)])
    expect(gh.calls[0]?.slice(0, 4)).toEqual(['api', 'graphql', '--hostname', 'github.com'])
    expect(gh.calls[0]?.slice(6)).toEqual(['-f', 'owner=octo', '-f', 'name=demo', '-f', 'branch=topic'])
  })

  it('reports gh diagnostics when the lookup prints no JSON', async () => {
    await expect(provider(fakeGh(() => output('', 1, 'HTTP 502')).run).findByHead(demo, 'topic', signal))
      .rejects.toThrow('forge-github: head branch lookup failed: HTTP 502')
    await expect(provider(fakeGh(() => output('', 2)).run).findByHead(demo, 'topic', signal))
      .rejects.toThrow('forge-github: head branch lookup failed: gh exited with 2')
  })
})

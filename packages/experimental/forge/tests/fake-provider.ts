import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import ForgeService, { changeRequestKey } from '../src/index.ts'
import type { Config } from '../src/index.ts'
import type {
  ChangeRequestKey, ChangeRequestRef, ChangeRequestSnapshot, ForgeFailure, ForgeProvider, ForgeRepository,
} from '../src/types.ts'

type FetchResult = ReadonlyMap<ChangeRequestKey, ChangeRequestSnapshot | ForgeFailure>

/** Repository served by the default fake provider. */
export const demo: ForgeRepository = { forge: 'fake', host: 'fake.test', owner: 'Octo', name: 'Demo' }

/** Build a change request reference in `demo` or another repository. */
export function ref(number: number, repository: ForgeRepository = demo): ChangeRequestRef {
  return { repository, number }
}

/** Build an open, mergeable snapshot whose checks passed. */
export function snapshot(target: ChangeRequestRef, overrides: Partial<ChangeRequestSnapshot> = {}): ChangeRequestSnapshot {
  return {
    ref: target,
    url: `https://${target.repository.host}/${target.repository.owner}/${target.repository.name}/change/${target.number}`,
    title: `Change ${target.number}`,
    state: 'open',
    draft: false,
    author: 'octo',
    headBranch: 'topic',
    headSha: 'a'.repeat(40),
    baseBranch: 'main',
    mergeability: 'mergeable',
    reviewDecision: 'none',
    checks: [],
    checksRollup: 'success',
    checksTruncated: false,
    unresolvedThreads: 0,
    updatedAt: '2026-10-09T00:00:00Z',
    ...overrides,
  }
}

/** A scripted provider that records every call. */
export class FakeProvider implements ForgeProvider {
  readonly forge: string
  readonly fetches: (readonly ChangeRequestRef[])[] = []
  readonly signals: AbortSignal[] = []
  readonly results = new Map<ChangeRequestKey, ChangeRequestSnapshot | ForgeFailure>()
  readonly heads = new Map<string, readonly ChangeRequestRef[]>()
  fetchImpl: ((refs: readonly ChangeRequestRef[], signal: AbortSignal) => Promise<FetchResult>) | undefined

  constructor(forge = 'fake') {
    this.forge = forge
  }

  repositoryFromRemote(url: string): ForgeRepository | undefined {
    const match = /^fake:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url)
    if (match === null) return undefined
    const [, host = '', owner = '', name = ''] = match
    return { forge: this.forge, host, owner, name }
  }

  changeRequestFromUrl(url: string): ChangeRequestRef | undefined {
    const match = /^https:\/\/([^/]+)\/([^/]+)\/([^/]+)\/change\/(\d+)$/.exec(url)
    if (match === null) return undefined
    const [, host = '', owner = '', name = '', number = '0'] = match
    return { repository: { forge: this.forge, host, owner, name }, number: Number(number) }
  }

  changeRequestUrl(target: ChangeRequestRef): string {
    return `https://${target.repository.host}/${target.repository.owner}/${target.repository.name}/change/${target.number}`
  }

  async fetch(refs: readonly ChangeRequestRef[], signal: AbortSignal): Promise<FetchResult> {
    this.fetches.push(refs)
    this.signals.push(signal)
    if (this.fetchImpl !== undefined) return await this.fetchImpl(refs, signal)
    return new Map(refs.map((target) => {
      const key = changeRequestKey(target)
      return [key, this.results.get(key) ?? { code: 'not-found', message: 'missing' }] as const
    }))
  }

  async findByHead(repository: ForgeRepository, branch: string): Promise<readonly ChangeRequestRef[]> {
    return this.heads.get(`${repository.owner}/${repository.name}:${branch}`) ?? []
  }

}

/** Boot a context with only the forge service. */
export async function forgeContext(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ForgeService, config)
  return ctx
}

/** Register `provider` from its own plugin fiber, returning that fiber. */
export async function provide(ctx: Context, provider: ForgeProvider): Promise<Fiber> {
  const fiber = ctx.plugin({
    inject: ['forge'],
    apply(child: Context) {
      child.forge.register(provider)
    },
  })
  await fiber
  return fiber
}

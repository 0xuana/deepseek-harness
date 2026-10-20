import type { ChangeRequestRef, ForgeRepository } from '@deepseek-ai/dsh-experimental-forge'

/** Repository on github.com used across the provider tests. */
export const demo: ForgeRepository = { forge: 'github', host: 'github.com', owner: 'octo', name: 'demo' }

/** Build a pull request reference in `demo` or another repository. */
export function pull(number: number, repository: ForgeRepository = demo): ChangeRequestRef {
  return { repository, number }
}

/** One CheckRun context node as GitHub returns it. */
export function checkRun(name: string, status: string, conclusion: string | null, workflow: string | null = 'ci'): Record<string, unknown> {
  return {
    __typename: 'CheckRun',
    name,
    status,
    conclusion,
    detailsUrl: `https://github.com/octo/demo/actions/runs/1/job/${name}`,
    checkSuite: workflow === null ? { workflowRun: null } : { workflowRun: { workflow: { name: workflow } } },
  }
}

/** One StatusContext node as GitHub returns it. */
export function statusContext(context: string, state: string): Record<string, unknown> {
  return { __typename: 'StatusContext', context, state, targetUrl: null }
}

/** A pull request node with the fields the snapshot query selects. */
export function pullRequestNode(number: number, overrides: Record<string, unknown> = {}, contexts: unknown[] = [], rollupState: string | null = 'SUCCESS'): Record<string, unknown> {
  return {
    number,
    url: `https://github.com/octo/demo/pull/${number}`,
    title: `Change ${number}`,
    state: 'OPEN',
    isDraft: false,
    updatedAt: '2026-10-09T01:02:03Z',
    author: { login: 'octo' },
    headRefName: `topic-${number}`,
    headRefOid: 'f'.repeat(40),
    baseRefName: 'master',
    mergeable: 'MERGEABLE',
    reviewDecision: null,
    reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }, { isResolved: false }] },
    commits: {
      nodes: [{
        commit: {
          statusCheckRollup: rollupState === null ? null : {
            state: rollupState,
            contexts: { pageInfo: { hasNextPage: false }, nodes: contexts },
          },
        },
      }],
    },
    ...overrides,
  }
}

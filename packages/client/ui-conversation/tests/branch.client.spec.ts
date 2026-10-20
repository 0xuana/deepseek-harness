/** What one refused branch states, on the Session it was asked of. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { noteBranchRefusal, readForkRefusal } from '../src/client/branch.ts'

const CHILD = 'child' as SessionId

/**
 * Build a root context whose Session face is the reduced one these helpers use.
 * @param options - What the addressed Session's scope carries.
 * @returns The context and the notice spy.
 */
function bench(options: {
  readonly scope?: 'composer' | 'no-composer' | 'absent'
}) {
  const ctx = new Context()
  const notify = vi.fn()
  const scope = options.scope ?? 'composer'
  ctx.provide('sessions', {
    scope: () => (scope === 'absent' ? undefined : {
      get: (name: string) => (scope === 'composer' && name === 'conversation'
        ? { input: { for: () => ({ notify }) } }
        : undefined),
    }),
  } as never)
  return { ctx, notify }
}

describe('readForkRefusal', () => {
  it('reads the code and message a rejection carries, wherever it carries them', () => {
    expect(readForkRefusal({ rpcError: { code: 'fork-not-permitted', message: 'not allowed' } }))
      .toEqual({ code: 'fork-not-permitted', message: 'not allowed' })
    expect(readForkRefusal(Object.assign(new Error('refused'), { code: 'share-stopped' })))
      .toEqual({ code: 'share-stopped', message: 'refused' })
  })

  it('survives a rejection that carries no object at all', () => {
    for (const rejection of [null, undefined, 42, {}]) {
      expect(readForkRefusal(rejection)).toEqual({ code: 'unknown', message: '' })
    }
    expect(readForkRefusal({ rpcError: null, message: 'plain' }))
      .toEqual({ code: 'unknown', message: 'plain' })
  })

  it('names the placeholder code only when the rejection named none', () => {
    expect(readForkRefusal(new Error('fork failed'))).toEqual({ code: 'unknown', message: 'fork failed' })
    expect(readForkRefusal('a rejection that is not an object')).toEqual({ code: 'unknown', message: '' })
    // An empty code or message is the same as an absent one: the helper never states a blank.
    expect(readForkRefusal({ code: '', rpcError: { code: '', message: '' } }))
      .toEqual({ code: 'unknown', message: '' })
  })
})

describe('noteBranchRefusal', () => {
  it('states the Host\'s message with its stable code', () => {
    const b = bench({})
    noteBranchRefusal(
      b.ctx, CHILD, { code: 'boundary-not-committed', message: 'boundary is not committed' },
      reason => `未能完成分支：${reason}`,
    )
    expect(b.notify).toHaveBeenLastCalledWith('error', '未能完成分支：boundary is not committed (boundary-not-committed)')
  })

  it('states the placeholder code without throwing when the rejection is not an object', () => {
    const b = bench({})
    noteBranchRefusal(b.ctx, CHILD, undefined, reason => `未能完成分支：${reason}`)
    expect(b.notify).toHaveBeenLastCalledWith('error', '未能完成分支：unknown')
  })

  it('states the code alone when the rejection carried no message of its own', () => {
    const b = bench({})
    noteBranchRefusal(b.ctx, CHILD, { code: 'share-expired' }, reason => `未能完成分支：${reason}`)
    expect(b.notify).toHaveBeenLastCalledWith('error', '未能完成分支：share-expired')
  })

  it('says nothing when the Session it was asked of has no composer to state it on', () => {
    const absent = bench({ scope: 'absent' })
    noteBranchRefusal(absent.ctx, CHILD, { code: 'share-stopped' }, reason => reason)
    expect(absent.notify).not.toHaveBeenCalled()
    // A scope without the Conversation face is the same silence, reached without a throw.
    const bare = bench({ scope: 'no-composer' })
    noteBranchRefusal(bare.ctx, CHILD, { code: 'share-stopped' }, reason => reason)
    expect(bare.notify).not.toHaveBeenCalled()
  })
})

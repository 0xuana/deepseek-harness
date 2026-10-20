/**
 * Session Controller under non-owner callers: the Session resource kind it
 * registers, the Session readers of `session/page` and `session/follow`,
 * `session/list`, `session/search`, and `session/control` called through a
 * `global` role and filtered per Session through `remoteAccess.allows()`, the caller recorded
 * on prompt sources, and `session/projections` admitted per Session through
 * the Gateway.
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  mountAgentLoopTestDependencies, mountAgentLoopTestHarness, type AgentLoopTestHarness,
} from '@deepseek-ai/dsh-agent-loop-testkit'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import type { RemoteAccessBinding, RemoteAccessRole } from '@deepseek-ai/dsh-api-remote-access'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { remoteMethods, type PeerId, type PeerScope, type Principal, type RemoteInvocation } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type SessionController from '../src/index.ts'
import { ApiSessionList } from '../src/list.ts'
import type {
  SessionControlFrame, SessionPromptRequest, SessionRequestId, SessionSearchValue,
} from '../src/types.ts'
import { createSessionTestController } from './test-remote.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    /** Test-only non-owner caller shared by the access specs. */
    'test-guest': { readonly kind: 'test-guest'; readonly guest: string }
  }
}

const OWNER: Principal = { kind: 'owner' }
const GUEST: Principal = { kind: 'test-guest', guest: 'session-controller' }
const SHARED = SessionId('shared-session')
const PRIVATE = SessionId('private-session')

/** Calls the Session list and control methods; each item still needs a Session role. */
const LISTER: RemoteAccessRole<'global'> = { name: 'test:session-lister', resource: 'global', actions: ['session/list', 'session/control'] }
/** Reads one Session: its list row, its control projections, and its stored projections. */
const READER: RemoteAccessRole<'session'> = {
  name: 'test:session-reader', resource: 'session', actions: ['session/list', 'session/control', 'session/projections'],
}
const LIST_CALLS: RemoteAccessBinding = { role: LISTER, resource: { kind: 'global' } }
const READS_SHARED: RemoteAccessBinding = { role: READER, resource: { kind: 'session', id: SHARED } }
/** Drives one shared Session: prompts it and cancels its turn. */
const DRIVES_SHARED: RemoteAccessBinding = {
  role: { name: 'test:session-driver', resource: 'session', actions: ['session/prompt', 'session/cancel'] },
  resource: { kind: 'session', id: SHARED },
}
const SEARCH_CALLS: RemoteAccessBinding = {
  role: { name: 'test:session-searcher', resource: 'global', actions: ['session/search'] },
  resource: { kind: 'global' },
}
const SEARCHES_SHARED: RemoteAccessBinding = {
  role: { name: 'test:session-search-reader', resource: 'session', actions: ['session/search'] },
  resource: { kind: 'session', id: SHARED },
}

const owned = new Set<Context>()
afterEach(async () => {
  await Promise.all([...owned].map(ctx => ctx.fiber.dispose()))
  owned.clear()
})

/**
 * Register the guest policy.
 * @returns the bindings the policy answers with; edits apply from the next Remote call.
 */
function guestPolicy(ctx: Context, ...bindings: RemoteAccessBinding[]): RemoteAccessBinding[] {
  const held = [...bindings]
  ctx.remoteAccess.registerPolicy('test-guest', { bindings: () => held })
  return held
}

/** Invoke `session/<method>` as the guest through the Gateway. */
function guestCall(ctx: Context, method: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
  const peer: PeerScope = { id: 'session-access-peer' as PeerId, ctx, principal: GUEST, interactions: 'answer', signal: new AbortController().signal, dispose: async () => {} }
  return ctx.typertGateway.invoke({ peer, namespace: 'session', method, args })
}

async function harness(): Promise<{
  readonly ctx: Context
  readonly controller: SessionController
  readonly shared: Agent
  readonly hidden: Agent
  /** Admit pending input through the production loop driver, as a running turn would. */
  readonly claim: AgentLoopTestHarness['claim']
  /** The Context a Gateway dispatch of `session/<method>` binds for `principal`. */
  readonly as: (principal: Principal, method: string) => Context
}> {
  const ctx = new Context()
  owned.add(ctx)
  await ctx.plugin(TypertRegistry)
  await mountAgentLoopTestDependencies(ctx)
  const loop = await mountAgentLoopTestHarness(ctx)
  const shared = await loop.create(SHARED)
  const hidden = await loop.create(PRIVATE)
  const controller = await createSessionTestController(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
  const as = (principal: Principal, method: string): Context => {
    const invocation: RemoteInvocation = {
      request: { namespace: 'session', method, args: {} },
      service: 'sessionController',
      peer: { id: 'session-access-peer' as PeerId, ctx, principal, interactions: 'answer', signal: new AbortController().signal, dispose: async () => {} },
      signal: new AbortController().signal,
      uplink: <In>(): AsyncIterable<In> => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) }),
    }
    return ctx.extend({ invocation })
  }
  return { ctx, controller, shared, hidden, claim: (...args: Parameters<typeof loop.claim>) => loop.claim(...args), as }
}

function message(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/**
 * One queued prompt from a caller: the request identity is the whole difference between retries.
 * @param requestId - repeated request identity.
 * @returns the prompt request.
 */
function promptRequest(requestId: string): SessionPromptRequest {
  return {
    sessionId: SHARED,
    requestId: requestId as SessionRequestId,
    mode: 'queue',
    content: [{ type: 'text', text: requestId }],
  }
}

/**
 * Durable messages one request identity delivered into a Session's inbox splices.
 * @param agent - Session whose durable log is read.
 * @param requestId - repeated request identity.
 * @returns the matching user messages.
 */
function deliveredFor(agent: Agent, requestId: string) {
  return agent.session.snapshotEvents()
    .flatMap(event => event.type === 'agent/inbox/spliced' ? event.data.inserted : [])
    .filter(message => message.source.kind === 'user'
      && 'rpcId' in message.source && message.source.rpcId === requestId)
}

describe('Session Controller access', () => {
  it('owns the Session resource kind and its default sessionId field', async () => {
    const { ctx } = await harness()
    expect(() => ctx.typert.resources.register('session', { field: 'sessionId' })).toThrow(/already registered/)
  })

  it('reads the Session resource of page and follow requests from the addressed Session', async () => {
    const { controller } = await harness()
    for (const method of ['page', 'follow']) {
      const reader = remoteMethods(controller).find(marker => marker.method === method)?.resources?.['session']
      expect(reader?.({ address: { kind: 'session', sessionId: SHARED } })).toBe(SHARED)
      // A subagent address reads the child transcript; whether the parent's access covers it is the policy's rule.
      expect(reader?.({ address: { kind: 'subagent', parentSessionId: SHARED, childSessionId: PRIVATE } })).toBe(PRIVATE)
    }
  })

  it('lets a global role call session/list and lists only the Sessions a Session role admits', async () => {
    const { ctx, as } = await harness()
    await ctx.plugin(TypertGatewayService)
    const held = guestPolicy(ctx, LIST_CALLS, READS_SHARED)
    const rows = async (): Promise<SessionId[]> => {
      const value = await guestCall(ctx, 'list', { _request: {} }) as { readonly items: readonly { readonly sessionId: SessionId }[] }
      return value.items.map(item => item.sessionId)
    }
    await expect(rows()).resolves.toEqual([SHARED])
    // The global role admits the call, not any row.
    held.splice(0, held.length, LIST_CALLS)
    await expect(rows()).resolves.toEqual([])
    // A Session role alone does not admit the call: the global resource does not inherit from it.
    held.splice(0, held.length, READS_SHARED)
    await expect(rows()).rejects.toMatchObject({
      code: 'remote-access/denied', details: { action: 'session/list', reason: 'no-allow' },
    })
    const owner = await as(OWNER, 'list').sessionController.list({}, new AbortController().signal)
    expect(owner.items.map(item => item.sessionId).sort()).toEqual([PRIVATE, SHARED].sort())
  })

  it('returns a non-owner only the session/search hits whose Session a Session role admits', async () => {
    const { ctx, as } = await harness()
    await ctx.plugin(TypertGatewayService)
    guestPolicy(ctx, SEARCH_CALLS, SEARCHES_SHARED)
    const hits: SessionSearchValue = {
      items: [{ sessionId: PRIVATE, snippet: 'private hit' }, { sessionId: SHARED, snippet: 'shared hit' }],
      hasMore: true,
    }
    vi.spyOn(ApiSessionList.prototype, 'search').mockResolvedValue(hits)
    await expect(guestCall(ctx, 'search', { request: { query: 'hit' } })).resolves.toEqual({
      items: [{ sessionId: SHARED, snippet: 'shared hit' }],
      hasMore: true,
    })
    await expect(as(OWNER, 'search').sessionController.search({ query: 'hit' }, new AbortController().signal)).resolves.toEqual(hits)
  })

  it('filters session/control baselines and projection frames for a non-owner', async () => {
    const { ctx, shared, hidden, as } = await harness()
    guestPolicy(ctx, LIST_CALLS, READS_SHARED)
    const abort = new AbortController()
    const guest = as(GUEST, 'control').sessionController.control(abort.signal)[Symbol.asyncIterator]()
    const owner = as(OWNER, 'control').sessionController.control(abort.signal)[Symbol.asyncIterator]()
    const baselineSessions = async (iterator: AsyncIterator<SessionControlFrame>): Promise<string[]> => {
      const next = await iterator.next()
      if (next.done === true || next.value.type !== 'baseline') throw new Error('control stream opened without a baseline')
      return Object.keys(next.value.value.projections).sort()
    }
    expect(await baselineSessions(guest)).toEqual([SHARED])
    expect(await baselineSessions(owner)).toEqual([PRIVATE, SHARED].sort())

    hidden.inbox.append('next-turn', message('private work'))
    shared.inbox.append('next-turn', message('shared work'))
    const projected = async (iterator: AsyncIterator<SessionControlFrame>): Promise<SessionId> => {
      for (;;) {
        const next = await iterator.next()
        if (next.done === true) throw new Error('control stream ended')
        if (next.value.type === 'projection' && next.value.key === 'inbox') return next.value.sessionId
      }
    }
    // The owner sees the private Session's frame first; the guest's first Inbox frame is the shared one.
    expect(await projected(owner)).toBe(PRIVATE)
    expect(await projected(guest)).toBe(SHARED)
    abort.abort()
    await Promise.all([guest.return?.(), owner.return?.()])
  })

  it('records a non-owner caller on the prompt source and leaves owner sources unchanged', async () => {
    const { ctx, shared, as } = await harness()
    guestPolicy(ctx, DRIVES_SHARED)
    const signal = new AbortController().signal
    const prompt = (principal: Principal, requestId: string) => as(principal, 'prompt').sessionController.prompt({
      sessionId: SHARED,
      requestId: requestId as SessionRequestId,
      mode: 'queue',
      content: [{ type: 'text', text: `from ${principal.kind}` }],
    }, signal)
    await expect(prompt(GUEST, 'guest-1')).resolves.toEqual({ accepted: true })
    await expect(prompt(OWNER, 'owner-1')).resolves.toEqual({ accepted: true })
    // The durable Inbox splice records each accepted message with its source.
    const logged = shared.session.snapshotEvents()
      .flatMap(event => event.type === 'agent/inbox/spliced' ? event.data.inserted.map(item => item.source) : [])
    expect(logged).toEqual([
      { kind: 'user', rpcId: 'guest-1', principal: GUEST },
      { kind: 'user', rpcId: 'owner-1' },
    ])
  })

  it('refuses a prompt whose Session grant is withdrawn during admission', async () => {
    const { shared, as } = await harness()
    // The Gateway admitted the call earlier; the controller re-reads the caller's grant after every
    // await and immediately before delivery, so a share narrowed meanwhile must not deliver.
    const signal = new AbortController().signal
    await expect(as(GUEST, 'prompt').sessionController.prompt(promptRequest('withdrawn-1'), signal))
      .rejects.toMatchObject({
        code: 'remote-access/denied',
        details: { action: 'session/prompt', reason: 'access-withdrawn' },
      })
    expect(shared.inbox.nextTurn).toEqual([])
  })

  it('cancels admission when the caller aborts after the prompt was admitted', async () => {
    const { ctx, shared, as } = await harness()
    guestPolicy(ctx, DRIVES_SHARED)
    const attachments = ctx.attachments
    const admit = attachments.admitPromptContent.bind(attachments)
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const admitted = vi.spyOn(attachments, 'admitPromptContent').mockImplementationOnce(async (content) => {
      await held
      return admit(content)
    })
    const abort = new AbortController()
    const pending = as(GUEST, 'prompt').sessionController.prompt(promptRequest('aborted-1'), abort.signal)
    await vi.waitFor(() => { expect(admitted).toHaveBeenCalledOnce() })
    abort.abort()
    release()
    await expect(pending).rejects.toMatchObject({ code: 'gateway/cancelled' })
    expect(shared.inbox.nextTurn).toEqual([])
  })

  it('shares one in-flight admission and refuses a duplicate requestId from another caller', async () => {
    const { ctx, shared, as } = await harness()
    guestPolicy(ctx, DRIVES_SHARED)
    const attachments = ctx.attachments
    const admit = attachments.admitPromptContent.bind(attachments)
    const gates: (() => void)[] = []
    vi.spyOn(attachments, 'admitPromptContent').mockImplementation(async (content) => {
      await new Promise<void>((resolve) => { gates.push(resolve) })
      return admit(content)
    })
    const signal = new AbortController().signal

    // A duplicate from the same caller arrives while the first admission is in flight: it shares that
    // admission instead of starting a second one.
    const first = as(GUEST, 'prompt').sessionController.prompt(promptRequest('inflight-shared'), signal)
    await vi.waitFor(() => { expect(gates).toHaveLength(1) })
    const duplicate = as(GUEST, 'prompt').sessionController.prompt(promptRequest('inflight-shared'), signal)
    await vi.waitFor(() => { expect(gates).toHaveLength(1) })
    gates[0]?.()
    await expect(first).resolves.toEqual({ accepted: true })
    await expect(duplicate).resolves.toEqual({ accepted: true })
    expect(deliveredFor(shared, 'inflight-shared')).toHaveLength(1)

    // A duplicate from another caller while that admission is still pending is a conflict.
    const other = as(OWNER, 'prompt').sessionController.prompt(promptRequest('inflight-conflict'), signal)
    await vi.waitFor(() => { expect(gates).toHaveLength(2) })
    await expect(as(GUEST, 'prompt').sessionController.prompt(promptRequest('inflight-conflict'), signal))
      .rejects.toMatchObject({
        code: 'session/request-conflict',
        details: { requestId: 'inflight-conflict' },
      })
    gates[1]?.()
    await expect(other).resolves.toEqual({ accepted: true })
  })

  it('reads a retried requestId from the drained splice and refuses it from another caller', async () => {
    const { ctx, shared, as, claim } = await harness()
    guestPolicy(ctx, DRIVES_SHARED)
    const signal = new AbortController().signal

    await expect(as(GUEST, 'prompt').sessionController.prompt(promptRequest('retried-1'), signal))
      .resolves.toEqual({ accepted: true })
    // Drain the pending input as a running turn would: the requestId now lives only in the durable splice.
    claim(shared, 'next-turn', 1)
    expect(shared.inbox.nextTurn).toEqual([])
    // The same caller's retry reads the accepted message back from that splice.
    await expect(as(GUEST, 'prompt').sessionController.prompt(promptRequest('retried-1'), signal))
      .resolves.toEqual({ accepted: true })
    // Another caller repeating the identity is refused as a conflict, with no second delivery.
    await expect(as(OWNER, 'prompt').sessionController.prompt(promptRequest('retried-1'), signal))
      .rejects.toMatchObject({
        code: 'session/request-conflict',
        details: { requestId: 'retried-1' },
      })
    expect(deliveredFor(shared, 'retried-1')).toHaveLength(1)
  })

  it('refuses cancellation once the caller no longer holds the Session', async () => {
    const { ctx, as } = await harness()
    // The call still reaches the controller; the Session role the page holds no longer admits cancel.
    guestPolicy(ctx, READS_SHARED)
    let failure: unknown
    try {
      as(GUEST, 'cancel').sessionController.cancel({ sessionId: SHARED })
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({
      code: 'remote-access/denied',
      details: { action: 'session/cancel', reason: 'access-withdrawn' },
    })
  })

  it('lets a non-owner read projections only in a Session its Session role names', async () => {
    const { ctx } = await harness()
    await ctx.plugin(TypertGatewayService)
    guestPolicy(ctx, READS_SHARED)
    const projections = (sessionId: SessionId): Promise<unknown> => guestCall(ctx, 'projections', { request: { sessionId } })
    await expect(projections(SHARED)).resolves.toMatchObject({ kind: 'sequenced' })
    await expect(projections(PRIVATE)).rejects.toMatchObject({
      code: 'remote-access/denied', details: { action: 'session/projections', reason: 'no-allow' },
    })
  })
})

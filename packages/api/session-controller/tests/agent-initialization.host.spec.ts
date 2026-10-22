/** Web operations join the original Agent setup while history remains readable. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionTitle from '@deepseek-ai/dsh-session-title'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { SessionRequestId } from '../src/types.ts'
import { createSessionTestController, createSessionTestRemote } from './test-remote.ts'

const seed: SessionEvent[] = [
  { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
  { type: 'turn/end', seq: SessionSeq(1), time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
]

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-readiness-'))
  const ctx = new Context()
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlPersistence, { root })
  await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(SessionTitle, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 })
  ctx.provide('workspaceRegistry', { get: () => undefined, list: () => [], archivedSessionIds: [] } as never)
  ctx.on('agent/pre-step', async () => ({ kind: 'reject' }))
  const defaults = { defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture' }), cwd: root }
  const api = ctx.plugin({
    inject: ['agents', 'sessions', 'sessionProjections', 'llm', 'workspaceRegistry', 'sessionPersistence', 'sessionTitle'],
    apply() {},
  })
  await api
  const controller = await createSessionTestController(api.ctx, defaults)
  const remote = await createSessionTestRemote(api.ctx, defaults)
  return { ctx, root, controller, remote, api }
}

describe('Web Agent initialization', () => {
  it.each(['create', 'resume'] as const)('keeps %s history readable and joins setup for mutations', async (mode) => {
    const { ctx, root, controller, remote } = await harness()
    const sessionId = SessionId('initializing')
    if (mode === 'resume') {
      const previous = await ctx.agents.create({ sessionId, meta: { cwd: root }, seed })
      await previous.dispose()
    }
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const setup = async (): Promise<void> => { entered.resolve(undefined); await release.promise }
    const creation = mode === 'create'
      ? ctx.agents.create({ sessionId, meta: { cwd: root }, seed, setup })
      : ctx.agents.resume({ resumeSessionId: sessionId, setup })
    onTestFinished(async () => { release.resolve(undefined); await creation })
    await entered.promise
    const resume = vi.spyOn(ctx.agents, 'resume')
    const abort = new AbortController()
    const iterator = controller.follow({ address: { kind: 'session', sessionId } }, abort.signal)
      [Symbol.asyncIterator]()
    try {
      expect(ctx.sessions.get(sessionId)).toBeDefined()
      expect(ctx.agents.get(sessionId)).toBeUndefined()
      expect((await controller.list({}, abort.signal)).items.find(item => item.sessionId === sessionId))
        .toMatchObject({ blank: false, agentAvailable: false })
      const snapshot = await iterator.next()
      if (snapshot.done || snapshot.value.type !== 'snapshot') throw new Error('missing history snapshot')
      expect(snapshot.value.records.slice(0, 2).map(record => record.event)).toEqual(seed)
      const resolved = controller.resolveAgent(sessionId)
      const renamed = remote.rename({ sessionId, title: 'Ready title' })
      const prompted = remote.prompt({
        requestId: 'ready-prompt' as SessionRequestId, sessionId, mode: 'queue',
        content: [{ type: 'text', text: 'hello' }], clientTimeZone: 'UTC',
      })
      release.resolve(undefined)
      const handle = await creation
      const resolution = await resolved
      expect('agent' in resolution && resolution.agent).toBe(handle.agent)
      await expect(renamed).resolves.toMatchObject({ ok: true, value: { title: 'Ready title' } })
      await expect(prompted).resolves.toMatchObject({ ok: true })
      expect(resume).not.toHaveBeenCalled()
      await ctx.sessions.flush(handle.agent.session)
      await using stored = await ctx.sessionPersistence.open(sessionId, 'read')
      expect((await stored.read()).events.findLast(event => event.type === 'session/title')?.data)
        .toMatchObject({ title: 'Ready title' })
    } finally {
      release.resolve(undefined)
      abort.abort()
      await iterator.return?.()
      resume.mockRestore()
    }
  })

  it('reuses a named blank after its original setup completes', async () => {
    const { ctx, root, remote } = await harness()
    const sessionId = SessionId('blank-initializing')
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const creation = ctx.agents.create({
      sessionId, meta: { cwd: root },
      setup: async () => { entered.resolve(undefined); await release.promise },
    })
    const resume = vi.spyOn(ctx.agents, 'resume')
    try {
      await entered.promise
      const reused = remote.create({ sessionId, cwd: root })
      release.resolve(undefined)
      await creation
      const result = await reused
      if (!result.ok) throw result.error
      expect(result.value.sessionId).toBe(sessionId)
      expect(ctx.agents.list()).toHaveLength(1)
      expect(resume).not.toHaveBeenCalled()
    } finally {
      release.resolve(undefined)
      await creation
      resume.mockRestore()
    }
  })

  it.each(['failure', 'cancel'] as const)('ends waiters after initialization %s releases its writer', async (outcome) => {
    const { ctx, root, controller } = await harness()
    const sessionId = SessionId('failed-initializing')
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const cancellation = new AbortController()
    const creation = ctx.agents.create({
      sessionId, meta: { cwd: root }, seed, signal: cancellation.signal,
      setup: async () => { entered.resolve(undefined); await release.promise; throw new Error('setup failed') },
    })
    const failed = expect(creation).rejects.toThrow()
    try {
      await entered.promise
      const resolution = controller.resolveAgent(sessionId)
      if (outcome === 'cancel') cancellation.abort(new Error('cancelled'))
      release.resolve(undefined)
      await failed
      await expect(resolution).resolves.toMatchObject({ error: { code: 'session/not-found' } })
      expect(ctx.agents.get(sessionId)).toBeUndefined()
      await using writer = await ctx.sessionPersistence.open(sessionId, 'write')
      expect(writer.id).toBe(sessionId)
    } finally {
      release.resolve(undefined)
      await failed
    }
  })

  it('does not wait for a bare Session whose writer belongs to another owner', async () => {
    const { ctx, root, controller } = await harness()
    const sessionId = SessionId('bare-session')
    const session = ctx.sessions.create(sessionId, { meta: { cwd: root } })
    await using writer = await ctx.sessionPersistence.create(session.header)
    expect(writer.id).toBe(sessionId)
    await expect(controller.resolveAgent(sessionId)).resolves.toMatchObject({ error: { code: 'session/writer-held' } })
  })

  it('releases Controller waiters without disposing the original Agent owner', async () => {
    const { ctx, root, controller, api } = await harness()
    const sessionId = SessionId('independently-owned')
    const previous = await ctx.agents.create({ sessionId, meta: { cwd: root }, seed })
    await previous.dispose()
    const abort = new AbortController()
    const iterator = controller.follow({ address: { kind: 'session', sessionId } }, abort.signal)[Symbol.asyncIterator]()
    await iterator.next()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const creation = ctx.agents.resume({
      resumeSessionId: sessionId,
      setup: async () => { entered.resolve(undefined); await release.promise },
    })
    try {
      await entered.promise
      // Continuing the cold follow starts its background promotion while the original resume owns setup.
      const following = iterator.next()
      const resolving = controller.resolveAgent(sessionId)
      await api.dispose()
      await following
      await expect(resolving).resolves.toMatchObject({ error: { code: 'session/not-found' } })
      expect(ctx.sessions.get(sessionId)).toBeDefined()
      release.resolve(undefined)
      const handle = await creation
      expect(ctx.agents.get(sessionId)).toBe(handle.agent)
    } finally {
      release.resolve(undefined)
      abort.abort()
      await iterator.return?.()
      await creation
    }
  })
})

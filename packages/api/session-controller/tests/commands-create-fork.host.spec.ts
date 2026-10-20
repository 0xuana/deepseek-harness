import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type { Workspace, WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { describe, expect, it, vi } from 'vitest'
import {
  ApiSessionAgentController,
  ApiSessionCwdConflict,
  type ApiSessionCreated,
  type ApiSessionCreateRequest,
} from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import { installSessionReadTestServices, testSessionPersistence } from './test-remote.ts'

async function expectFailure(operation: Promise<unknown>, code: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code })
}

/** The Agent controller with a fixed Agent composition, and optionally a fixed creation outcome. */
function controllerAgents(
  ctx: Context,
  fixed: {
    readonly composeAgent?: ApiSessionAgentController['composeAgent']
    readonly createSession?: ApiSessionAgentController['createSession']
  } = {},
): ApiSessionAgentController {
  const agents = new ApiSessionAgentController(ctx)
  vi.spyOn(agents, 'composeAgent').mockImplementation(fixed.composeAgent ?? (() => Promise.resolve({ setup: () => {} })))
  if (fixed.createSession !== undefined) vi.spyOn(agents, 'createSession').mockImplementation(fixed.createSession)
  return agents
}

/** A creation outcome that publishes `sessionId` in `cwd` as a stand-in Agent. */
function publishedSession(ctx: Context, sessionId: SessionId) {
  return (request: ApiSessionCreateRequest): Promise<ApiSessionCreated> => {
    const session = ctx.sessions.create(sessionId, { meta: { cwd: request.cwd } })
    return Promise.resolve({ agent: { id: session.id, session, status: 'idle', ctx } as Agent, agentPreset: undefined })
  }
}

async function baseContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  installSessionReadTestServices(ctx)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
    saveSelection: () => Promise.resolve(),
  } as never)
  return ctx
}

describe('Session creation failures', () => {
  it('creates in the default cwd without a named identity when no explicit target is supplied', async () => {
    const ctx = await baseContext()
    ctx.provide('workspaceRegistry', { get: () => undefined, list: () => [], archivedSessionIds: [] } as never)
    const createSession = vi.fn(publishedSession(ctx, SessionId('session-minted')))
    const controller = new SessionCommandController(ctx, controllerAgents(ctx, { createSession }), '/default-workspace')

    const created = await controller.create({})

    expect(created).toEqual({ sessionId: 'session-minted' })
    expect(createSession).toHaveBeenCalledOnce()
    const request = createSession.mock.calls[0]?.[0]
    expect(request?.cwd).toBe('/default-workspace')
    expect(Object.keys(request ?? {}).sort()).toEqual(['cwd', 'reusable'])
    await ctx.fiber.dispose()
  })

  it('maps missing Workspaces and attachment failures', async () => {
    const missing = await baseContext()
    missing.provide('workspaceRegistry', { get: () => undefined, list: () => [] } as never)
    const missingController = new SessionCommandController(
      missing,
      controllerAgents(missing),
      '/default',
    )
    await expectFailure(missingController.create({
      workspaceId: 'missing' as WorkspaceId,
    }), 'workspace/not-found')
    await missing.fiber.dispose()

    const failed = await baseContext()
    const workspace = {
      id: 'workspace-1' as WorkspaceId,
      path: '/workspace',
      attachSession: () => Promise.reject(new Error('read-only workspace')),
    } as unknown as Workspace
    failed.provide('workspaceRegistry', {
      get: () => workspace,
      list: () => [workspace],
    } as never)
    const failedController = new SessionCommandController(
      failed,
      controllerAgents(failed, { createSession: publishedSession(failed, SessionId('workspace-session')) }),
      '/default',
    )
    await expectFailure(failedController.create({
      sessionId: SessionId('workspace-session'),
      workspaceId: workspace.id,
    }), 'session/workspace-attach-failed')
    await failed.fiber.dispose()
  })

  it.each([
    {
      error: new RemoteError(
        'agent-preset/invalid',
        'agent-presets: preset "broken" failed to mount: invalid composition',
        { agentPreset: 'broken', reason: 'invalid composition' },
      ),
      code: 'agent-preset/invalid',
    },
    {
      error: new ApiSessionCwdConflict(SessionId('cwd-less'), '/requested', undefined),
      code: 'session/conflict',
    },
    {
      error: new ApiSessionCwdConflict(SessionId('wrong-cwd'), '/requested', '/stored'),
      code: 'session/conflict',
    },
    {
      error: new Error('factory unavailable'),
      code: 'gateway/internal',
    },
  ])('maps $code creation failures', async ({ error, code }) => {
    const ctx = await baseContext()
    ctx.provide('workspaceRegistry', { get: () => undefined, list: () => [] } as never)
    const controller = new SessionCommandController(
      ctx,
      controllerAgents(ctx, { createSession: () => Promise.reject(error) }),
      '/default',
    )

    await expectFailure(controller.create({
      sessionId: SessionId('failed-create'), cwd: '/requested',
    }), code)
    await ctx.fiber.dispose()
  })

  it('rejects contradictory create targets', async () => {
    const ctx = await baseContext()
    const controller = new SessionCommandController(ctx, controllerAgents(ctx), '/default')

    await expectFailure(controller.create({
      workspaceId: 'workspace-1' as WorkspaceId,
      cwd: '/workspace',
    }), 'gateway/bad-request')
    await ctx.fiber.dispose()
  })

})

function completedSession(
  ctx: Context,
  id: string,
  cwd?: string,
  lineage: { parentSession?: SessionId; origin?: 'subagent' } = {},
) {
  const session = ctx.sessions.create(SessionId(id), {
    meta: { ...(cwd === undefined ? {} : { cwd }), ...lineage },
  })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'work' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return session
}

/**
 * A fork creation outcome that stores the seeded child the way the Agent factory would, so a later
 * request can observe it under the id the caller named.
 * @param ctx - context owning the Session store.
 * @returns the mocked `ctx.agents.create` implementation.
 */
function seededChildCreate(ctx: Context) {
  return vi.fn((options: CreateAgentOptions): Promise<AgentHandle> => {
    ctx.sessions.create(options.sessionId, {
      ...(options.seed === undefined ? {} : { seed: options.seed }),
      ...(options.inheritedEventCount === undefined ? {} : { inheritedEventCount: options.inheritedEventCount }),
      ...(options.meta === undefined ? {} : { meta: options.meta }),
    })
    return Promise.resolve(resolvedHandle(ctx, options.sessionId))
  })
}

function resolvedHandle(ctx: Context, sessionId: SessionId): AgentHandle {
  return {
    agent: { id: sessionId, status: 'idle', ctx } as Agent,
    dispose: () => Promise.resolve(),
  }
}

describe('Session fork failures', () => {
  it('maps missing cold sources with and without persistence', async () => {
    const withoutPersistence = await baseContext()
    withoutPersistence.provide('workspaceRegistry', { list: () => [] } as never)
    const unavailableController = new SessionCommandController(
      withoutPersistence, controllerAgents(withoutPersistence), '/default',
    )
    await expectFailure(unavailableController.fork({
      sessionId: SessionId('missing'),
    }), 'session/not-found')
    await withoutPersistence.fiber.dispose()

    const missing = await baseContext()
    missing.provide('workspaceRegistry', { list: () => [] } as never)
    missing.provide('sessionPersistence', testSessionPersistence(missing, {
      list: () => Promise.resolve([]),
      inspect: vi.fn(),
    }) as never)
    const missingController = new SessionCommandController(missing, controllerAgents(missing), '/default')
    await expectFailure(missingController.fork({
      sessionId: SessionId('missing'),
    }), 'session/not-found')
    await missing.fiber.dispose()
  })

  it('maps an observation failure to an internal fork error', async () => {
    const ctx = await baseContext()
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    vi.spyOn(ctx.sessionQuery, 'observeSession').mockRejectedValue(new Error('storage offline'))
    const controller = new SessionCommandController(ctx, controllerAgents(ctx), '/default')

    await expectFailure(controller.fork({ sessionId: SessionId('unreadable') }), 'gateway/internal')
    await ctx.fiber.dispose()
  })

  it('rejects a Session with no completed turn', async () => {
    const ctx = await baseContext()
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    const source = ctx.sessions.create(SessionId('empty-source'))
    const controller = new SessionCommandController(ctx, controllerAgents(ctx), '/default')

    await expectFailure(controller.fork({ sessionId: source.id }), 'session/fork-unavailable')
    await expect(controller.fork({ sessionId: source.id, atSeq: 0 })).rejects.toMatchObject({
      code: 'session/fork-unavailable',
      message: 'event 0 does not exist in session "empty-source" (last seq: none)',
    })
    await ctx.fiber.dispose()
  })

  it('maps lineage lookup and Agent creation failures', async () => {
    const lineage = await baseContext()
    lineage.provide('workspaceRegistry', { list: () => [] } as never)
    vi.spyOn(lineage.sessionQuery, 'traceSession')
      .mockRejectedValue(new Error('lineage unavailable'))
    const child = completedSession(lineage, 'subagent-source', '/workspace', {
      parentSession: SessionId('parent'),
      origin: 'subagent',
    })
    const lineageController = new SessionCommandController(lineage, controllerAgents(lineage), '/default')
    await expectFailure(lineageController.fork({ sessionId: child.id }), 'gateway/internal')
    await lineage.fiber.dispose()

    const creation = await baseContext()
    creation.provide('workspaceRegistry', { list: () => [] } as never)
    const source = completedSession(creation, 'creation-source', '/workspace')
    vi.spyOn(creation.agents, 'create').mockRejectedValue(new Error('factory failed'))
    const creationController = new SessionCommandController(creation, controllerAgents(creation), '/default')
    await expectFailure(creationController.fork({ sessionId: source.id }), 'gateway/internal')
    await creation.fiber.dispose()
  })

  it('omits absent cwd and preset metadata before reporting Workspace attachment failure', async () => {
    const ctx = await baseContext()
    const source = completedSession(ctx, 'workspace-source')
    const workspace = {
      id: 'workspace-1' as WorkspaceId,
      sessionIds: [source.id],
      attachSession: () => Promise.reject(new Error('workspace write failed')),
    } as unknown as Workspace
    ctx.provide('workspaceRegistry', { list: () => [workspace] } as never)
    const create = vi.spyOn(ctx.agents, 'create').mockImplementation(
      (options: CreateAgentOptions) => Promise.resolve(resolvedHandle(ctx, options.sessionId)),
    )
    const controller = new SessionCommandController(ctx, controllerAgents(ctx), '/default')

    await expectFailure(controller.fork({ sessionId: source.id }), 'session/workspace-attach-failed')
    const options = create.mock.calls[0]?.[0]
    if (options === undefined) throw new Error('Agent creation was not attempted')
    expect(options.meta).not.toHaveProperty('cwd')
    expect(options.meta).not.toHaveProperty('agentPreset')
    await ctx.fiber.dispose()
  })

  it('carries the composed Agent preset into the child metadata', async () => {
    const ctx = await baseContext()
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    const source = completedSession(ctx, 'preset-source', '/workspace')
    const create = vi.spyOn(ctx.agents, 'create').mockImplementation(
      (options: CreateAgentOptions) => Promise.resolve(resolvedHandle(ctx, options.sessionId)),
    )
    const controller = new SessionCommandController(ctx, controllerAgents(ctx, {
      composeAgent: () => Promise.resolve({ agentPreset: 'minimal', setup: () => {} }),
    }), '/default')

    const forked = await controller.fork({ sessionId: source.id })
    expect(forked.sessionId).toMatch(/^session-/)
    const options = create.mock.calls[0]?.[0]
    if (options === undefined) throw new Error('Agent creation was not attempted')
    expect(options.meta?.agentPreset).toBe('minimal')
    await ctx.fiber.dispose()
  })
})
describe('Session fork named children', () => {
  it('adopts the child an earlier named fork already materialized', async () => {
    const ctx = await baseContext()
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    const source = completedSession(ctx, 'named-source')
    const create = seededChildCreate(ctx)
    vi.spyOn(ctx.agents, 'create').mockImplementation(create)
    const controller = new SessionCommandController(ctx, controllerAgents(ctx), '/default')
    const child = SessionId('named-child')

    // Nothing is stored under the name yet, so the first call forks the child it was asked for.
    await expect(controller.fork({ sessionId: source.id, childSessionId: child }))
      .resolves.toEqual({ sessionId: child })
    expect(create).toHaveBeenCalledOnce()

    // The retry reads the stored child as this request's own fork and answers with it, without
    // materializing a second child.
    await expect(controller.fork({ sessionId: source.id, childSessionId: child }))
      .resolves.toEqual({ sessionId: child })
    expect(create).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('finishes the Workspace attach an interrupted named fork left pending', async () => {
    const ctx = await baseContext()
    const workspace = {
      id: 'workspace-1' as WorkspaceId,
      path: '/workspace',
      sessionIds: [] as SessionId[],
      attachSession: vi.fn(async (childId: SessionId) => { workspace.sessionIds = [...workspace.sessionIds, childId] }),
    }
    workspace.attachSession.mockRejectedValueOnce(new Error('workspace write failed'))
    ctx.provide('workspaceRegistry', { list: () => [workspace] } as never)
    const source = completedSession(ctx, 'named-workspace-source', '/workspace')
    // The Workspace is resolved by the source Session's membership.
    workspace.sessionIds = [source.id]
    vi.spyOn(ctx.agents, 'create').mockImplementation(seededChildCreate(ctx))
    const controller = new SessionCommandController(ctx, controllerAgents(ctx), '/default')
    const child = SessionId('named-workspace-child')

    // The child is durable but the attach failed, so the first attempt reports the partial failure.
    await expectFailure(controller.fork({ sessionId: source.id, childSessionId: child }), 'session/workspace-attach-failed')
    expect(workspace.attachSession).toHaveBeenCalledOnce()
    expect(workspace.sessionIds).toEqual([source.id])

    // The retry adopts the stored child and retries the missing attach instead of skipping it.
    await expect(controller.fork({ sessionId: source.id, childSessionId: child })).resolves.toEqual({ sessionId: child })
    expect(workspace.attachSession).toHaveBeenCalledTimes(2)
    expect(workspace.sessionIds).toEqual([source.id, child])

    // A retry of an already attached child is idempotent: nothing is attached again.
    await expect(controller.fork({ sessionId: source.id, childSessionId: child })).resolves.toEqual({ sessionId: child })
    expect(workspace.attachSession).toHaveBeenCalledTimes(2)
    await ctx.fiber.dispose()
  })

  it('never reports success while a retry still cannot attach the named child', async () => {
    const ctx = await baseContext()
    const workspace = {
      id: 'workspace-1' as WorkspaceId,
      path: '/workspace',
      sessionIds: [] as SessionId[],
      attachSession: vi.fn(() => Promise.reject(new Error('workspace still read-only'))),
    }
    ctx.provide('workspaceRegistry', { list: () => [workspace] } as never)
    const source = completedSession(ctx, 'named-stuck-source', '/workspace')
    workspace.sessionIds = [source.id]
    vi.spyOn(ctx.agents, 'create').mockImplementation(seededChildCreate(ctx))
    const controller = new SessionCommandController(ctx, controllerAgents(ctx), '/default')
    const child = SessionId('named-stuck-child')

    await expectFailure(controller.fork({ sessionId: source.id, childSessionId: child }), 'session/workspace-attach-failed')
    await expectFailure(controller.fork({ sessionId: source.id, childSessionId: child }), 'session/workspace-attach-failed')
    expect(workspace.attachSession).toHaveBeenCalledTimes(2)
    expect(workspace.sessionIds).toEqual([source.id])
    await ctx.fiber.dispose()
  })

  it('refuses a named child another Session holds, and one seeded at another cut', async () => {
    const foreign = await baseContext()
    foreign.provide('workspaceRegistry', { list: () => [] } as never)
    const source = completedSession(foreign, 'named-foreign-source')
    // The name is taken by a Session that was not seeded from this source at all.
    foreign.sessions.create(SessionId('foreign-child'), {
      meta: { parentSession: SessionId('another-source') },
    })
    const foreignController = new SessionCommandController(foreign, controllerAgents(foreign), '/default')
    await expect(foreignController.fork({ sessionId: source.id, childSessionId: SessionId('foreign-child') }))
      .rejects.toMatchObject({ code: 'session/fork-conflict' })
    await foreign.fiber.dispose()

    const cut = await baseContext()
    cut.provide('workspaceRegistry', { list: () => [] } as never)
    const cutSource = completedSession(cut, 'named-cut-source')
    // Same source, but the stored child inherited a shorter prefix than this fork would write.
    cut.sessions.create(SessionId('wrong-cut-child'), {
      seed: cutSource.snapshotEvents().slice(0, 2),
      inheritedEventCount: SessionLogOffset(2),
      meta: { parentSession: cutSource.id, isSeeded: true },
    })
    const cutController = new SessionCommandController(cut, controllerAgents(cut), '/default')
    await expect(cutController.fork({ sessionId: cutSource.id, childSessionId: SessionId('wrong-cut-child') }))
      .rejects.toMatchObject({ code: 'session/fork-conflict' })
    await cut.fiber.dispose()
  })

  it('maps a named child it cannot read to an internal fork error', async () => {
    const corrupt = await baseContext()
    corrupt.provide('workspaceRegistry', { list: () => [] } as never)
    const corruptSource = completedSession(corrupt, 'named-corrupt-source')
    const corruptQuery = corrupt.sessionQuery
    const observeCorrupt = corruptQuery.observeSession.bind(corruptQuery)
    vi.spyOn(corruptQuery, 'observeSession').mockImplementation(async (sessionId, options) => (
      sessionId === corruptSource.id
        ? observeCorrupt(sessionId, options)
        : Promise.reject(new SessionQueryError('child is corrupt', 'SESSION_QUERY_CORRUPT_SESSION'))
    ))
    const corruptController = new SessionCommandController(corrupt, controllerAgents(corrupt), '/default')
    await expect(corruptController.fork({ sessionId: corruptSource.id, childSessionId: SessionId('corrupt-child') }))
      .rejects.toMatchObject({ code: 'gateway/internal' })
    await corrupt.fiber.dispose()

    const offline = await baseContext()
    offline.provide('workspaceRegistry', { list: () => [] } as never)
    const offlineSource = completedSession(offline, 'named-offline-source')
    const offlineQuery = offline.sessionQuery
    const observeOffline = offlineQuery.observeSession.bind(offlineQuery)
    vi.spyOn(offlineQuery, 'observeSession').mockImplementation(async (sessionId, options) => (
      sessionId === offlineSource.id
        ? observeOffline(sessionId, options)
        : Promise.reject(new Error('storage offline'))
    ))
    const offlineController = new SessionCommandController(offline, controllerAgents(offline), '/default')
    await expect(offlineController.fork({ sessionId: offlineSource.id, childSessionId: SessionId('offline-child') }))
      .rejects.toMatchObject({ code: 'gateway/internal' })
    await offline.fiber.dispose()
  })
})

import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createUserMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord, SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { BundleInfo, ChangeResult } from '@deepseek-ai/dsh-plugin-manager/types'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import * as PluginRecommendations from '../src/index.ts'
import { recommendationProjection } from '../src/projection.ts'
import type { RecommendationDecision } from '../src/types.ts'

const bundle: BundleInfo = {
  name: 'official-search', official: true, optional: true, availability: 'installation',
  enabled: false, installed: false, removable: false, updatable: false, rows: [], overrides: [],
  meta: { title: { en: 'Search', zh: '搜索' }, description: 'Search past conversations.' },
}
const callId = ToolCallId('suggest-1')

async function fixture() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(RemoteAccess)
  const manager = {
    listBundles: vi.fn(async (): Promise<BundleInfo[]> => [bundle]),
    setBundleEnabled: vi.fn(async (): Promise<ChangeResult> => ({ application: 'applied', changed: true, stage: 'enable', target: bundle.name, enabled: true })),
  }
  ctx.provide('pluginManager', manager)
  const fiber = await ctx.plugin(PluginRecommendations)
  const handle = await ctx.agents.create({ sessionId: SessionId('recommendations') })
  const agent = handle.agent
  const events: SessionEvent[] = []
  ctx.on('session/event', (session, event) => { if (session === agent.session) events.push(event) })
  const steer = vi.spyOn(agent, 'steer').mockImplementation(() => {})
  agent.session.append('user/message', createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: 'Please find last week’s conversation.' }],
  }), { surfaceOp: 'append' })
  const execute = (name: string, args: object, caller = agent) => ctx.tools.execute({
    name, arguments: args, agent: caller, callId, signal: new AbortController().signal,
  })
  const propose = async () => {
    const result = await execute('suggest_plugin', { name: bundle.name, request: 'last week’s conversation', reason: 'Search your conversation history.' })
    expect(result.isError).toBe(false)
    agent.session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({ callId, content: result.content, isError: result.isError }),
      ...result.meta === undefined ? {} : { meta: result.meta },
    }, { surfaceOp: 'append' })
    return result
  }
  return { ctx, agent, handle, manager, fiber, execute, propose, steer, events }
}

describe('official recommendations', () => {
  it('provides discovery-first guidance only to roots with both tools and withdraws it on unload', async () => {
    const f = await fixture()
    const text = async () => renderPrompt(await f.ctx.systemPrompt.assemble(assembleContextFor(f.agent)))
    expect(await text()).toContain('Recommendation eligibility comes first:')
    expect({
      prompt: await text(),
      proposal: f.ctx.tools.get('suggest_plugin', f.agent)?.description,
      parameters: f.ctx.tools.get('suggest_plugin', f.agent)?.parameters,
    }).toMatchSnapshot('one selected need and accurate proposal outcomes')
    expect(renderPrompt(await f.ctx.systemPrompt.assemble())).not.toContain('Recommendation eligibility comes first:')
    const child = await f.agent.ctx.agents.create({ sessionId: SessionId('recommendations-child'), parentAgent: f.agent })
    expect(renderPrompt(await f.ctx.systemPrompt.assemble(assembleContextFor(child.agent)))).not.toContain('Recommendation eligibility comes first:')
    await child.dispose()
    for (const name of ['list_official_plugins', 'suggest_plugin']) {
      const restore = f.agent.ctx.tools.restrict({ deny: [name] })
      expect(await text()).not.toContain('Recommendation eligibility comes first:')
      restore()
    }
    expect(await text()).toContain('Recommendation eligibility comes first:')
    await f.fiber.dispose()
    expect(await text()).not.toContain('Recommendation eligibility comes first:')
  })

  it('admits one proposal per turn when this experiment is enabled alone, including concurrent calls and retries', async () => {
    const f = await fixture()
    f.agent.session.append('turn/start', { turn: 1 })
    const gate = Promise.withResolvers<BundleInfo[]>()
    const entered = Promise.withResolvers<undefined>()
    f.manager.listBundles.mockImplementationOnce(() => { entered.resolve(undefined); return gate.promise })
    const execute = (id: string, name = bundle.name) => f.ctx.tools.execute({
      name: 'suggest_plugin', arguments: { name, request: 'history search', reason: 'find past work' },
      agent: f.agent, callId: ToolCallId(id), signal: new AbortController().signal,
    })
    const first = execute('first')
    await entered.promise
    const second = await execute('parallel')
    gate.resolve([bundle])
    const result = await first
    expect(second.isError).toBe(true)
    expect(second.content).toMatchSnapshot('rejected extra proposal does not promise a card')
    expect(result.isError).toBe(false)
    f.agent.session.append('tool/result', { turn: 1, step: 1,
      message: createToolResultMessage({ callId: ToolCallId('first'), content: result.content, isError: false }),
      ...result.meta === undefined ? {} : { meta: result.meta },
    }, { surfaceOp: 'append' })
    await f.fiber.dispose()
    await f.ctx.plugin(PluginRecommendations)
    expect((await execute('after-reload')).isError).toBe(true)
    f.agent.session.append('turn/start', { turn: 2 })
    expect((await execute('invalid', 'missing')).isError).toBe(true)
    expect((await execute('next-turn')).isError).toBe(false)
    await f.handle.dispose()
  })

  it('does not release a newer turn reservation when an older lookup fails late', async () => {
    const f = await fixture()
    const gate = Promise.withResolvers<BundleInfo[]>()
    const entered = Promise.withResolvers<undefined>()
    f.manager.listBundles.mockImplementationOnce(() => { entered.resolve(undefined); return gate.promise })
    const execute = (id: string) => f.ctx.tools.execute({
      name: 'suggest_plugin', arguments: { name: bundle.name, request: 'search', reason: 'history' },
      agent: f.agent, callId: ToolCallId(id), signal: new AbortController().signal,
    })
    f.agent.session.append('turn/start', { turn: 1 })
    const old = execute('old')
    await entered.promise
    f.agent.session.append('turn/start', { turn: 2 })
    expect((await execute('new')).isError).toBe(false)
    gate.resolve([])
    expect((await old).isError).toBe(true)
    expect((await execute('duplicate')).isError).toBe(true)
  })

  it('uses catalog fallbacks when translations or descriptions are absent', async () => {
    const f = await fixture()
    const noMeta = { ...bundle }
    delete noMeta.meta
    f.manager.listBundles.mockResolvedValue([{ ...noMeta, description: 'History search' }])
    expect((await f.execute('list_official_plugins', {})).value).toContain('History search')
    f.manager.listBundles.mockResolvedValue([noMeta])
    expect((await f.execute('list_official_plugins', {})).value).toContain('"description":""')
    expect((await f.propose()).meta).toMatchObject({ pluginRecommendation: { titleZh: bundle.name, descriptionZh: '' } })
    f.manager.listBundles.mockResolvedValue([{ ...bundle, meta: { title: { en: 'Search' }, description: { en: 'History' } } }])
    expect((await f.propose()).meta).toMatchObject({ pluginRecommendation: { titleZh: 'Search', descriptionZh: 'History' } })
  })

  it('releases a proposal rejected by a post-execute hook so a different call can retry', async () => {
    const f = await fixture()
    const remove = f.ctx.on('tools/post-execute', async (_exec, _result, _next) => ({ kind: 'block', feedback: [{ type: 'text', text: 'test veto' }] }))
    expect((await f.execute('suggest_plugin', { name: bundle.name, request: 'search', reason: 'history' })).isError).toBe(true)
    remove()
    const retry = await f.ctx.tools.execute({
      name: 'suggest_plugin', arguments: { name: bundle.name, request: 'search', reason: 'history' },
      agent: f.agent, callId: ToolCallId('retry-after-hook'), signal: new AbortController().signal,
    })
    expect(retry.isError).toBe(false)
  })

  it('allows a session-authorized dismissal without global profile access', async () => {
    const f = await fixture()
    await f.propose()
    vi.spyOn(f.ctx.remoteAccess, 'allows').mockReturnValue(false)
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'dismiss')).toEqual({ status: 'settled', outcome: 'dismissed' })
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
  })

  it('refuses non-root callers and profile writes without global access', async () => {
    const f = await fixture()
    vi.spyOn(f.ctx.agents, 'roots').mockReturnValue([])
    expect((await f.execute('suggest_plugin', { name: bundle.name, request: 'search', reason: 'history' })).isError).toBe(true)
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'refused', reason: 'not-live-root' })
    vi.spyOn(f.ctx.remoteAccess, 'allows').mockReturnValue(false)
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'refused', reason: 'access-denied' })
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
  })

  it('folds PTC proposals and ignores malformed or failed settlements', async () => {
    const f = await fixture()
    const result = await f.propose()
    const event: SessionEvent<'tool/ptc-dispatch'> = {
      type: 'tool/ptc-dispatch', seq: SessionSeq(1), time: 0,
      data: { rootCallId: callId, parentCallId: callId, subCallId: callId,
        name: 'suggest_plugin', arguments: {}, content: result.content, isError: false,
        ...result.meta === undefined ? {} : { meta: result.meta } },
    }
    const state = recommendationProjection.apply(recommendationProjection.init(), event)
    expect(state.proposals[callId]?.name).toBe(bundle.name)
    expect(recommendationProjection.apply(state, { ...event, data: { ...event.data, meta: { pluginRecommendation: null } } })).toBe(state)
    expect(recommendationProjection.apply(state, { ...event, data: { ...event.data, isError: true } })).toBe(state)
  })

  it('lists usable shipped official plugins with enabled state without side effects', async () => {
    const f = await fixture()
    f.manager.listBundles.mockResolvedValue([
      bundle, { ...bundle, name: 'custom', official: false }, { ...bundle, name: 'enabled', enabled: true },
      { ...bundle, name: 'missing', availability: 'missing' }, { ...bundle, name: 'on-demand', optional: false },
      { ...bundle, name: 'read-only', readOnlyReason: 'management-required' },
      { ...bundle, name: 'failed', error: { code: 'operation-error', diagnostic: 'load failed' } },
    ])
    const result = await f.execute('list_official_plugins', {})
    expect(result.value).toBe(JSON.stringify([
      { name: bundle.name, title: bundle.meta?.title, description: bundle.meta?.description, enabled: false },
      { name: 'enabled', title: bundle.meta?.title, description: bundle.meta?.description, enabled: true },
    ]))
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
  })

  it('grounds a card in the human request and keeps metadata host-owned', async () => {
    const f = await fixture()
    const result = await f.propose()
    expect(result.meta).toMatchObject({ pluginRecommendation: { titleZh: '搜索', name: bundle.name, callId } })
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ status: 'offered', name: bundle.name }) }])
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
    for (const args of [
      { name: 'custom', request: 'last week’s conversation', reason: 'help' },
      { name: bundle.name, request: ' ', reason: 'help' },
      { name: bundle.name, request: 'last week’s conversation', reason: ' ' },
    ]) expect((await f.execute('suggest_plugin', args)).isError).toBe(true)
    f.manager.listBundles.mockResolvedValue([{ ...bundle, enabled: true }])
    expect((await f.execute('suggest_plugin', { name: bundle.name, request: 'last week’s conversation', reason: 'help' })).isError).toBe(true)
  })

  it('records the application result, continues once, and restores decisions by replay', async () => {
    const f = await fixture()
    await f.propose()
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'settled', outcome: 'applied' })
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'settled', outcome: 'applied' })
    expect(f.manager.setBundleEnabled).toHaveBeenCalledExactlyOnceWith(bundle.name, true)
    expect(f.steer).toHaveBeenCalledOnce()
    expect(f.steer.mock.calls[0]?.[0]).toMatchObject({ source: { kind: 'plugin-recommendation', callId } })
    expect(f.steer.mock.calls[0]?.[0].content).toEqual([{ type: 'text', text: JSON.stringify({
      plugin: bundle.name, status: 'enabled', userRequest: 'last week’s conversation',
      instruction: 'The user clicked Enable, which only enables this plugin. First re-read the original user message, not just userRequest above: preserve explicit limits such as "only recommend", "do not execute", or "not yet" even when the request also describes a desired task. In those cases, or when the user only asked to find or enable a plugin, briefly confirm activation and stop without calling tools or asking for another message. Otherwise continue only work already requested, using the available capability. Enabling is not permission for new account-wide searches, bulk edits, or other scope changes.',
    }) }])
    const state = f.events.reduce(
      recommendationProjection.apply, recommendationProjection.init(),
    )
    expect(state.view.decisions[callId]).toBe('applied')
    expect(f.ctx.sessionProjections.summaryKeys().has('pluginRecommendations')).toBe(false)
  })

  it.each(['restart-required', 'overridden', 'failed', 'cancelled'] as const)('does not continue on %s and preserves the exact outcome', async (application) => {
    const f = await fixture()
    await f.propose()
    f.manager.setBundleEnabled.mockResolvedValue({ application, changed: false, stage: 'enable', target: bundle.name })
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'settled', outcome: application })
    expect(f.steer).not.toHaveBeenCalled()
    if (application === 'failed' || application === 'cancelled') {
      f.manager.setBundleEnabled.mockResolvedValue({ application: 'applied', changed: true, stage: 'enable', target: bundle.name })
      expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'settled', outcome: 'applied' })
    }
  })

  it('settles an already-enabled plugin without another reload or activation notice', async () => {
    const f = await fixture()
    await f.propose()
    f.manager.listBundles.mockResolvedValue([{ ...bundle, enabled: true }])
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'settled', outcome: 'already-enabled' })
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
    expect(f.steer).not.toHaveBeenCalled()
  })

  it('preserves the management failure code without persisting external diagnostics', async () => {
    const f = await fixture()
    await f.propose()
    f.manager.setBundleEnabled.mockResolvedValue({ application: 'failed', changed: false, stage: 'enable', target: bundle.name,
      error: { code: 'incompatible-version', diagnostic: '/private/profile/path' } })
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'settled', outcome: 'failed', errorCode: 'incompatible-version' })
    expect(JSON.stringify(f.events)).not.toContain('/private/profile/path')
  })

  it('contains an unreadable receipt and refuses actions without stalling later events', async () => {
    const f = await fixture()
    await f.propose()
    // Persisted data can originate in a newer build, outside the current writer's types.
    const malformed = JSON.parse('{"callId":"suggest-1","outcome":"future-outcome"}') as RecommendationDecision
    appendPluginRecord(f.agent.session, 'plugin:plugin-recommendations/decision', malformed)
    f.agent.session.append('turn/start', { turn: 2 })
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'refused', reason: 'invalid-history' })
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
    expect(f.events.reduce(recommendationProjection.apply, recommendationProjection.init()).turn).toBe(2)
    expect((await f.execute('suggest_plugin', { name: bundle.name, request: 'search', reason: 'history' })).isError).toBe(true)
  })

  it.each(['plugin', 'plugin-reload', 'agent'] as const)('does not start activation after the %s leaves during catalog lookup', async (target) => {
    const f = await fixture()
    await f.propose()
    const entered = Promise.withResolvers<undefined>()
    const gate = Promise.withResolvers<BundleInfo[]>()
    onTestFinished(() => { gate.resolve([bundle]) })
    f.manager.listBundles.mockImplementationOnce(() => { entered.resolve(undefined); return gate.promise })
    const action = f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')
    await entered.promise
    const disposal = target === 'agent' ? f.handle.dispose()
      : target === 'plugin' ? f.fiber.dispose() : f.fiber.restart()
    if (target === 'agent') await disposal
    gate.resolve([bundle])
    expect(await action).toEqual({ status: 'refused', reason: target === 'agent' ? 'not-live-root' : 'closing' })
    await disposal
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
  })

  it('dismisses durably, rejects forged ids, and rechecks catalog eligibility', async () => {
    const f = await fixture()
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'refused', reason: 'unknown' })
    await f.propose()
    f.manager.listBundles.mockResolvedValue([])
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'refused', reason: 'unavailable' })
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'dismiss')).toEqual({ status: 'settled', outcome: 'dismissed' })
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'settled', outcome: 'dismissed' })
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
    expect(f.steer).not.toHaveBeenCalled()
  })

  it('coalesces actions and releases local work when HMR must unload the consumer before applying', async () => {
    const f = await fixture()
    await f.propose()
    const gate = Promise.withResolvers<ChangeResult>()
    onTestFinished(() => { gate.resolve({ application: 'applied', changed: true, stage: 'enable', target: bundle.name }) })
    const entered = Promise.withResolvers<undefined>()
    f.manager.setBundleEnabled.mockImplementation(() => { entered.resolve(undefined); return gate.promise })
    const first = f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')
    await entered.promise
    const second = f.ctx.pluginRecommendations.act(f.agent, callId, 'dismiss')
    const service = f.ctx.pluginRecommendations
    const disposing = f.fiber.dispose()
    await disposing
    expect(await first).toEqual({ status: 'unconfirmed', reason: 'closing' })
    expect(await second).toEqual(await first)
    const before = f.events.length
    gate.resolve({ application: 'applied', changed: true, stage: 'enable', target: bundle.name })
    await gate.promise
    expect(f.events).toHaveLength(before)
    expect(f.steer).not.toHaveBeenCalled()
    expect(f.manager.setBundleEnabled).toHaveBeenCalledOnce()
    expect(await service.act(f.agent, callId, 'enable')).toEqual({ status: 'refused', reason: 'closing' })
  })
})

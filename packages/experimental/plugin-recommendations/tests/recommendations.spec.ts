import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createUserMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { BundleInfo, ChangeResult } from '@deepseek-ai/dsh-plugin-manager/types'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import PluginRecommendations from '../src/index.ts'
import { recommendationProjection } from '../src/projection.ts'

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
  const harness = await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(RemoteAccess)
  const manager = {
    listBundles: vi.fn(async (): Promise<BundleInfo[]> => [bundle]),
    setBundleEnabled: vi.fn(async (): Promise<ChangeResult> => ({ application: 'applied', changed: true, stage: 'enable', target: bundle.name, enabled: true })),
  }
  ctx.provide('pluginManager', manager)
  const fiber = await ctx.plugin(PluginRecommendations)
  const agent = await harness.create(SessionId('recommendations'))
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
  return { ctx, agent, manager, fiber, execute, propose, steer, events }
}

describe('official recommendations', () => {
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

  it('lists only disabled, usable shipped official plugins without side effects', async () => {
    const f = await fixture()
    f.manager.listBundles.mockResolvedValue([
      bundle, { ...bundle, name: 'custom', official: false }, { ...bundle, name: 'enabled', enabled: true },
      { ...bundle, name: 'missing', availability: 'missing' }, { ...bundle, name: 'on-demand', optional: false },
      { ...bundle, name: 'read-only', readOnlyReason: 'management-required' },
      { ...bundle, name: 'failed', error: { code: 'operation-error', diagnostic: 'load failed' } },
    ])
    const result = await f.execute('list_official_plugins', {})
    expect(result.value).toBe(JSON.stringify([{ name: bundle.name, title: bundle.meta?.title, description: bundle.meta?.description }]))
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
  })

  it('grounds a card in the human request and keeps metadata host-owned', async () => {
    const f = await fixture()
    const result = await f.propose()
    expect(result.meta).toMatchObject({ pluginRecommendation: { titleZh: '搜索', name: bundle.name, callId } })
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

  it('coalesces concurrent actions and drains the operation on unload', async () => {
    const f = await fixture()
    await f.propose()
    const gate = Promise.withResolvers<ChangeResult>()
    const entered = Promise.withResolvers<undefined>()
    f.manager.setBundleEnabled.mockImplementation(() => { entered.resolve(undefined); return gate.promise })
    const first = f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')
    await entered.promise
    const second = f.ctx.pluginRecommendations.act(f.agent, callId, 'dismiss')
    const service = f.ctx.pluginRecommendations
    const disposing = f.fiber.dispose()
    gate.resolve({ application: 'restart-required', changed: true, stage: 'enable', target: bundle.name })
    expect(await first).toEqual({ status: 'settled', outcome: 'restart-required' })
    expect(await second).toEqual(await first)
    await disposing
    expect(f.manager.setBundleEnabled).toHaveBeenCalledOnce()
    expect(await service.act(f.agent, callId, 'enable')).toEqual({ status: 'refused', reason: 'closing' })
  })
})

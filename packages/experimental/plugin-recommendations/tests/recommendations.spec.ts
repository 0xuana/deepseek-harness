import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import type { BundleInfo, ChangeResult } from '@deepseek-ai/dsh-plugin-manager/types'
import * as PluginRecommendations from '../src/index.ts'
import type { RecommendationDecision } from '../src/types.ts'
import { bundle, callId, fixture } from './fixture.ts'

describe('official recommendations', () => {
  it('offers the live catalog through a skill, adds no tools, and withdraws it on unload', async () => {
    const f = await fixture()
    expect(f.ctx.tools.get('list_official_plugins')).toBeUndefined()
    expect(f.ctx.tools.get('suggest_plugin')).toBeUndefined()
    expect((await f.ctx.skills.list()).filter(skill => skill.name === 'official-plugins')).toMatchSnapshot('skill discovery')
    expect(f.manager.listBundles).not.toHaveBeenCalled()
    const noMeta = { ...bundle }
    delete noMeta.meta
    f.manager.listBundles.mockResolvedValue([
      bundle, { ...bundle, name: 'enabled', enabled: true },
      { ...noMeta, name: 'described', description: 'History search' }, { ...noMeta, name: 'bare' },
      { ...bundle, name: 'custom', official: false }, { ...bundle, name: 'missing', availability: 'missing' },
      { ...bundle, name: 'on-demand', optional: false }, { ...bundle, name: 'read-only', readOnlyReason: 'management-required' },
      { ...bundle, name: 'failed', error: { code: 'operation-error', diagnostic: 'load failed' } },
    ])
    const result = await executeToolFixture(f.ctx, { name: 'skill', arguments: { name: 'official-plugins' }, agent: f.agent,
      callId: ToolCallId('discovery'), signal: new AbortController().signal })
    expect(result.isError, JSON.stringify(result.content)).toBe(false)
    expect(result.value).toMatchSnapshot('skill policy and current catalog')
    const controller = new AbortController()
    f.manager.listBundles.mockImplementationOnce(async () => { controller.abort(); return [bundle] })
    await expect(f.ctx.skills.get('official-plugins', { signal: controller.signal })).rejects.toThrow()
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
    await f.fiber.dispose()
    expect(f.ctx.get('pluginRecommendations')).toBeUndefined()
    expect((await f.ctx.skills.list()).some(skill => skill.name === 'official-plugins')).toBe(false)
  })

  it('describes a logged proposal from the current catalog and refuses names outside it', async () => {
    const f = await fixture()
    expect(await f.ctx.pluginRecommendations.describe(f.agent, callId)).toEqual({ status: 'refused', reason: 'unknown' })
    f.propose()
    expect(await f.ctx.pluginRecommendations.describe(f.agent, callId)).toEqual({
      status: 'available', title: { en: 'Search', zh: '搜索' }, description: 'Search past conversations.', enabled: false,
    })
    const noMeta = { ...bundle }
    delete noMeta.meta
    f.manager.listBundles.mockResolvedValueOnce([{ ...noMeta, description: 'History search', enabled: true }])
    expect(await f.ctx.pluginRecommendations.describe(f.agent, callId)).toEqual({
      status: 'available', title: bundle.name, description: 'History search', enabled: true,
    })
    f.manager.listBundles.mockResolvedValueOnce([noMeta])
    expect(await f.ctx.pluginRecommendations.describe(f.agent, callId)).toMatchObject({ title: bundle.name, description: '' })
    for (const listed of [[], [{ ...bundle, official: false }]] satisfies BundleInfo[][]) {
      f.manager.listBundles.mockResolvedValueOnce(listed)
      expect(await f.ctx.pluginRecommendations.describe(f.agent, callId)).toEqual({ status: 'refused', reason: 'unavailable' })
    }
    vi.spyOn(f.ctx.agents, 'roots').mockReturnValueOnce([])
    expect(await f.ctx.pluginRecommendations.describe(f.agent, callId)).toEqual({ status: 'refused', reason: 'not-live-root' })
    const service = f.ctx.pluginRecommendations
    await f.fiber.dispose()
    expect(await service.describe(f.agent, callId)).toEqual({ status: 'refused', reason: 'closing' })
  })

  it('records the application result once, never wakes the conversation, and restores decisions by replay', async () => {
    const f = await fixture()
    const steer = vi.spyOn(f.agent, 'steer')
    const followup = vi.spyOn(f.agent, 'followup')
    f.propose()
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'settled', outcome: 'applied' })
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'settled', outcome: 'applied' })
    expect(f.manager.setBundleEnabled).toHaveBeenCalledExactlyOnceWith(bundle.name, true)
    expect(steer).not.toHaveBeenCalled()
    expect(followup).not.toHaveBeenCalled()
    expect(f.state().view.decisions[callId]).toBe('applied')
    expect(f.ctx.sessionProjections.summaryKeys().has('pluginRecommendations')).toBe(false)
  })

  it.each(['restart-required', 'overridden', 'failed', 'cancelled'] as const)('preserves the exact %s outcome and retries only failures', async (application) => {
    const f = await fixture()
    f.propose()
    f.manager.setBundleEnabled.mockResolvedValue({ application, changed: false, stage: 'enable', target: bundle.name })
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'settled', outcome: application })
    f.manager.setBundleEnabled.mockResolvedValue({ application: 'applied', changed: true, stage: 'enable', target: bundle.name })
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({
      status: 'settled', outcome: application === 'failed' || application === 'cancelled' ? 'applied' : application,
    })
  })

  it('settles an already-enabled plugin without another profile change', async () => {
    const f = await fixture()
    f.propose()
    f.manager.listBundles.mockResolvedValue([{ ...bundle, enabled: true }])
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'settled', outcome: 'already-enabled' })
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
  })

  it('preserves the management failure code without persisting external diagnostics', async () => {
    const f = await fixture()
    f.propose()
    f.manager.setBundleEnabled.mockResolvedValue({ application: 'failed', changed: false, stage: 'enable', target: bundle.name,
      error: { code: 'incompatible-version', diagnostic: '/private/profile/path' } })
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'settled', outcome: 'failed', errorCode: 'incompatible-version' })
    expect(JSON.stringify(f.events)).not.toContain('/private/profile/path')
  })

  it('contains an unreadable receipt and refuses actions without stalling later events', async () => {
    const f = await fixture()
    f.propose()
    // Persisted data can originate in a newer build, outside the current writer's types.
    const malformed = JSON.parse('{"callId":"block:answer-1","outcome":"future-outcome"}') as RecommendationDecision
    appendPluginRecord(f.agent.session, 'plugin:plugin-recommendations/decision', malformed)
    f.agent.session.append('turn/start', { turn: 2 })
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'refused', reason: 'invalid-history' })
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
    expect(f.state().turn).toBe(2)
    expect(f.state().view.invalid).toBe(true)
  })

  it.each(['plugin', 'plugin-reload', 'agent'] as const)('does not start activation after the %s leaves during catalog lookup', async (target) => {
    const f = await fixture()
    f.propose()
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

  it('dismisses durably, rejects unknown ids, and rechecks catalog eligibility', async () => {
    const f = await fixture()
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'refused', reason: 'unknown' })
    f.propose()
    f.manager.listBundles.mockResolvedValue([])
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'refused', reason: 'unavailable' })
    f.manager.listBundles.mockResolvedValue([{ ...bundle, optional: false }])
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'refused', reason: 'unavailable' })
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'dismiss')).toEqual({ status: 'settled', outcome: 'dismissed' })
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'settled', outcome: 'dismissed' })
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
  })

  it('settles cards that were never offered or were replaced without changing the profile', async () => {
    const f = await fixture()
    const message = createUserMessage({ content: [{ type: 'text', text: 'Next question.' }], source: { kind: 'user' } })
    f.agent.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message, message] })
    const suppressed = f.propose('answer-1')
    expect(await f.ctx.pluginRecommendations.act(f.agent, suppressed, 'enable')).toEqual({ status: 'settled', outcome: 'suppressed' })
    f.agent.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 2, inserted: [] })
    f.agent.session.append('turn/start', { turn: 2 })
    const first = f.propose('answer-2')
    f.agent.session.append('turn/start', { turn: 3 })
    f.propose('answer-3')
    expect(await f.ctx.pluginRecommendations.act(f.agent, first, 'enable')).toEqual({ status: 'settled', outcome: 'replaced' })
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
  })

  it('allows a session-authorized dismissal without global profile access', async () => {
    const f = await fixture()
    f.propose()
    vi.spyOn(f.ctx.remoteAccess, 'allows').mockReturnValue(false)
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'dismiss')).toEqual({ status: 'settled', outcome: 'dismissed' })
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
  })

  it('refuses non-root callers and profile writes without global access', async () => {
    const f = await fixture()
    f.propose()
    vi.spyOn(f.ctx.agents, 'roots').mockReturnValue([])
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'refused', reason: 'not-live-root' })
    vi.spyOn(f.ctx.remoteAccess, 'allows').mockReturnValue(false)
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'refused', reason: 'access-denied' })
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
  })

  it('refuses a click whose root leaves while the catalog is read', async () => {
    const f = await fixture()
    f.propose()
    const roots = f.ctx.agents.roots()
    vi.spyOn(f.ctx.agents, 'roots').mockReturnValueOnce(roots).mockReturnValue([])
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'refused', reason: 'not-live-root' })
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
  })

  it('coalesces actions and releases local work when HMR must unload the consumer before applying', async () => {
    const f = await fixture()
    f.propose()
    const gate = Promise.withResolvers<ChangeResult>()
    onTestFinished(() => { gate.resolve({ application: 'applied', changed: true, stage: 'enable', target: bundle.name }) })
    const entered = Promise.withResolvers<undefined>()
    f.manager.setBundleEnabled.mockImplementation(() => { entered.resolve(undefined); return gate.promise })
    const first = f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')
    await entered.promise
    const second = f.ctx.pluginRecommendations.act(f.agent, callId, 'dismiss')
    const service = f.ctx.pluginRecommendations
    await f.fiber.dispose()
    expect(await first).toEqual({ status: 'unconfirmed', reason: 'closing' })
    expect(await second).toEqual(await first)
    const before = f.events.length
    gate.resolve({ application: 'applied', changed: true, stage: 'enable', target: bundle.name })
    await gate.promise
    expect(f.events).toHaveLength(before)
    expect(f.manager.setBundleEnabled).toHaveBeenCalledOnce()
    expect(await service.act(f.agent, callId, 'enable')).toEqual({ status: 'refused', reason: 'closing' })
  })

  it('applies validated configuration and the schema default for direct composition', async () => {
    expect(PluginRecommendations.Config.parse(undefined)).toEqual({ queuedMessageLimit: 2 })
    expect(() => PluginRecommendations.Config.parse({ queuedMessageLimit: 0 })).toThrow()
    const f = await fixture()
    await f.fiber.dispose()
    await f.ctx.plugin(PluginRecommendations, PluginRecommendations.Config.parse({ queuedMessageLimit: 1 }))
    f.agent.inbox.append('next-turn', createUserMessage({ content: [{ type: 'text', text: 'Later.' }], source: { kind: 'user' } }))
    f.propose()
    expect(await f.ctx.pluginRecommendations.act(f.agent, callId, 'enable')).toEqual({ status: 'settled', outcome: 'suppressed' })
  })
})

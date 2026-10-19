/** Real registries validate keyed rendering, session binding, and HMR removal. */
import { Context } from '@deepseek-ai/cordis'
import { ConversationEventRegistry } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { expect, it, onTestFinished, vi } from 'vitest'
import { mountRecommendations, inject } from '../src/client/mount.ts'
const apply = (ctx: Context) => mountRecommendations(ctx, { package: '@deepseek-ai/dsh-experimental-plugin-recommendations', descriptors: [] })
import { apply as hostApply } from '../src/index.ts'
import type { RecommendationTailInjected } from '../src/client/Card.tsx'

it('binds actions to the displayed session and removes registrations on unload', async () => {
  hostApply()
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const events = new ConversationEventRegistry(ctx)
  const source = { getSnapshot: () => [], subscribe: () => () => {} }
  const turnDataSource = vi.fn(() => source)
  const snapshot = { nodes: { turnDataSource } }
  const getSnapshot = vi.fn<() => typeof snapshot | undefined>(() => snapshot)
  ctx.provide('uiConversation', { events, binding: () => ({ target: () => ({ getSnapshot }) }) })
  const binding = vi.fn<() => object | undefined>(() => ({}))
  ctx.provide('sessions', { binding })
  const openBundle = vi.fn()
  ctx.provide('pluginNavigation', { openBundle })
  await ctx.plugin(SlotRegistry)
  const slots = ctx.slots
  slots.register({ name: 'root', children: { 'conversation.chat.turnTail': {
    kind: 'list', scope: 'session',
  } } }, (_props: { renderSlot?: unknown }) => null)
  const act = vi.fn().mockResolvedValue({ ok: true, value: { status: 'settled', outcome: 'applied' } })
  const unmount = vi.fn(async () => {})
  ctx.provide('remote', { pluginRecommendations: { act }, $mount: vi.fn(async () => unmount) })
  ctx.provide('remote.pluginRecommendations', { act })
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const fiber = await ctx.plugin({ inject, apply })
  const entry = slots.entries('conversation.chat.turnTail')[0]!
  const resolve = entry.inject as NonNullable<typeof entry.inject> & ((sessionId: SessionId) => RecommendationTailInjected)
  const bound = resolve(SessionId('session-one'))
  bound.openDetails('@deepseek-ai/dsh-experimental-badge-skill-bundle')
  expect(openBundle).toHaveBeenCalledWith('@deepseek-ai/dsh-experimental-badge-skill-bundle')
  expect(bound.keyedHooks.recommendations('3')).toBe(source)
  expect(turnDataSource).toHaveBeenCalledWith(3, 'plugin-recommendation')
  getSnapshot.mockReturnValueOnce(undefined)
  expect(() => bound.keyedHooks.recommendations('3')).toThrow('Chat target is unavailable')
  binding.mockReturnValueOnce(undefined)
  expect(() => resolve(SessionId('missing'))).toThrow('unknown session')
  expect(bound.hooks.chinese.getSnapshot()).toBe(locale.getSnapshot().active.startsWith('zh'))
  const off = bound.hooks.chinese.subscribe(vi.fn())
  off()
  expect(await bound.act(ToolCallId('proposal'), 'enable')).toEqual({ status: 'settled', outcome: 'applied' })
  expect(act).toHaveBeenCalledWith('session-one', 'proposal', 'enable')
  act.mockResolvedValueOnce({ ok: false })
  expect(await bound.act(ToolCallId('proposal'), 'dismiss')).toBeUndefined()
  await fiber.dispose()
  expect(unmount).toHaveBeenCalledOnce()
  expect(slots.entries('conversation.chat.turnTail')).toHaveLength(0)
  vi.spyOn(events, 'register').mockImplementation(() => { throw new Error('registration failed') })
  const failed = ctx.plugin({ inject, apply })
  await expect(failed.await()).rejects.toThrow('registration failed')
  await failed.dispose()
  expect(unmount).toHaveBeenCalledTimes(2)
})

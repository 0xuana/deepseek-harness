/** Real registries validate session binding and HMR removal. */
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { expect, it, onTestFinished, vi } from 'vitest'
import { mountRecommendations, inject } from '../src/client/mount.ts'
const apply = (ctx: Context) => mountRecommendations(ctx, { package: '@deepseek-ai/dsh-experimental-creation-recommendations', descriptors: [] })
import { apply as hostApply } from '../src/index.ts'
import type { CardInjected } from '../src/client/Card.tsx'

it('binds actions to the displayed session and removes registrations on unload', async () => {
  hostApply()
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SlotRegistry)
  const slots = ctx.slots
  slots.register({ name: 'root', children: { 'conversation.chat.turnTail': {
    kind: 'list', scope: 'session',
  } } }, (_props: { renderSlot?: unknown }) => null)
  const act = vi.fn().mockResolvedValue({ ok: true, value: { status: 'accepted' } })
  const unmount = vi.fn(async () => {})
  ctx.provide('remote', { creationRecommendations: { act }, $mount: vi.fn(async () => unmount) })
  ctx.provide('remote.creationRecommendations', { act })
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const fiber = await ctx.plugin({ inject, apply })
  const entry = slots.entries('conversation.chat.turnTail')[0]!
  const resolve = entry.inject as NonNullable<typeof entry.inject> & ((sessionId: SessionId) => CardInjected)
  const bound = resolve(SessionId('session-one'))
  expect(await bound.act(ToolCallId('proposal'), 'create', 'page')).toEqual({ status: 'accepted' })
  expect(act).toHaveBeenCalledWith('session-one', 'proposal', 'create', 'page', undefined)
  await bound.act(ToolCallId('custom'), 'create', 'page', '左侧入口打开日历')
  expect(act).toHaveBeenCalledWith('session-one', 'custom', 'create', 'page', '左侧入口打开日历')
  bound.dismissInfo()
  expect(resolve(SessionId('session-two')).hooks.infoDismissed.getSnapshot()).toBe(true)
  act.mockResolvedValueOnce({ ok: false })
  expect(await bound.act(ToolCallId('proposal'), 'dismiss', 'page')).toBeUndefined()
  await fiber.dispose()
  expect(unmount).toHaveBeenCalledOnce()
  expect(slots.entries('conversation.chat.turnTail')).toHaveLength(0)
  vi.spyOn(locale, 'register').mockImplementation(() => { throw new Error('registration failed') })
  const failed = ctx.plugin({ inject, apply })
  await expect(failed.await()).rejects.toThrow('registration failed')
  await failed.dispose()
  expect(unmount).toHaveBeenCalledTimes(2)
})

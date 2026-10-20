import { expect, it, vi } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { registerActionCard } from '../src/action-cards.ts'
import { fixture } from './fixture.ts'

it('keeps the card contract independent of creation and withdraws it with its plugin', async () => {
  const f = await fixture()
  await f.fiber.dispose()
  const prepared = vi.fn((title: string) => ({ title }))
  const other = await f.ctx.plugin({
    name: 'fixture-card-provider', inject: ['tools', 'agents'],
    apply(ctx) {
      registerActionCard(ctx, {
        name: 'fixture_action', description: 'Fixture proposal; no operation runs.',
        parameters: { title: { type: 'string', required: true } },
        prepare(args) { return prepared(args.title) },
      })
    },
  })
  const callId = ToolCallId('other')
  const execute = (request: unknown) => f.ctx.tools.execute({
    name: 'suggest_action', arguments: { request }, callId, agent: f.agent, signal: new AbortController().signal,
  })
  for (const request of [
    { action: 'unregistered', title: 'Example' },
    { action: 'fixture_action', title: 42 },
    { action: 'fixture_action', title: 'Example', slot: 'page' },
  ]) expect((await execute(request)).isError).toBe(true)
  expect(prepared).not.toHaveBeenCalled()
  const result = await execute({ action: 'fixture_action', title: 'Example' })
  expect(result.isError).toBe(false)
  expect(result.meta).toEqual({ actionCard: { action: 'fixture_action', callId, data: { title: 'Example' } } })
  expect(prepared).toHaveBeenCalledExactlyOnceWith('Example')
  expect(f.startActivation).not.toHaveBeenCalled()
  expect(f.manager.installBundle).not.toHaveBeenCalled()
  expect(f.ctx.tools.get('fixture_action')).toBeUndefined()
  expect(f.ctx.tools.get('suggest_view')).toBeUndefined()
  expect(() => registerActionCard(f.ctx, {
    name: 'invalid', description: '', parameters: { action: { type: 'string' } }, prepare: () => ({}),
  })).toThrow('must not redefine')
  expect((await execute({ action: 'create_personalized_page', title: 'Old', brief: 'Old', slot: 'page' })).isError).toBe(true)
  const queued = f.ctx.tools.get('suggest_action')!
  await other.dispose()
  expect(f.ctx.tools.get('suggest_action')).toBeUndefined()
  f.ctx.tools.register(defineTool({
    name: 'fixture_queued_card', description: '', parameters: {},
    output: { schema: { type: 'json' }, render: () => [] },
    execute: async (_args, exec) => { await queued.execute({ request: { action: 'fixture_action', title: 'Stale' } }, exec); return null },
  }))
  const stale = await f.ctx.tools.execute({ name: 'fixture_queued_card', arguments: {}, callId,
    agent: f.agent, signal: new AbortController().signal })
  expect(stale.isError).toBe(true)
  expect(JSON.stringify(stale.content)).toContain('no longer available')
  expect(prepared).toHaveBeenCalledTimes(1)
})

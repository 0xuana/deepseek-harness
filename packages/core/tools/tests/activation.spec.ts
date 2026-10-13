/** Conditional registrations share request admission with direct and nested execution. */
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool, ToolActivationError } from '@deepseek-ai/dsh-tools'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const agent = { id: SessionId('activation') } as Agent
  const modelSelection = { provider: 'test', model: 'test' }
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, agent) }, { inject: ['tools'] }))
  const controller = new AbortController()
  let calls = 0
  const tool = defineTool({
    name: 'conditional', description: 'A conditional operation.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { calls++; return 'done' },
  })
  const input = { agent, name: tool.name, arguments: {}, callId: ToolCallId('call'), signal: controller.signal }
  const resolve = () => ctx.tools.resolve({ agent, modelSelection, signal: controller.signal })
  return { ctx, agent, modelSelection, scope, controller, tool, input, resolve, calls: () => calls }
}

it('activates and deactivates a registered tool without allowing historical calls', async () => {
  const h = await setup()
  let enabled = false
  h.ctx.tools.register(h.tool, { when: () => enabled })
  const unavailable = await h.resolve()
  expect(h.ctx.tools.schemas(h.agent, unavailable)).toEqual([])
  enabled = true
  expect((await h.ctx.tools.execute({ ...h.input, toolSet: unavailable })).error?.info?.code).toBe('UNKNOWN_TOOL')
  expect((await h.ctx.tools.execute(h.input)).error?.info?.code).toBe('UNKNOWN_TOOL')
  const available = await h.resolve()
  expect(h.ctx.tools.schemas(h.agent, available).map(tool => tool.name)).toEqual(['conditional'])
  expect((await h.ctx.tools.execute({ ...h.input, toolSet: available })).isError).toBe(false)
  enabled = false
  const disabled = await h.resolve()
  expect((await h.ctx.tools.execute({ ...h.input, toolSet: disabled })).error?.info?.code).toBe('UNKNOWN_TOOL')
  expect(h.calls()).toBe(1)
})

it('keeps admissions specific to the requesting agent', async () => {
  const h = await setup()
  h.ctx.tools.register(h.tool, { when: () => true })
  const toolSet = await h.resolve()
  const other = { id: SessionId('other') } as Agent
  expect((await h.ctx.tools.execute({ ...h.input, agent: other, toolSet })).error?.info?.code).toBe('UNKNOWN_TOOL')
  expect(h.calls()).toBe(0)
})

it('applies live restrictions and closes request admission permanently', async () => {
  const h = await setup()
  h.ctx.tools.register(h.tool, { when: () => true })
  const toolSet = await h.resolve()
  const lift = h.scope.ctx.tools.restrict({ deny: ['conditional'] })
  expect((await h.ctx.tools.execute({ ...h.input, toolSet })).error?.info?.code).toBe('UNKNOWN_TOOL')
  lift()
  expect((await h.ctx.tools.execute({ ...h.input, toolSet })).isError).toBe(false)
  toolSet.dispose()
  expect(h.ctx.tools.schemas(h.agent, toolSet)).toEqual([])
  expect((await h.ctx.tools.execute({ ...h.input, toolSet })).error?.info?.code).toBe('UNKNOWN_TOOL')
  expect(h.calls()).toBe(1)
})

it('does not substitute a same-name registration after admission', async () => {
  const h = await setup()
  const unregister = h.ctx.tools.register(h.tool, { when: () => true })
  const old = await h.resolve()
  unregister()
  h.ctx.tools.register(h.tool, { when: () => true })
  expect((await h.ctx.tools.execute({ ...h.input, toolSet: old })).error?.info?.code).toBe('UNKNOWN_TOOL')
  expect((await h.ctx.tools.execute({ ...h.input, toolSet: await h.resolve() })).isError).toBe(false)
  expect(h.calls()).toBe(1)
})

it('does not restore a registration removed during its asynchronous condition', async () => {
  const h = await setup()
  const condition = Promise.withResolvers<boolean>()
  const entered = Promise.withResolvers<undefined>()
  const unregister = h.ctx.tools.register(h.tool, { when: () => { entered.resolve(undefined); return condition.promise } })
  const pending = h.resolve()
  await entered.promise
  unregister()
  condition.resolve(true)
  const toolSet = await pending
  expect(h.ctx.tools.schemas(h.agent, toolSet)).toEqual([])
  expect((await h.ctx.tools.execute({ ...h.input, toolSet })).error?.info?.code).toBe('UNKNOWN_TOOL')
  expect(h.calls()).toBe(0)
})

it('propagates cancellation after an asynchronous condition settles', async () => {
  const h = await setup()
  const condition = Promise.withResolvers<boolean>()
  h.ctx.tools.register(h.tool, { when: ({ modelSelection, signal }) => {
    expect(modelSelection).toBe(h.modelSelection)
    expect(signal).toBe(h.controller.signal)
    return condition.promise
  } })
  const pending = h.resolve()
  const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  h.controller.abort()
  condition.resolve(true)
  await rejection
  expect(h.calls()).toBe(0)
})

it('reports condition failures without treating them as disabled tools', async () => {
  const h = await setup()
  const cause = new Error('credential storage unavailable')
  h.ctx.tools.register(h.tool, { when: () => { throw cause } })
  await expect(h.resolve()).rejects.toMatchObject({
    name: ToolActivationError.name, code: 'TOOL_ACTIVATION_FAILED', cause,
  })
  expect(h.calls()).toBe(0)
})

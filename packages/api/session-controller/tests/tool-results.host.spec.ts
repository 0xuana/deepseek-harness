/** Live tool inspection shares the real Session's unload lifetime, never its replay data. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SessionToolResults } from '../src/tool-results.ts'

async function setup(value: JsonValue = { answer: 42 }) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  const results = new SessionToolResults(ctx)
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'value', description: 'Return a structured value.', parameters: {},
    output: { schema: { type: 'json' }, render: () => [{ type: 'text', text: 'rendered' }] },
    execute: async () => value,
  })))
  await mountAgentLoopTestHarness(ctx)
  let agent!: Agent
  const owner = ctx.plugin({ inject: ['agentLoop'], async apply(inner: Context) {
    agent = await inner.agentLoop.create(SessionId('live-values'))
  } })
  await owner
  const events: SessionEvent[] = []
  ctx.on('session/event', (session, event) => { if (session === agent.session) events.push(event) }, { global: true })
  async function execute() {
    await ctx.tools.execute({
      agent, signal: new AbortController().signal, log: { turn: 1, step: 1 },
      calls: [{ type: 'tool-call', id: ToolCallId('value-call'), name: 'value', arguments: '{}' }],
    })
    const event = events.findLast(event => event.type === 'tool/result')
    if (event === undefined) throw new Error('tool result missing')
    return event
  }
  function watch(seq: number) {
    const abort = new AbortController()
    const iterator = results.watch({ sessionId: agent.session.id, seq }, abort.signal)[Symbol.asyncIterator]()
    onTestFinished(async () => { abort.abort(); await iterator.return?.() })
    return iterator
  }
  return { ctx, results, agent, owner, execute, watch }
}

it.each([null, false, 0, '', { answer: 42 }])('retains final live value %j without adding it to the journal', async (value) => {
  const { execute, watch } = await setup(value)
  const event = await execute()
  expect(event.data).not.toHaveProperty('value')
  expect((await watch(event.seq).next()).value).toEqual({ available: true, value })
})

it('releases values on Session unload and never restores them for a same-id instance', async () => {
  const { ctx, agent, owner, execute, watch } = await setup()
  const event = await execute()
  const first = watch(event.seq)
  expect((await first.next()).value).toEqual({ available: true, value: { answer: 42 } })
  const removed = first.next()
  await owner.dispose()
  expect(ctx.sessions.get(agent.id)).toBeUndefined()
  expect((await removed).value).toEqual({ available: false })
  ctx.sessions.create(agent.id)
  expect((await watch(event.seq).next()).value).toEqual({ available: false })
})

it('observes the final post-policy value and keeps historical and failed results unavailable', async () => {
  const { ctx, execute, watch } = await setup()
  ctx.on('tools/post-execute', async () => ({ kind: 'accept', value: { replacement: true } }))
  const event = await execute()
  expect((await watch(event.seq).next()).value).toEqual({ available: true, value: { replacement: true } })
  expect((await watch(0).next()).value).toEqual({ available: false })
  ctx.on('tools/pre-execute', async () => ({ kind: 'deny', reason: 'denied' }))
  const failed = await execute()
  expect((await watch(failed.seq).next()).value).toEqual({ available: false })
})

it('pairs PTC dispatch values with their committed event sequence', async () => {
  const { ctx, agent, watch } = await setup()
  const callId = ToolCallId('nested:ptc:1')
  await ctx.tools.execute({
    agent, signal: new AbortController().signal,
    calls: [{ type: 'tool-call', id: callId, name: 'value', arguments: '{}' }],
  })
  const event = agent.session.append('tool/ptc-dispatch', {
    rootCallId: ToolCallId('nested'), parentCallId: ToolCallId('nested'), subCallId: callId,
    name: 'value', arguments: {}, content: [{ type: 'text', text: 'rendered' }], isError: false,
  })
  expect(event.data).not.toHaveProperty('value')
  expect((await watch(event.seq).next()).value).toEqual({ available: true, value: { answer: 42 } })
})

it('does not let closing one inspector discard values used by another', async () => {
  const { execute, watch } = await setup()
  const event = await execute()
  const first = watch(event.seq)
  await first.next()
  await first.return?.()
  expect((await watch(event.seq).next()).value).toEqual({ available: true, value: { answer: 42 } })
})

it('publishes a committed value to concurrent observers and releases only the closed observer', async () => {
  const { ctx, agent, watch } = await setup()
  const callId = ToolCallId('observed:ptc:1')
  await ctx.tools.execute({
    agent, signal: new AbortController().signal,
    calls: [{ type: 'tool-call', id: callId, name: 'value', arguments: '{}' }],
  })
  const seq = agent.session.seq
  const first = watch(seq)
  const second = watch(seq)
  expect((await first.next()).value).toEqual({ available: false })
  expect((await second.next()).value).toEqual({ available: false })
  await first.return?.()
  const changed = second.next()
  agent.session.append('tool/ptc-dispatch', {
    rootCallId: ToolCallId('observed'), parentCallId: ToolCallId('observed'), subCallId: callId,
    name: 'value', arguments: {}, content: [{ type: 'text', text: 'rendered' }], isError: false,
  })
  expect((await changed).value).toEqual({ available: true, value: { answer: 42 } })
})

it('keeps cold reads unavailable after unloading a Session with no retained results', async () => {
  const { owner, watch } = await setup()
  await owner.dispose()
  expect((await watch(0).next()).value).toEqual({ available: false })
})

it('ends active observers when the service owner is disposed', async () => {
  const { ctx, execute, watch } = await setup()
  const event = await execute()
  const observer = watch(event.seq)
  await observer.next()
  const finished = observer.next()
  await ctx.fiber.dispose()
  expect((await finished).done).toBe(true)
})

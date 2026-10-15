/** Each proposed step publishes its `agent/model` selection as `agent.step`. */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent, type AgentStep } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

function eventTypes(agent: Agent): string[] {
  return agent.session.snapshotEvents().map(event => event.type)
}

function lastTurnEnd(agent: Agent) {
  const event = agent.session.snapshotEvents().findLast(entry => entry.type === 'turn/end')
  return event?.type === 'turn/end' ? event.data.reason : undefined
}

describe('agent.step', () => {
  it('publishes one frozen selection from agent/model through its step and clears it between steps', async () => {
    const adapter = new MockAdapter([toolCallResponse('c1', 'probe', {}), textResponse('done')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('step-visibility'), { provider: 'mock', model: 'mock' })
    const seen = {
      model: [] as (AgentStep | undefined)[],
      preStep: [] as (AgentStep | undefined)[],
      condition: [] as (AgentStep | undefined)[],
      section: [] as (AgentStep | undefined)[],
      request: [] as (AgentStep | undefined)[],
      execute: [] as (AgentStep | undefined)[],
      stopping: [] as (AgentStep | undefined)[],
    }
    ctx.on('agent/model', async ({ agent: subject }, next) => {
      seen.model.push(subject.step)
      return next()
    })
    ctx.on('agent/pre-step', async ({ agent: subject }, next) => {
      seen.preStep.push(subject.step)
      return next()
    })
    ctx.on('agent/request', async ({ agent: subject }, next) => {
      seen.request.push(subject.step)
      return next()
    })
    ctx.on('agent/turn-stopping', ({ agent: subject }) => { seen.stopping.push(subject.step) })
    ctx.systemPrompt.section({
      name: 'probe',
      order: 0,
      text: (context) => {
        seen.section.push(context.agent?.step)
        return ''
      },
    })
    ctx.tools.register(defineContentToolFixture({
      name: 'probe', description: 'Record the calling step.', parameters: {},
      async execute(_args, exec) {
        seen.execute.push(exec.agent?.step)
        return []
      },
    }), {
      when: ({ agent: subject }) => {
        seen.condition.push(subject.step)
        return true
      },
    })

    send(agent, 'go')
    await agent.whenIdle()

    expect(seen.model).toEqual([undefined, undefined])
    const [first, second] = seen.preStep
    expect(first).toEqual({ modelSelection: { provider: 'mock', model: 'mock' } })
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first?.modelSelection)).toBe(true)
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    for (const phase of [seen.condition, seen.section, seen.request]) {
      expect(phase).toHaveLength(2)
      expect(phase[0]).toBe(first)
      expect(phase[1]).toBe(second)
    }
    expect(seen.execute).toHaveLength(1)
    expect(seen.execute[0]).toBe(first)
    expect(seen.stopping).toEqual([undefined])
    expect(agent.step).toBeUndefined()
  })

  it('clears the selection when a proposal is rejected or fails', async () => {
    const adapter = new MockAdapter([])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('step-cleared'), { provider: 'mock', model: 'mock' })
    let outcome: 'reject' | 'throw' = 'reject'
    ctx.on('agent/pre-step', async (_payload, next) => {
      await next()
      if (outcome === 'throw') throw new Error('pre-step failed')
      return { kind: 'reject' }
    })

    send(agent, 'rejected')
    await agent.whenIdle()
    expect(agent.step).toBeUndefined()
    expect(lastTurnEnd(agent)?.kind).toBe('blocked')

    outcome = 'throw'
    send(agent, 'failed')
    await agent.whenIdle()
    expect(agent.step).toBeUndefined()
    expect(lastTurnEnd(agent)?.kind).toBe('error')
    expect(adapter.requests).toEqual([])
  })
})

describe('agent/model', () => {
  it('runs after the claim and before agent/pre-step once per proposed step', async () => {
    const adapter = new MockAdapter([toolCallResponse('c1', 'noop', {}), textResponse('done')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('model-order'), { provider: 'mock', model: 'mock' })
    ctx.tools.register(defineContentToolFixture({
      name: 'noop', description: 'Do nothing.', parameters: {},
      execute: async () => [],
    }))
    const order: string[] = []
    ctx.on('agent/inbox/claimed', () => { order.push('claimed') })
    ctx.on('agent/model', async ({ step }, next) => {
      order.push(`model:${String(step)}`)
      return next()
    })
    ctx.on('agent/pre-step', async ({ step }, next) => {
      order.push(`pre-step:${String(step)}`)
      return next()
    })

    send(agent, 'go')
    await agent.whenIdle()

    expect(order).toEqual(['claimed', 'model:1', 'pre-step:1', 'model:2', 'pre-step:2'])
  })
})

describe('runtime context admission', () => {
  it('opens no step for a removed wake even when the runtime context changed', async () => {
    const adapter = new MockAdapter([])
    const ctx = await harness(adapter)
    ctx.systemPrompt.context({ name: 'fact', order: 0, text: 'changed' })
    const agent = await ctx.agentLoop.create(SessionId('context-only'), { provider: 'mock', model: 'mock' })
    // The driver claims synchronously on wake, so the insertion observer removes the message first.
    ctx.on('agent/inbox/inserted', ({ agent: subject, message }) => { subject.inbox.remove(message.id) })

    send(agent, 'removed wake')
    await agent.whenIdle()

    expect(adapter.requests).toEqual([])
    expect(eventTypes(agent)).toContain('turn/start')
    expect(eventTypes(agent)).not.toContain('step/start')
    expect(eventTypes(agent)).not.toContain('user/message')
  })
})

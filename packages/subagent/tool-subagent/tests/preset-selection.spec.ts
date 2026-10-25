/** Deployment configuration and model-facing selection for spawn presets. */
import { mountWorkingDirectoryFixture } from '../../subagent/tests/working-directory-fixture.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as tool from '../src/index.ts'
import { SubagentPresetSelection } from '../src/preset-selection.ts'
import { mountScriptedProvider, type Config as ProviderConfig } from './scripted-provider.ts'
import { callSubagent, text } from './harness.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  try {
    for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  } finally {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

async function mountSpawn(ctx: Context, providerName: string): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tool-preset-'))
  roots.push(root)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(SubagentSpawn, { providerName })
}

async function setup(config: Omit<tool.Config, 'provider'>, providerConfig: Partial<ProviderConfig> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, { default: 'writer' })
  const presets = new Map<string, () => Promise<void>>()
  for (const id of ['writer', 'reviewer']) {
    presets.set(id, await ctx.agentPresets.register({ id, description: `${id} persona`, plugins: [] }))
  }
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
  const onStart = vi.fn()
  const provider = await mountScriptedProvider(ctx, {
    name: 'custom-spawn', capabilities: { agentPreset: true }, onStart, ...providerConfig,
  })
  ctx.loader.builtins.subagentTool = tool
  await ctx.loader.root.update([{
    id: 'tool', name: 'cordis:subagentTool', inject: ['agentPresets'],
    config: { provider: 'custom-spawn', ...config },
  }])
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  return { ctx, onStart, provider, presets }
}

const args = { description: 'review task', prompt: 'Review this change.' }

describe('spawn preset selection', () => {
  it.each([false, true])('selects presets with modelSelection=%s and enforces route authorization', async (modelSelection) => {
    const { ctx, onStart } = await setup({
      allowedAgentPresets: ['writer', 'reviewer'],
      modelSelection,
    })
    const schema = ctx.tools.schemas().find(schema => schema.name === 'subagent')
    expect(JSON.stringify(schema)).toContain('agent_preset')
    expect(schema).toHaveProperty('parameters.properties.agent_preset.enum', ['writer', 'reviewer'])
    expect(schema?.parameters.properties).toHaveProperty('agent_preset')
    expect(Object.hasOwn(schema!.parameters.properties!, 'model')).toBe(modelSelection)
    expect((await callSubagent(ctx, { ...args, agent_preset: 'reviewer' })).isError).not.toBe(true)
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({
      agentPreset: 'reviewer',
    }))
    const rejected = await callSubagent(ctx, {
      ...args, agent_preset: 'reviewer', provider: 'unapproved', model: 'unapproved',
    })
    expect(rejected.isError).toBe(true)
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('uses a default without exposing a model selector', async () => {
    const { ctx, onStart } = await setup({ agentPreset: 'reviewer' })
    expect(JSON.stringify(ctx.tools.schemas())).not.toContain('agent_preset')
    await callSubagent(ctx, args)
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ agentPreset: 'reviewer' }))
    const forced = await callSubagent(ctx, { ...args, agent_preset: 'writer' })
    expect(forced.isError).toBe(true)
    expect(text(forced)).toContain('selection is disabled')
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it.each([{}, { allowedAgentPresets: ['writer', 'reviewer'] }])('preserves inheritance when no default or argument is supplied: %j', async (config) => {
    const { ctx, onStart } = await setup(config)
    await callSubagent(ctx, args)
    expect(onStart.mock.calls[0]?.[0]).not.toHaveProperty('agentPreset')
  })

  it('uses the default when a selectable argument is omitted and rejects unlisted ids', async () => {
    const { ctx, onStart } = await setup({ agentPreset: 'reviewer', allowedAgentPresets: ['writer', 'reviewer'] })
    await callSubagent(ctx, args)
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ agentPreset: 'reviewer' }))
    expect((await callSubagent(ctx, { ...args, agent_preset: 'absent' })).isError).toBe(true)
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it.each([
    { allowedAgentPresets: [] },
    { allowedAgentPresets: ['writer', 'writer'] },
    { allowedAgentPresets: [''] },
    { agentPreset: 'writer', allowedAgentPresets: ['reviewer'] },
    { agentPreset: '' },
  ])('rejects invalid deployment choices before registration: %j', async (config) => {
    await expect(setup(config)).rejects.toThrow()
  })

  it.each([
    { inheritsParentContext: true },
    { capabilities: { agentPreset: false } },
  ])('rejects providers that cannot independently compose a child: %j', async (providerConfig) => {
    await expect(setup({ agentPreset: 'reviewer' }, providerConfig)).rejects.toThrow(/independent agent preset/)
  })

  it('rejects forced selection at the model JSON resolver', () => {
    const selection = new SubagentPresetSelection({ allowedAgentPresets: ['writer'] })
    expect(() => selection.resolve({ agent_preset: 'unlisted' })).toThrow(/must be one of/)
    expect(() => selection.resolve({ agent_preset: 1 })).toThrow(/must be one of/)
  })

  it('requires the preset service when selection is configured', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await expect(tool.apply(ctx, { provider: 'spawn', agentPreset: 'writer' })).rejects.toThrow(/requires the agent-presets service/)
  })

  it.each([
    { config: { agentPreset: 'absent' }, selection: {} },
    { config: { allowedAgentPresets: ['absent'] }, selection: { agent_preset: 'absent' } },
  ])('reports a missing preset only when delegation uses it: %j', async ({ config, selection }) => {
    const { ctx, provider } = await setup(config)
    await provider.dispose()
    await mountSpawn(ctx, 'custom-spawn')
    const parent = await ctx.agents.create({ sessionId: SessionId('missing-child-preset') })
    const sessions = ctx.sessions.list()
    const result = await callSubagent(ctx, { ...args, ...selection }, { agent: parent.agent })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('Unknown agent preset: absent')
    expect(ctx.agents.list()).toEqual([parent.agent])
    expect(ctx.sessions.list()).toEqual(sessions)
  })

  it('reports an unloadable child preset through the tool result', async () => {
    const { ctx, presets, provider } = await setup({ agentPreset: 'reviewer' })
    await provider.dispose()
    await mountSpawn(ctx, 'custom-spawn')
    await presets.get('reviewer')!()
    await ctx.agentPresets.register({
      id: 'reviewer', plugins: [{ name: 'cordis:missing-plugin' }],
    })
    const parent = await ctx.agents.create({ sessionId: SessionId('broken-child-preset') })
    const sessions = ctx.sessions.list()
    const result = await callSubagent(ctx, args, { agent: parent.agent })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('missing-plugin')
    expect(ctx.agents.list()).toEqual([parent.agent])
    expect(ctx.sessions.list()).toEqual(sessions)
  })

  it('creates an Agent from a preset whose delegation tool selects itself', async () => {
    const { ctx } = await setup({})
    await ctx.agentPresets.register({
      id: 'self', description: 'Self-selected composition.',
      plugins: [{
        name: 'cordis:subagentTool',
        config: { provider: 'custom-spawn', toolName: 'self_delegate', allowedAgentPresets: ['self'] },
      }],
    })
    const handle = await ctx.agents.create({
      sessionId: SessionId('self-selecting-preset'),
      setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'self') },
    })
    const schema = ctx.tools.schemas(handle.agent).find(schema => schema.name === 'self_delegate')
    expect(schema).toHaveProperty('parameters.properties.agent_preset.enum', ['self'])
  })

  it.each([
    ['alpha', 'beta'], ['beta', 'alpha'],
  ])('creates Agents from mutually selecting presets registered in %s/%s order', async (first, second) => {
    const { ctx } = await setup({})
    for (const id of [first, second]) {
      const other = id === 'alpha' ? 'beta' : 'alpha'
      await ctx.agentPresets.register({
        id, description: `${id} composition.`,
        plugins: [{
          name: 'cordis:subagentTool',
          config: { provider: 'custom-spawn', toolName: 'peer_delegate', allowedAgentPresets: [other] },
        }],
      })
    }
    for (const id of [first, second]) {
      const other = id === 'alpha' ? 'beta' : 'alpha'
      const handle = await ctx.agents.create({
        sessionId: SessionId(`mutually-selecting-${id}`),
        setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, id) },
      })
      const schema = ctx.tools.schemas(handle.agent).find(schema => schema.name === 'peer_delegate')
      expect(schema).toHaveProperty('parameters.properties.agent_preset.enum', [other])
    }
  })

  it('shares each preset tool across Agents and repeated round trips', async () => {
    const { ctx } = await setup({})
    const declarations = new Map<string, () => Promise<void>>()
    for (const id of ['standard', 'ptc']) {
      declarations.set(id, await ctx.agentPresets.register({
        id,
        plugins: [{ name: 'cordis:subagentTool', config: {
          provider: 'custom-spawn', toolName: 'shared_delegate', allowedAgentPresets: ['reviewer'],
        } }],
      }))
    }
    const create = (id: string, preset: string) => ctx.agents.create({
      sessionId: SessionId(id),
      setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, preset) },
    })
    const [standard, moving] = await Promise.all([
      create('shared-standard', 'standard'), create('shared-moving', 'standard'),
    ])
    const ptc = await create('shared-ptc', 'ptc')
    const expected = {
      standard: ctx.tools.get('shared_delegate', standard.agent),
      ptc: ctx.tools.get('shared_delegate', ptc.agent),
    }
    expect(expected.standard).toBeDefined()
    expect(expected.ptc).toBeDefined()
    expect(expected.standard).not.toBe(expected.ptc)
    expect(ctx.tools.get('shared_delegate', moving.agent)).toBe(expected.standard)
    for (const preset of ['ptc', 'standard', 'ptc', 'standard'] as const) {
      await ctx.agentPresets.select(moving.agent, preset)
      expect(ctx.tools.get('shared_delegate', moving.agent)).toBe(expected[preset])
    }
    await standard.dispose()
    expect(ctx.tools.get('shared_delegate', moving.agent)).toBe(expected.standard)
    const lease = await ctx.agentPresets.acquireScope('standard')
    const key = lease.key
    await lease[Symbol.asyncDispose]()
    await declarations.get('standard')!()
    expect(ctx.tools.get('shared_delegate', moving.agent)).toBe(expected.standard)
    await moving.dispose()
    expect(ctx.tools.get('shared_delegate', key)).toBeUndefined()
    expect(ctx.tools.get('shared_delegate', ptc.agent)).toBe(expected.ptc)
  })

  it('switches to a preset with a missing child reference and retries delegation after declaration', async () => {
    const { ctx } = await setup({})
    await mountSpawn(ctx, 'spawn')
    await ctx.agentPresets.register({
      id: 'pending-reference',
      plugins: [{ name: 'cordis:subagentTool', config: {
        provider: 'spawn', agentPreset: 'later',
      } }],
    })
    const lease = await ctx.agentPresets.acquireScope('pending-reference')
    const definition = ctx.tools.get('subagent', lease.key)
    expect(definition).toBeDefined()
    await lease[Symbol.asyncDispose]()
    const handle = await ctx.agents.create({
      sessionId: SessionId('retry-preset'),
      agentOptions: { provider: 'mock', model: 'mock' },
      setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'writer') },
    })
    await ctx.agentPresets.select(handle.agent, 'pending-reference')
    expect(ctx.tools.get('subagent', handle.agent)).toBe(definition)
    expect(ctx.agentPresets.presetForSession(handle.agent.session)).toBe('pending-reference')
    const failed = await callSubagent(ctx, args, { agent: handle.agent })
    expect(failed.isError).toBe(true)
    expect(text(failed)).toContain('Unknown agent preset: later')

    await ctx.agentPresets.register({ id: 'later', plugins: [] })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('reviewed')]))
    // Completion notices must not consume the response scripted for the child.
    ctx.on('agent/pre-step', async ({ agent }, next) => agent === handle.agent ? { kind: 'reject' } : next())
    const retried = await callSubagent(ctx, args, { agent: handle.agent })
    expect(retried.isError).not.toBe(true)
    expect(text(retried)).toContain('started subagent')
    await ctx.subagents.waitForChildren(handle.agent)
    expect(ctx.tools.get('subagent', handle.agent)).toBe(definition)
  })
})

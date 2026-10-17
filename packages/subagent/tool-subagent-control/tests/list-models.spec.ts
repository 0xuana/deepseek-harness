import AgentRegistry from '@deepseek-ai/dsh-agent'
import { mountWorkingDirectoryFixture } from '../../subagent/tests/working-directory-fixture.ts'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  ToolCallId,
  LlmAdapter,
  ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as tool from '@deepseek-ai/dsh-tool-subagent'
import * as ControlTools from '@deepseek-ai/dsh-tool-subagent-control'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentModelSelectionConfig from '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
import { modelSelectionSetupAgent, ownContext, setup, testToolSignal, text } from '../../tool-subagent/tests/harness.ts'

class CatalogAdapter extends LlmAdapter {
  constructor(private readonly empty = false) {
    super()
  }

  override providerInfo(provider: string) {
    return { id: provider, name: `${provider.toUpperCase()} API` }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    if (this.empty) return Promise.resolve([])
    return Promise.resolve([
      { provider, id: 'fast', name: 'Fast', description: 'Focused work.' },
      { provider, id: 'plain', name: 'Plain' },
    ])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (model === 'plain') return Promise.resolve({ provider, id: model, name: 'Plain' })
    return Promise.resolve({
      provider,
      id: model,
      name: 'Fast',
      description: 'Focused work.',
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('low'), name: 'Low' },
          { id: ReasoningEffortId('high'), name: 'High', description: 'Quality first.' },
        ],
        defaultEffort: ReasoningEffortId('high'),
      },
    })
  }

  stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    return (async function* () { yield { type: 'finish' as const, reason: { kind: 'stop' as const } } })()
  }
}

const callingAgents = new WeakMap<Context, Agent>()

async function setupListTool(routes = [
  { provider: 'alpha', model: 'fast' },
  { provider: 'alpha', model: 'plain' },
  { provider: 'beta', model: 'fast' },
  { provider: 'beta', model: 'plain' },
]) {
  const ctx = ownContext(new Context())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentModelSelectionConfig, { enabled: true, allowedModels: routes })
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(ControlTools)
  const { agent } = await ctx.agents.create({ sessionId: SessionId('discovery-parent') })
  callingAgents.set(ctx, agent)
  return ctx
}

async function setupAllowedListTool() {
  return setupListTool([
    { provider: 'alpha', model: 'fast' },
    { provider: 'alpha', model: 'unlisted' },
    { provider: 'missing', model: 'hidden' },
  ])
}

let counter = 0

function call(ctx: Context, args: unknown, signal = testToolSignal) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId(`list-models-${++counter}`),
    name: 'list_subagent_models',
    arguments: args,
    ...callingAgents.has(ctx) ? { agent: callingAgents.get(ctx)! } : {},
  })
}

describe('list_subagent_models', () => {
  it('registers and disposes all four shared tools independently of delegation tools', async () => {
    const ctx = ownContext(new Context())
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await mountWorkingDirectoryFixture(ctx)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(tool, { provider: 'unused' })
    expect(ctx.tools.get('list_subagent_models')).toBeUndefined()
    await ctx.plugin(AgentRegistry)
    const discovery = await ctx.plugin(ControlTools)
    const names = ['send_message', 'interrupt_agent', 'list_agents', 'list_subagent_models']
    for (const name of names) expect(ctx.tools.schemas().filter(schema => schema.name === name)).toHaveLength(1)
    await discovery.dispose()
    for (const name of names) expect(ctx.tools.get(name)).toBeUndefined()
    const reloaded = await ctx.plugin(ControlTools)
    for (const name of names) expect(ctx.tools.schemas().filter(schema => schema.name === name)).toHaveLength(1)
    await reloaded.dispose()
    await ctx.fiber.dispose()
  })

  it('requires a calling Agent and an effective parent route', async () => {
    const ctx = ownContext(new Context())
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await mountWorkingDirectoryFixture(ctx)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(ControlTools)
    expect(text(await call(ctx, {}))).toContain('requires a calling agent')
    await ctx.fiber.dispose()

    const parentContext = await setup({ provider: 'mock', withModelSelection: true, hostSelectionEnabled: false })
    const agent = modelSelectionSetupAgent(parentContext)
    const result = await parentContext.tools.execute({
      signal: testToolSignal, callId: ToolCallId('missing-parent-route'),
      name: 'list_subagent_models', arguments: {}, agent,
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('without a parent provider and model')
  })

  it('reads the recorded Session allowlist through the shared control plugin', async () => {
    const ctx = await setup({ provider: 'mock', withModelSelection: true })
    ctx.llm.registerAdapter(['alpha', 'secret'], new CatalogAdapter())
    const result = await ctx.tools.execute({
      signal: testToolSignal, callId: ToolCallId('recorded-routes'),
      name: 'list_subagent_models', arguments: {}, agent: modelSelectionSetupAgent(ctx),
    })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('alpha — ALPHA API')
  })

  it('stays registered without the LLM service and rejects discovery calls', async () => {
    const parent = await setupListTool()
    const ctx = ownContext(new Context())
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await mountWorkingDirectoryFixture(ctx)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(ControlTools)
    callingAgents.set(ctx, callingAgents.get(parent)!)
    expect(ctx.tools.get('list_subagent_models')).toBeDefined()
    const result = await call(ctx, {})
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('`llm` service is unavailable')
  })

  it('lists registered providers and follows live registration changes', async () => {
    const ctx = await setupListTool()
    const empty = await call(ctx, {})
    expect(empty.isError).toBe(false)
    expect(text(empty)).toBe('(no LLM providers)')

    const registration = ctx.llm.registerAdapter(['alpha'], new CatalogAdapter())
    const providers = await call(ctx, {})
    expect(providers.isError).toBe(false)
    expect(text(providers)).toBe('alpha — ALPHA API')

    registration.replace(['beta'])
    const changed = await call(ctx, {})
    expect(text(changed)).toBe('beta — BETA API')

    const tools = ctx.tools
    await ctx.fiber.dispose()
    expect(tools.get('list_subagent_models')).toBeUndefined()
  })

  it('lists one provider\'s advertised models without treating the catalog as a whitelist', async () => {
    const ctx = await setupListTool()
    ctx.llm.registerAdapter(['alpha'], new CatalogAdapter())
    const result = await call(ctx, { provider: 'alpha' })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('alpha/fast — Fast: Focused work.\nalpha/plain — Plain')
  })

  it('intersects provider and model discovery with the Session allowlist', async () => {
    const ctx = await setupAllowedListTool()
    ctx.llm.registerAdapter(['alpha', 'beta'], new CatalogAdapter())

    expect(text(await call(ctx, {}))).toBe('alpha — ALPHA API')
    expect(text(await call(ctx, { provider: 'alpha' }))).toBe('alpha/fast — Fast: Focused work.')
    expect(text(await call(ctx, { provider: 'alpha', model: 'unlisted' })))
      .toContain('alpha/unlisted — Fast')

    const denied = await call(ctx, { provider: 'alpha', model: 'plain' })
    expect(denied.isError).toBe(true)
    expect(text(denied)).toContain('is not allowed for this Session')
  })

  it('rejects an unauthorized provider before calling its adapter catalog', async () => {
    const ctx = await setupListTool([{ provider: 'alpha', model: 'fast' }])
    const adapter = new CatalogAdapter()
    const listModels = vi.spyOn(adapter, 'listModels')
    ctx.llm.registerAdapter(['alpha', 'secret'], adapter)

    const result = await call(ctx, { provider: 'secret' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('provider "secret" is not allowed for this Session')
    expect(listModels).not.toHaveBeenCalled()
  })

  it('returns an empty list when the catalog contains no authorized model', async () => {
    const ctx = await setupListTool([{ provider: 'alpha', model: 'unlisted' }])
    ctx.llm.registerAdapter(['alpha'], new CatalogAdapter())
    const result = await call(ctx, { provider: 'alpha' })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('(no advertised models for alpha)')
  })

  it('lists authorized catalog entries without resolving removed or unlisted models', async () => {
    const ctx = await setupListTool([
      { provider: 'alpha', model: 'removed' },
      { provider: 'alpha', model: 'plain' },
    ])
    try {
      const adapter = new CatalogAdapter()
      const resolveModel = vi.spyOn(adapter, 'resolveModel').mockRejectedValue(new Error('lookup unavailable'))
      ctx.llm.registerAdapter(['alpha'], adapter)

      const result = await call(ctx, { provider: 'alpha' })
      expect(result.isError).toBe(false)
      expect(text(result)).toBe('alpha/plain — Plain')
      expect(resolveModel).not.toHaveBeenCalled()

      const exact = await call(ctx, { provider: 'alpha', model: 'removed' })
      expect(exact.isError).toBe(true)
      expect(text(exact)).toContain('lookup unavailable')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects a failed catalog lookup', async () => {
    const ctx = await setupListTool()
    try {
      const adapter = new CatalogAdapter()
      vi.spyOn(adapter, 'listModels').mockRejectedValue(new Error('catalog unavailable'))
      ctx.llm.registerAdapter(['alpha'], adapter)
      const result = await call(ctx, { provider: 'alpha' })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('catalog unavailable')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects cancellation after a catalog lookup', async () => {
    const ctx = await setupListTool()
    try {
      const controller = new AbortController()
      const adapter = new CatalogAdapter()
      vi.spyOn(adapter, 'listModels').mockImplementation(async () => {
        controller.abort(new Error('discovery cancelled'))
        return []
      })
      ctx.llm.registerAdapter(['alpha'], adapter)
      const result = await call(ctx, { provider: 'alpha' }, controller.signal)
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('discovery cancelled')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it.each([false, true])('resolves only the current parent model without a Session policy (empty catalog: %s)', async (empty) => {
    const ctx = await setup({
      provider: 'mock',
      withModelSelection: true,
      hostSelectionEnabled: false,
      parentAgentOptions: { provider: 'alpha', model: 'unlisted' },
    })
    const adapter = new CatalogAdapter(empty)
    const listModels = vi.spyOn(adapter, 'listModels')
    ctx.llm.registerAdapter(['alpha'], adapter)
    const result = await ctx.tools.execute({
      signal: testToolSignal, callId: ToolCallId('parent-only-discovery'),
      name: 'list_subagent_models', arguments: { provider: 'alpha' }, agent: modelSelectionSetupAgent(ctx),
    })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('alpha/unlisted — Fast: Focused work.')
    expect(listModels).not.toHaveBeenCalled()
  })

  it('inspects exact-model efforts, descriptions, and defaults', async () => {
    const ctx = await setupListTool()
    ctx.llm.registerAdapter(['alpha', 'secret'], new CatalogAdapter())
    const result = await call(ctx, { provider: 'alpha', model: 'fast' })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe(
      'alpha/fast — Fast: Focused work.\nReasoning efforts:\n'
      + 'low — Low\nhigh (default) — High: Quality first.',
    )
  })

  it('renders exact models without reasoning metadata', async () => {
    const ctx = await setupListTool()
    ctx.llm.registerAdapter(['alpha'], new CatalogAdapter())
    const result = await call(ctx, { provider: 'alpha', model: 'plain' })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('alpha/plain — Plain\nReasoning efforts:\n(no advertised reasoning efforts)')
  })

  it.each([
    { args: { model: 'fast' }, expected: '`model` requires `provider`' },
    { args: { provider: '' }, expected: '`provider` must be non-empty' },
    { args: { provider: 'missing' }, expected: 'is not allowed for this Session' },
  ])('rejects incomplete or unavailable provider requests', async ({ args, expected }) => {
    const ctx = await setupListTool()
    const result = await call(ctx, args)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(expected)
  })

  it('rejects an empty exact model after resolving the provider', async () => {
    const ctx = await setupListTool()
    ctx.llm.registerAdapter(['alpha'], new CatalogAdapter())
    const result = await call(ctx, { provider: 'alpha', model: '' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('`model` must be non-empty')
  })

  it('reports registered alternatives for an unavailable provider', async () => {
    const ctx = await setupListTool([
      { provider: 'alpha', model: 'fast' },
      { provider: 'missing', model: 'fast' },
    ])
    ctx.llm.registerAdapter(['alpha'], new CatalogAdapter())
    const result = await call(ctx, { provider: 'missing' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('available providers: alpha')
    expect(text(result)).not.toContain('secret')
  })

  it('reports no available provider when the authorized registry intersection is empty', async () => {
    const ctx = await setupListTool([{ provider: 'missing', model: 'fast' }])
    const result = await call(ctx, { provider: 'missing' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('available providers: (none)')
  })
})

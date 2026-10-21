import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LlmAttemptId } from '@deepseek-ai/dsh-llm/brand'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type {
  AssistantLiveChunkEvent, SessionEventLike, SessionEventLikeEntry,
  SessionLiveEventEntry, SessionTransientEventEntry,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ConversationContextReader, ConversationLocation, ConversationMatch,
  ConversationNodeContext, ConversationNodeDefinition, ConversationStartMatch,
  ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { en, NS, zh } from '../src/client/locales.ts'
import type {
  PerfCall, PerfContribution, PerfSnapshot, PerfStepMetrics, PerfStepState, PerfViewNode,
} from '../src/client/perf-contract.ts'
import { resetCurrentTurn, resetPtcSteps } from '../src/client/perf-fold.ts'
import { TARGET } from '../src/client/perf-definition.ts'
import { PerfView } from '../src/client/PerfView.tsx'
import {
  EMPTY_PERF_SNAPSHOT, perfViewDefinition, registerPerfConversationView,
} from '../src/client/perf-snapshot-builder.ts'
import { apply as clientApply, inject as clientInject } from '../src/client/index.ts'
import type { PerfViewInjected } from '../src/client/PerfView.tsx'
import { apply as hostApply } from '../src/index.ts'

const SID = 'perf-session' as SessionId

let seq = 0

/**
 * One durable session event with a deterministic sequence and time. Payloads
 * are fixtures, so this is where the test stops type-checking them.
 */
function event(type: string, data: unknown, time?: number): SessionEvent {
  seq += 1
  return { type, seq: SessionSeq(seq), time: time ?? 1_000 + seq, data } as SessionEvent
}

/** One durable window entry. */
function entry(event: SessionEvent): SessionLiveEventEntry {
  return { type: 'event', event }
}

/** One client-only live chunk entry. */
function transient(turn: number, step: number, chunk: StreamChunk, time?: number): SessionTransientEventEntry {
  seq += 1
  const chunkEvent: AssistantLiveChunkEvent = {
    type: 'assistant/live-chunk',
    seq,
    time: time ?? 1_000 + seq,
    data: { attemptId: LlmAttemptId('attempt-1'), turn, step, chunk },
  }
  return { type: 'transient', event: chunkEvent }
}

/** The text delta one live chunk reports. */
const delta: StreamChunk = { type: 'text-delta', index: 0, text: 'x' }

/** Usage reported by one assistant message. */
const usage = { inputTokens: 100, outputTokens: 40, cacheReadTokens: 400, cacheWriteTokens: 100 }

/** A compact assistant stream whose first token arrives `at` milliseconds. */
function stream(at: number): readonly { readonly type: 'chunk'; readonly time: number; readonly chunk: StreamChunk }[] {
  return [
    { type: 'chunk', time: at - 100, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
    { type: 'chunk', time: at, chunk: delta },
  ]
}

/** A definition registry over the Definitions captured from registration. */
class TestEventDefinitions {
  constructor(readonly definitions: readonly ConversationNodeDefinition[]) {}

  entries(): readonly ConversationNodeDefinition[] {
    return this.definitions
  }

  fallbackEntry(): ConversationNodeDefinition | undefined {
    return undefined
  }
}

/** A view registry over the builders captured from registration. */
class TestViewDefinitions {
  constructor(readonly definitions: readonly ConversationViewDefinition[]) {}

  entries(): readonly ConversationViewDefinition[] {
    return this.definitions
  }
}

/** Assembler that activates every registered target, like the Conversation store. */
class PerfAssembler extends ConversationNodeAssembler {
  constructor(events: TestEventDefinitions, views: TestViewDefinitions) {
    super(events, views)
    for (const view of views.entries()) this.activateTarget(view.target)
  }
}

/** Recorded browser-plugin surface: locale, Definitions, views, and the injected source. */
interface PluginBench {
  readonly ctx: Context
  readonly fiber: { dispose(): Promise<void> }
  readonly localeDispose: ReturnType<typeof vi.fn>
  readonly events: readonly ConversationNodeDefinition[]
  readonly views: readonly ConversationViewDefinition[]
  readonly localeRegister: ReturnType<typeof vi.fn>
  readonly binding: ReturnType<typeof vi.fn>
  readonly entries: () => readonly StoredEntry[]
  readonly setSnapshot: (next: PerfSnapshot | undefined) => void
  readonly notify: () => void
}

/** Mount the browser plugin on a real Cordis context with stub services. */
async function mountPlugin(): Promise<PluginBench> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const events: ConversationNodeDefinition[] = []
  const views: ConversationViewDefinition[] = []
  let snapshot: PerfSnapshot | undefined
  let listener: (() => void) | undefined
  const localeDispose = vi.fn()
  const localeRegister = vi.fn(() => localeDispose)
  const binding = vi.fn(() => ({
    target: () => ({
      getSnapshot: () => snapshot,
      subscribe: (next: () => void) => {
        listener = next
        return () => { listener = undefined }
      },
    }),
  }))
  ctx.provide('locale', { register: localeRegister, bind: () => makeTranslate(zh) } as never)
  ctx.provide('uiConversation', {
    binding,
    events: {
      register: (definition: ConversationNodeDefinition) => {
        events.push(definition)
        return () => undefined
      },
    },
    views: {
      register: (definition: ConversationViewDefinition) => {
        views.push(definition)
        return () => undefined
      },
    },
  } as never)
  ctx.slots.register({
    name: 'root',
    children: { 'conversation.view': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...clientInject], apply: clientApply })
  await fiber.await()
  return {
    ctx,
    fiber,
    localeDispose,
    events,
    views,
    localeRegister,
    binding,
    entries: () => ctx.slots.entries('conversation.view'),
    setSnapshot: (next) => { snapshot = next },
    notify: () => { listener?.() },
  }
}

/** Run one assembler window and return the published perf snapshot. */
function assemble(
  definitions: readonly ConversationNodeDefinition[],
  entries: readonly SessionEventLikeEntry[],
  options: { readonly upserts?: readonly SessionEventLikeEntry[] } = {},
): PerfSnapshot | undefined {
  const assembler = new PerfAssembler(
    new TestEventDefinitions(definitions),
    new TestViewDefinitions([perfViewDefinition]),
  )
  assembler.replaceWindow(entries, false)
  assembler.flush()
  for (const record of options.upserts ?? []) {
    assembler.append(record)
    assembler.flush()
  }
  return assembler.get(TARGET)
}

/** The Definitions captured by one plugin registration. */
async function registeredDefinitions(): Promise<readonly ConversationNodeDefinition[]> {
  resetCurrentTurn()
  resetPtcSteps()
  const bench = await mountPlugin()
  const definitions = bench.events
  await bench.fiber.dispose()
  return definitions
}

/** One measured step metrics value. */
function measuredStep(turn: number, step: number, startTime: number, endTime: number): PerfStepMetrics {
  const call: PerfCall = {
    callId: 'call-1',
    seq: 2,
    name: 'read',
    hint: 'b/c.ts',
    chars: 7,
    lines: 2,
    error: false,
    added: null,
    removed: null,
    before: null,
    after: null,
    args: '{"file_path":"/a/b/c.ts"}',
    inner: false,
    text: 'one\ntwo',
    truncated: false,
    ms: 200,
  }
  return {
    turn,
    step,
    startTime,
    endTime,
    context: 600,
    ttft: 100,
    model: 400,
    decode: 300,
    tps: 40 / 0.3,
    output: 40,
    tool: 200,
    tools: [{ name: 'read', count: 1 }],
    calls: [call],
    toolOutput: 7,
    retries: 0,
    toolErrors: 0,
    cacheRead: 400,
    cacheWrite: 100,
    cacheHit: 400 / 600,
    wall: endTime - startTime,
    toolPending: 0,
    running: false,
    interrupted: false,
    aborted: false,
  }
}

/** One view node carrying the given contribution. */
function node(key: string, data: PerfContribution): PerfViewNode {
  return {
    key,
    kind: key.split(':')[0] ?? key,
    id: key,
    target: TARGET,
    anchorSeq: 0,
    location: { kind: 'unresolved' },
    data,
  }
}

/** A start-role match for one event. */
function startMatch(event: SessionEventLike): ConversationStartMatch {
  return { event, role: 'start', location: { kind: 'unresolved' } }
}

/** An update-role match for one event. */
function updateMatch(event: SessionEventLike): ConversationMatch {
  return { event, role: 'update', location: { kind: 'unresolved' } }
}

/** The reader a start callback receives; the perf Definitions read no predecessors. */
const reader: ConversationContextReader = { previous: () => undefined }

/** One hand-built Definition context. */
function contextOf(
  definition: ConversationNodeDefinition<PerfStepState>,
  state: PerfStepState | undefined,
  matches: readonly ConversationMatch[] = [],
  start?: ConversationStartMatch,
): ConversationNodeContext<PerfStepState> {
  return {
    key: `${definition.kind}:fixture`,
    kind: definition.kind,
    id: 'fixture',
    matches,
    start,
    state,
    current: new Map(),
  }
}

describe('browser plugin registration', () => {
  it('registers the performance tab, dictionaries, Definitions, and view target', async () => {
    const bench = await mountPlugin()
    expect(bench.localeRegister).toHaveBeenCalledWith(NS, { zh, en })
    expect(bench.events.map(definition => definition.kind)).toEqual([
      'perf-step', 'perf-prompt', 'perf-turn-end',
    ])
    expect(bench.views).toEqual([perfViewDefinition])
    expect(bench.entries()).toHaveLength(1)
    const registered = bench.entries()[0]!
    expect(registered.component).toBe(PerfView)
    expect(registered.options).toMatchObject({ id: 'perf', order: 40 })
    expect(registered.locale).toBe(NS)
    expect(resolveSlotLabel(registered.options.label)).toBe('性能')
    await bench.fiber.dispose()
    expect(bench.entries()).toEqual([])
    // The dictionary registration rides the plugin fiber effect; Definitions and
    // view targets dispose through their own registries in the wiring suites.
    expect(bench.localeDispose).toHaveBeenCalledTimes(1)
  })

  it('serves the empty snapshot until the target publishes turns', async () => {
    const bench = await mountPlugin()
    const injectEntry = bench.entries()[0]!.inject as ((sessionId: SessionId) => PerfViewInjected) | undefined
    expect(injectEntry).toBeDefined()
    const injected = injectEntry!(SID)
    expect(bench.binding).toHaveBeenCalledWith(SID)
    expect(injected.hooks.perf.getSnapshot()).toBe(EMPTY_PERF_SNAPSHOT)
    const published: PerfSnapshot = { turns: [], stepCount: 0 }
    bench.setSnapshot(published)
    expect(injected.hooks.perf.getSnapshot()).toBe(published)
    const listener = vi.fn()
    const unsubscribe = injected.hooks.perf.subscribe(listener)
    bench.notify()
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    await bench.fiber.dispose()
  })
})

describe('host entry', () => {
  it('contributes no host-side behavior', () => {
    expect(() => { hostApply() }).not.toThrow()
  })
})

describe('locale dictionaries', () => {
  it('ships the same key set in both languages', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(Object.values(en).every(value => value !== '')).toBe(true)
    expect(en['view.perf']).toBe('Performance')
    expect(en['page.info']).toContain('{page}')
  })
})

describe('snapshot builder', () => {
  it('starts empty and turns step nodes into turn rows', () => {
    const builder = perfViewDefinition.create()
    expect(builder.empty).toBe(EMPTY_PERF_SNAPSHOT)
    const empty = builder.replace({ nodes: [], timeline: { turnOrder: [], turns: new Map() } })
    expect(empty).toEqual({ turns: [], stepCount: 0 })
    const snapshot = builder.replace({
      nodes: [node('perf-step:1:1', { kind: 'step', metrics: measuredStep(1, 1, 1_000, 1_800) })],
      timeline: { turnOrder: [1], turns: new Map() },
    })
    expect(snapshot.turns).toHaveLength(1)
    expect(snapshot.turns[0]?.steps).toHaveLength(1)
    expect(snapshot.stepCount).toBe(1)
  })

  it('keeps the current snapshot for an empty incremental batch', () => {
    const builder = perfViewDefinition.create()
    const first = builder.apply({ upserts: [], timeline: { turnOrder: [], turns: new Map() } })
    expect(first).toBe(EMPTY_PERF_SNAPSHOT)
    expect(builder.apply({ upserts: [], timeline: { turnOrder: [], turns: new Map() } })).toBe(first)
    const upserted = builder.apply({
      upserts: [
        node('perf-prompt:1:0', { kind: 'prompt', turn: 1, prompt: '问', images: 2 }),
        node('perf-step:1:1', { kind: 'step', metrics: measuredStep(1, 1, 1_000, 1_800) }),
        node('perf-turn-end:1:100000', { kind: 'end', turn: 1, closeKind: 'completed', endTime: 1_800 }),
      ],
      timeline: { turnOrder: [1], turns: new Map() },
    })
    expect(upserted.turns[0]?.prompt).toBe('问')
    expect(upserted.stepCount).toBe(1)
  })

  it('registers its target through the conversation view registry', () => {
    const register = vi.fn(() => () => undefined)
    const ctx = new Context()
    ctx.provide('uiConversation', { views: { register } } as never)
    registerPerfConversationView(ctx)
    expect(register).toHaveBeenCalledWith(perfViewDefinition)
  })
})

describe('conversation Definitions', () => {
  it('publishes one prompt, one step, and one turn end from a live window', async () => {
    const definitions = await registeredDefinitions()
    const snapshot = assemble(definitions, [
      entry(event('turn/start', { turn: 1 })),
      entry(event('user/message', {
        role: 'user', id: 'u1', content: [{ type: 'text', text: '看看这个' }, { type: 'image' }], source: { kind: 'user' },
      })),
      entry(event('step/start', { turn: 1, step: 1 }, 2_000)),
      transient(1, 1, delta, 2_100),
      entry(event('assistant/message', {
        turn: 1,
        step: 1,
        message: { id: 'm1', role: 'assistant', content: [], source: { provider: 'p', model: 'm' } },
        stream: stream(2_300),
        usage,
      }, 2_400)),
      entry(event('tool/call', {
        turn: 1, step: 1, callId: 'call-1', name: 'read', arguments: '{"file_path":"/a/b/c.ts"}',
      }, 2_500)),
      entry(event('tool/result', {
        turn: 1, step: 1, message: { role: 'tool', content: [{ type: 'text', text: 'one\ntwo' }], source: { callId: 'call-1' } },
      }, 2_700)),
      entry(event('step/end', { turn: 1, step: 1 }, 2_800)),
      entry(event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 2_800)),
    ])
    expect(snapshot?.turns).toHaveLength(1)
    expect(snapshot?.stepCount).toBe(1)
    const turn = snapshot!.turns[0]!
    expect(turn.prompt).toBe('看看这个')
    expect(turn.promptImages).toBe(1)
    expect(turn.interrupted).toBe(false)
    expect(turn.steps[0]?.startTime).toBe(2_000)
    expect(turn.steps[0]?.calls).toHaveLength(1)
    expect(turn.steps[0]?.toolOutput).toBe(7)
  })

  it('closes an interrupted tail whose last step never ended', async () => {
    const definitions = await registeredDefinitions()
    const snapshot = assemble(definitions, [
      entry(event('turn/start', { turn: 2 })),
      entry(event('step/start', { turn: 2, step: 1 }, 5_000)),
      transient(2, 1, delta, 5_100),
      entry(event('turn/end', { turn: 2, reason: { kind: 'interrupted' } }, 5_800)),
    ])
    const turn = snapshot!.turns[0]!
    expect(turn.interrupted).toBe(true)
    expect(turn.steps[0]?.endTime).toBe(5_800)
    expect(turn.steps[0]?.wall).toBe(800)
    expect(turn.steps[0]?.aborted).toBe(true)
    expect(turn.steps[0]?.running).toBe(false)
  })

  it('closes a turn whose reason carries no kind', async () => {
    const definitions = await registeredDefinitions()
    const snapshot = assemble(definitions, [
      entry(event('turn/start', { turn: 3 })),
      entry(event('step/start', { turn: 3, step: 1 }, 6_000)),
      entry(event('step/end', { turn: 3, step: 1 }, 6_200)),
      entry(event('turn/end', { turn: 3, reason: {} }, 6_200)),
    ])
    expect(snapshot!.turns[0]?.interrupted).toBe(false)
  })

  it('folds a trimmed window from the update events it still holds', async () => {
    const definitions = await registeredDefinitions()
    const snapshot = assemble(definitions, [
      entry(event('user/message', {
        role: 'user', id: 'u2', content: [{ type: 'text', text: '问题' }], source: { kind: 'user' },
      })),
      entry(event('assistant/message', {
        turn: 4,
        step: 1,
        message: { id: 'm2', role: 'assistant', content: [], source: { provider: 'p', model: 'm' } },
        stream: stream(7_300),
        usage,
      }, 7_400)),
      entry(event('tool/call', {
        turn: 4, step: 1, callId: 'call-2', name: 'grep', arguments: '{"pattern":"x","include":"*.ts"}',
      }, 7_500)),
      entry(event('tool/result', {
        turn: 4, step: 1, message: { role: 'tool', content: [{ type: 'text', text: 'hit' }], source: { callId: 'call-2' } },
      }, 7_600)),
    ])
    expect(snapshot?.turns).toHaveLength(1)
    const step = snapshot!.turns[0]!.steps[0]!
    expect(step.startTime).toBeNull()
    expect(step.context).toBe(600)
    expect(step.tools).toEqual([{ name: 'grep', count: 1 }])
    expect(snapshot!.turns[0]!.prompt).toBeNull()
  })

  it('attributes Code-Mode dispatch events through the root call table', async () => {
    const definitions = await registeredDefinitions()
    const snapshot = assemble(definitions, [
      entry(event('turn/start', { turn: 5 })),
      entry(event('step/start', { turn: 5, step: 1 }, 8_000)),
      entry(event('tool/call', { turn: 5, step: 1, callId: 'root-1', name: 'run_code', arguments: '{}' }, 8_100)),
      entry(event('tool/ptc-dispatch-start', {
        rootCallId: 'root-1', parentCallId: 'root-1', subCallId: 'sub-1', name: 'grep', arguments: '{"pattern":"x"}',
      }, 8_200)),
      entry(event('tool/ptc-dispatch', {
        rootCallId: 'root-1', parentCallId: 'root-1', subCallId: 'sub-1', name: 'grep',
        arguments: '{"pattern":"x"}', isError: false, content: [{ type: 'text', text: 'hit' }],
      }, 8_300)),
      entry(event('step/end', { turn: 5, step: 1 }, 8_400)),
      entry(event('turn/end', { turn: 5, reason: { kind: 'completed' } }, 8_400)),
    ])
    const step = snapshot!.turns[0]!.steps[0]!
    expect(step.calls).toHaveLength(1)
    expect(step.calls[0]?.inner).toBe(true)
    expect(step.calls[0]?.name).toBe('grep')
    expect(step.tools).toEqual([{ name: 'grep', count: 1 }])
  })

  it('incrementally applies the live tail after the window', async () => {
    const definitions = await registeredDefinitions()
    const snapshot = assemble(
      definitions,
      [entry(event('turn/start', { turn: 6 })), entry(event('step/start', { turn: 6, step: 1 }, 9_000))],
      {
        upserts: [
          entry(event('assistant/message', {
            turn: 6,
            step: 1,
            message: { id: 'm3', role: 'assistant', content: [], source: { provider: 'p', model: 'm' } },
            stream: stream(9_300),
            usage,
          }, 9_400)),
          entry(event('step/end', { turn: 6, step: 1 }, 9_500)),
        ],
      },
    )
    expect(snapshot?.stepCount).toBe(1)
    expect(snapshot!.turns[0]!.steps[0]!.ttft).toBe(300)
  })

  it('reports a prompt Definition only after a turn start', async () => {
    const definitions = await registeredDefinitions()
    const prompt = definitions[1] as ConversationNodeDefinition<PerfStepState>
    const user = event('user/message', {
      role: 'user', id: 'u3', content: [{ type: 'text', text: '无轮次' }], source: { kind: 'user' },
    })
    expect(prompt.match(user)).toBeNull()
    resetCurrentTurn()
    expect(prompt.match(event('turn/start', { turn: 9 }))).toEqual({ id: '9:0', role: 'start' })
    const state = prompt.start(
      contextOf(prompt, undefined),
      startMatch(event('turn/start', { turn: 9 })),
      reader,
    )
    expect(state.turn).toBe(9)
    expect(state.mark).toBe('prompt')
  })

  it('ignores user messages that are not typed prompts', async () => {
    const definitions = await registeredDefinitions()
    const prompt = definitions[1] as ConversationNodeDefinition<PerfStepState>
    const turnStart = event('turn/start', { turn: 10 })
    const promptState = prompt.start(
      contextOf(prompt, undefined),
      startMatch(turnStart),
      reader,
    )
    const runtime = event('user/message', {
      role: 'user', id: 'u4', content: [{ type: 'text', text: '<system-reminder>' }], source: { kind: 'runtime-context' },
    })
    expect(prompt.match(runtime)).toBeNull()
    expect(prompt.match(event('user/message', { role: 'user', id: 'u5', content: [] }))).toBeNull()
    expect(prompt.match(event('step/start', { turn: 10, step: 1 }))).toBeNull()
    const typed = event('user/message', {
      role: 'user', id: 'u6', content: [{ type: 'text', text: '继续' }], source: { kind: 'user' },
    })
    expect(prompt.match(typed)).toEqual({ id: '10:0', role: 'update' })
    const context: ConversationNodeContext<PerfStepState> & { readonly state: PerfStepState } = {
      ...contextOf(prompt, promptState, [updateMatch(typed)]),
      state: promptState,
    }
    expect(prompt.update(context, updateMatch(typed)).prompt).toBe('继续')
  })

  it('rejects a start callback handed the wrong lifecycle event', async () => {
    const definitions = await registeredDefinitions()
    const wrong = updateMatch(event('assistant/message', { turn: 1, step: 1 }))
    for (const definition of definitions) {
      expect(() => definition.start(
        contextOf(definition as ConversationNodeDefinition<PerfStepState>, undefined),
        wrong as ConversationStartMatch,
        reader,
      )).toThrow(/requires/)
    }
  })

  it('publishes no view node for a Context without state or evidence', async () => {
    const definitions = await registeredDefinitions()
    for (const definition of definitions) {
      expect(definition.buildViewNode!(contextOf(definition as ConversationNodeDefinition<PerfStepState>, undefined))).toBeNull()
    }
  })

  it('names the update cadence of live chunks and start events', async () => {
    const definitions = await registeredDefinitions()
    const step = definitions[0] as ConversationNodeDefinition<PerfStepState>
    expect(step.publication!(startMatch(event('step/start', { turn: 1, step: 1 })))).toBe('none')
    expect(step.publication!(updateMatch(transient(1, 1, delta).event))).toBe('none')
    expect(step.publication!(updateMatch(event('assistant/attempt', { turn: 1, step: 1 })))).toBe('none')
    expect(step.publication!(updateMatch(event('step/end', { turn: 1, step: 1 })))).toBe('immediate')
    const prompt = definitions[1] as ConversationNodeDefinition<PerfStepState>
    expect(prompt.publication!(startMatch(event('turn/start', { turn: 1 })))).toBe('none')
    expect(prompt.publication!(updateMatch(event('user/message', {
      role: 'user', id: 'u', content: [], source: { kind: 'user' },
    })))).toBe('immediate')
  })

  it('anchors and locates a step node from its folded state', async () => {
    const definitions = await registeredDefinitions()
    const step = definitions[0] as ConversationNodeDefinition<PerfStepState>
    const startEvent = event('step/start', { turn: 11, step: 2 }, 11_000)
    const start = startMatch(startEvent)
    const update = updateMatch(event('assistant/message', {
      turn: 11,
      step: 2,
      message: { id: 'm', role: 'assistant', content: [], source: { provider: 'p', model: 'm' } },
      stream: stream(11_300),
      usage,
    }, 11_400))
    const state = step.start(
      contextOf(step, undefined),
      start,
      reader,
    )
    const folded = step.update(
      {
        ...contextOf(step, state, [start, update], start),
        state,
      },
      update,
    )
    const withStart = step.buildViewNode!({
      ...contextOf(step, folded, [start, update], start),
    }) as PerfViewNode
    expect(withStart.anchorSeq).toBe(startEvent.seq)
    expect(withStart.location).toEqual({ kind: 'unresolved' })
    expect(withStart.data.kind).toBe('step')
    const contribution = withStart.data
    if (contribution.kind !== 'step') throw new Error('expected a step contribution')
    expect(contribution.metrics.context).toBe(600)

    // Without a start match, the node anchors at 0 and takes the last match location.
    const stepLocation: ConversationLocation = {
      kind: 'step',
      turn: {
        turn: 11,
        start: undefined,
        end: undefined,
        status: 'open',
        steps: [],
        data: { get: () => undefined, source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) },
      },
      step: {
        turn: 11,
        step: 2,
        start: undefined,
        end: undefined,
        status: 'unknown',
        data: { get: () => undefined, source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) },
      },
    }
    const trimmed = step.buildViewNode!({
      ...contextOf(step,
        { ...folded, startSeq: null }, [{ ...update, location: stepLocation }]),
    }) as PerfViewNode
    expect(trimmed.anchorSeq).toBe(0)
    expect(trimmed.location).toEqual(stepLocation)
    const unresolved = step.buildViewNode!({
      ...contextOf(step, { ...folded, startSeq: null }, []),
    }) as PerfViewNode
    expect(unresolved.location).toEqual({ kind: 'unresolved' })
  })

  it('matches every step lifecycle event by turn and step', async () => {
    const definitions = await registeredDefinitions()
    const step = definitions[0] as ConversationNodeDefinition<PerfStepState>
    const cases: readonly [SessionEventLike, string][] = [
      [event('step/start', { turn: 12, step: 3 }), '12:3'],
      [event('step/end', { turn: 12, step: 3 }), '12:3'],
      [event('assistant/attempt', { turn: 12, step: 3 }), '12:3'],
      [event('assistant/message', { turn: 12, step: 3 }), '12:3'],
      [event('llm/retry', { turn: 12, step: 3 }), '12:3'],
      [event('tool/call', { turn: 12, step: 3, callId: 'c', name: 'read', arguments: '{}' }), '12:3'],
      [event('tool/result', { turn: 12, step: 3, message: { role: 'tool', content: [] } }), '12:3'],
      [transient(12, 3, delta).event, '12:3'],
    ]
    for (const [fixture, id] of cases) {
      expect(step.match(fixture)?.id).toBe(id)
    }
    expect(step.match(event('developer/message', { turn: 12, step: 3 }))).toBeNull()
    // A dispatch with no recorded root call owns no step.
    expect(step.match(event('tool/ptc-dispatch', {
      rootCallId: 'missing', parentCallId: 'missing', subCallId: 's',
      name: 'grep', arguments: '{}', isError: false, content: [],
    }))).toBeNull()
  })

  it('builds prompt and end markers from their folded states', async () => {
    const definitions = await registeredDefinitions()
    const prompt = definitions[1] as ConversationNodeDefinition<PerfStepState>
    const promptStart = startMatch(event('turn/start', { turn: 13 }))
    const promptState = prompt.start(
      contextOf(prompt, undefined),
      promptStart,
      reader,
    )
    const promptNode = prompt.buildViewNode!({
      ...contextOf(prompt, promptState, [], promptStart),
    }) as PerfViewNode
    expect(promptNode.data).toMatchObject({ kind: 'prompt', turn: 13 })
    const end = definitions[2] as ConversationNodeDefinition<PerfStepState>
    const endStart = startMatch(event('turn/end', { turn: 13, reason: { kind: 'interrupted' } }, 13_500))
    const ended = end.start(
      contextOf(end, undefined),
      endStart,
      reader,
    )
    expect(ended.closed).toBe(true)
    expect(ended.closeKind).toBe('interrupted')
    const endNode = end.buildViewNode!({
      ...contextOf(end, ended, [], endStart),
    }) as PerfViewNode
    expect(endNode.data).toEqual({ kind: 'end', turn: 13, closeKind: 'interrupted', endTime: 13_500 })
    expect(end.match(event('step/start', { turn: 13, step: 1 }))).toBeNull()
  })

  it('anchors marker nodes at zero without a recorded start', async () => {
    const definitions = await registeredDefinitions()
    const prompt = definitions[1] as ConversationNodeDefinition<PerfStepState>
    const promptState = prompt.start(
      contextOf(prompt, undefined),
      startMatch(event('turn/start', { turn: 14 })),
      reader,
    )
    const promptNode = prompt.buildViewNode!({
      ...contextOf(prompt, promptState),
    }) as PerfViewNode
    expect(promptNode.anchorSeq).toBe(0)
    const end = definitions[2] as ConversationNodeDefinition<PerfStepState>
    const endState = end.start(
      contextOf(end, undefined),
      startMatch(event('turn/end', { turn: 14, reason: { kind: 'completed' } }, 14_500)),
      reader,
    )
    const endContext: ConversationNodeContext<PerfStepState> & { readonly state: PerfStepState } = {
      ...contextOf(end, endState),
      state: endState,
    }
    expect(end.update(
      endContext,
      updateMatch(event('turn/end', { turn: 14, reason: { kind: 'completed' } })),
    )).toBe(endState)
    const endNode = end.buildViewNode!({
      ...contextOf(end, endState),
    }) as PerfViewNode
    expect(endNode.anchorSeq).toBe(0)
  })
})

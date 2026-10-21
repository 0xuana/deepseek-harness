import { describe, expect, it } from 'vitest'
import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'
import type { AssistantStreamRecord, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionEventType } from '@deepseek-ai/dsh-session/types'
import { aggregateTurn, buildTurns } from '../src/client/perf-aggregate.ts'
import {
  currentTurnOf, foldEvent, newState, resetCurrentTurn, resetPtcSteps, stepMetrics,
} from '../src/client/perf-fold.ts'
import {
  DASH, barShare, formatChars, formatClock, formatDateTime, formatMs, formatPercent,
  formatTokens, formatTokensDelta, formatTokensShort, formatTps,
} from '../src/client/perf-format.ts'
import type { PerfStepMetrics, PerfStepState, PerfViewNode } from '../src/client/perf-contract.ts'
import {
  cacheHitRate, contextTokens, isCount, isUsage, outputTokens,
} from '../src/client/perf-usage.ts'

let seq = 0

/** One durable session event with a deterministic sequence and time. */
function event(type: SessionEventType, data: object, time?: number): SessionEventLike {
  const at = time ?? 1_000 + (seq += 1) * 10
  return { type, seq: SessionSeq(seq), time: at, data } as SessionEventLike
}

/** Narrow a folded state the fixture guarantees exists. */
function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a folded state')
  return value
}

/** One client-only live chunk event. */
function chunk(turn: number, step: number, value: StreamChunk, time?: number): SessionEventLike {
  seq += 1
  return {
    type: 'assistant/live-chunk',
    seq,
    time: time ?? 1_000 + seq * 10,
    data: { attemptId: 'attempt-1', turn, step, chunk: value },
  } as SessionEventLike
}

/** A token delta chunk. */
const delta: StreamChunk = { type: 'text-delta', index: 0, text: 'x' }

/** Usage reported by one assistant message. */
const usage = {
  inputTokens: 100,
  outputTokens: 40,
  cacheReadTokens: 400,
  cacheWriteTokens: 100,
}

/** A compact assistant stream recording the first token at `time`. */
function stream(firstTokenAt: number): AssistantStreamRecord[] {
  return [
    { type: 'chunk', time: firstTokenAt - 100, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
    { type: 'chunk', time: firstTokenAt, chunk: delta },
  ] as AssistantStreamRecord[]
}

/** Build a step state across a start, a stream, a message, one tool call, and an end. */
function completedStep(turn: number, step: number, startTime = 1_000): ReturnType<typeof stepMetrics> {
  resetPtcSteps()
  resetCurrentTurn()
  let state = foldEvent(undefined, event('step/start', { turn, step }, startTime))
  state = foldEvent(state, chunk(turn, step, delta, startTime + 100))
  state = foldEvent(state, event('assistant/message', {
    turn,
    step,
    message: { id: 'm', role: 'assistant', content: [], source: { provider: 'p', model: 'm' } },
    stream: stream(startTime + 300),
    usage,
  }, startTime + 400))
  state = foldEvent(state, event('tool/call', {
    turn, step, callId: 'call-1', name: 'read', arguments: JSON.stringify({ file_path: '/a/b/c.ts' }),
  }, startTime + 500))
  state = foldEvent(state, event('tool/result', {
    turn,
    step,
    message: { role: 'tool', content: [{ type: 'text', text: 'one\ntwo' }], source: { callId: 'call-1' } },
  }, startTime + 700))
  state = foldEvent(state, event('step/end', { turn, step }, startTime + 800))
  return stepMetrics(defined(state))
}

describe('format helpers', () => {
  it('formats durations at each scale boundary', () => {
    expect(formatMs(null)).toBe(DASH)
    expect(formatMs(999)).toBe('999 ms')
    expect(formatMs(1_000)).toBe('1.00 s')
    expect(formatMs(59_999)).toBe('60.00 s')
    expect(formatMs(60_000)).toBe('1.0 min')
  })

  it('keeps two decimals below one thousand tokens', () => {
    expect(formatTokensShort(null)).toBe(DASH)
    expect(formatTokensShort(30)).toBe('0.03K')
    expect(formatTokensShort(1_500)).toBe('1.5K')
    expect(formatTokensDelta(250)).toBe('+0.25K')
    expect(formatTokensDelta(-730)).toBe('−0.73K')
    expect(formatTokensDelta(null)).toBe('')
    expect(formatTokens(1_234_567)).toBe('1,234,567')
  })

  it('formats characters, speed, and percent', () => {
    expect(formatChars(null)).toBe(DASH)
    expect(formatChars(0)).toBe(DASH)
    expect(formatChars(12)).toBe('12')
    expect(formatChars(1_234)).toBe('1.2K')
    expect(formatTps(268.94)).toBe('268.9')
    expect(formatTps(null)).toBe(DASH)
    expect(formatPercent(0.962)).toBe('96.20%')
    expect(formatPercent(null)).toBe(DASH)
  })

  it('formats the clock from the same instant it is given', () => {
    const time = new Date(2026, 9, 20, 3, 4, 5).getTime()
    expect(formatClock(time)).toBe('03:04:05')
    expect(formatDateTime(time)).toBe('2026-10-20 03:04:05')
    expect(formatClock(null)).toBe(DASH)
    expect(formatDateTime(null)).toBe(DASH)
  })

  it('scales bars by square root of the group maximum', () => {
    expect(barShare(10, 0)).toBe(1)
    expect(barShare(0, 100)).toBe(0)
    expect(barShare(100, 100)).toBe(1)
    expect(barShare(25, 100)).toBe(0.5)
    expect(barShare(200, 100)).toBe(1)
  })
})

describe('usage helpers', () => {
  it('sums the prompt length and derives cache hit', () => {
    expect(isUsage(null)).toBe(false)
    expect(isUsage(usage)).toBe(true)
    expect(isCount(-1)).toBe(false)
    expect(contextTokens(usage)).toBe(600)
    expect(contextTokens(null)).toBeNull()
    expect(outputTokens(usage)).toBe(40)
    expect(cacheHitRate(usage)).toBeCloseTo(400 / 600)
    expect(cacheHitRate({})).toBeNull()
    expect(cacheHitRate({ inputTokens: 0 })).toBeNull()
  })
})

describe('step folding and metrics', () => {
  it('derives timeline, throughput, tool cost, and cache columns', () => {
    const metrics = completedStep(1, 1)
    expect(metrics.startTime).toBe(1_000)
    expect(metrics.endTime).toBe(1_800)
    expect(metrics.ttft).toBe(100)
    expect(metrics.model).toBe(400)
    expect(metrics.decode).toBe(300)
    expect(metrics.tps).toBeCloseTo(40 / 0.3)
    expect(metrics.tool).toBe(200)
    expect(metrics.toolPending).toBe(0)
    expect(metrics.wall).toBe(800)
    expect(metrics.context).toBe(600)
    expect(metrics.output).toBe(40)
    expect(metrics.cacheHit).toBeCloseTo(400 / 600)
    expect(metrics.running).toBe(false)
    expect(metrics.aborted).toBe(false)
    expect(metrics.tools).toEqual([{ name: 'read', count: 1 }])
    expect(metrics.toolOutput).toBe(7)
    expect(metrics.calls[0]?.hint).toBe('b/c.ts')
  })

  it('keeps a running step measurable up to the last event', () => {
    resetPtcSteps()
    const start = foldEvent(undefined, event('step/start', { turn: 2, step: 1 }, 5_000))
    const metrics = stepMetrics(defined(start))
    expect(metrics.running).toBe(true)
    expect(metrics.ttft).toBeNull()
    expect(metrics.wall).toBeNull()
    expect(metrics.context).toBeNull()
  })

  it('reports an unsettled step as aborted', () => {
    resetPtcSteps()
    let state = foldEvent(undefined, event('step/start', { turn: 2, step: 1 }, 5_000))
    state = foldEvent(state, chunk(2, 1, delta, 5_100))
    state = foldEvent(state, event('step/end', { turn: 2, step: 1 }, 5_200))
    expect(stepMetrics(defined(state)).aborted).toBe(true)
  })

  it('counts retries, tool errors, and unpaired results', () => {
    resetPtcSteps()
    let state: PerfStepState | undefined = newState(3, 1)
    state = foldEvent(state, event('llm/retry', {
      turn: 3, step: 1, failure: { message: 'rate limited' }, retry: 1, delayMs: 10, mode: 'normal', maxRetries: 3,
    }))
    state = foldEvent(state, event('tool/result', {
      turn: 3, step: 1, message: { role: 'tool', content: [], isError: true, source: { callId: 'ghost' } },
    }))
    const metrics = stepMetrics(defined(state))
    expect(metrics.retries).toBe(1)
    expect(metrics.toolErrors).toBe(1)
    expect(metrics.toolPending).toBe(1)
  })

  it('groups Code-Mode inner calls and hides the runner', () => {
    resetPtcSteps()
    let state = foldEvent(undefined, event('step/start', { turn: 4, step: 1 }, 7_000))
    state = foldEvent(state, event('tool/call', {
      turn: 4, step: 1, callId: 'run-1', name: 'run_code', arguments: '{}',
    }, 7_010))
    state = foldEvent(state, event('tool/ptc-dispatch-start', {
      rootCallId: 'run-1', parentCallId: 'run-1', subCallId: 'sub-1', name: 'grep', arguments: '{"pattern":"x"}',
    }, 7_020))
    state = foldEvent(state, event('tool/ptc-dispatch', {
      rootCallId: 'run-1', parentCallId: 'run-1', subCallId: 'sub-1', name: 'grep',
      arguments: '{"pattern":"x"}', isError: false, content: [{ type: 'text', text: 'hit' }],
    }, 7_030))
    const metrics = stepMetrics(defined(state))
    expect(metrics.tools).toEqual([{ name: 'grep', count: 1 }])
    expect(metrics.calls).toHaveLength(1)
    expect(metrics.calls[0]?.inner).toBe(true)
    expect(metrics.calls[0]?.ms).toBe(10)
    expect(metrics.toolOutput).toBe(3)
  })

  it('attributes inner calls through the root call map', () => {
    resetPtcSteps()
    let state = foldEvent(undefined, event('step/start', { turn: 5, step: 2 }, 7_000))
    state = foldEvent(state, event('tool/call', { turn: 5, step: 2, callId: 'root', name: 'run_code', arguments: '{}' }))
    expect(currentTurnOf()).toBeNull()
    state = foldEvent(state, event('tool/ptc-dispatch', {
      rootCallId: 'root', parentCallId: 'root', subCallId: 's', name: 'read',
      arguments: '{"file_path":"/x/y.js"}', isError: true, content: [],
    }))
    const metrics = stepMetrics(defined(state))
    expect(metrics.turn).toBe(5)
    expect(metrics.step).toBe(2)
    expect(metrics.toolErrors).toBe(1)
  })

  it('records the user question only from user-sourced messages', () => {
    resetPtcSteps()
    resetCurrentTurn()
    let state = foldEvent(undefined, event('turn/start', { turn: 6 }))
    expect(currentTurnOf()).toBe(6)
    state = foldEvent(state, event('user/message', {
      role: 'user',
      id: 'u1',
      content: [{ type: 'text', text: '帮我看看' }, { type: 'image' }],
      source: { kind: 'user' },
    }))
    expect(state!.prompt).toBe('帮我看看')
    expect(state!.images).toBe(1)
    // A second question never overwrites the first.
    state = foldEvent(state, event('user/message', {
      role: 'user', id: 'u2', content: [{ type: 'text', text: '再问一次' }], source: { kind: 'user' },
    }))
    expect(state!.prompt).toBe('帮我看看')
    // Injected context is not a question.
    state = foldEvent(state, event('user/message', {
      role: 'user', id: 'u3', content: [{ type: 'text', text: '<system-reminder>' }], source: { kind: 'runtime-context' },
    }))
    expect(state!.prompt).toBe('帮我看看')
  })
})

describe('turn aggregation', () => {
  it('sums first-token waits and reports partial coverage', () => {
    const one = completedStep(7, 1, 10_000)
    const two = completedStep(7, 2, 11_000)
    const partial: PerfStepMetrics = { ...one, ttft: null }
    const turn = aggregateTurn(7, [one, two])
    expect(turn.ttft).toBe(200)
    expect(turn.ttftPending).toBe(0)
    expect(turn.model).toBe(800)
    expect(turn.tool).toBe(400)
    expect(turn.wall).toBe(two.endTime! - one.startTime!)
    expect(turn.context).toBe(600)
    const lower = aggregateTurn(7, [one, partial])
    expect(lower.ttft).toBe(100)
    expect(lower.ttftPending).toBe(1)
    expect(aggregateTurn(7, [{ ...one, ttft: null }]).ttft).toBeNull()
  })
})

describe('turn grouping', () => {
  /** Wrap one step metrics value in the node envelope the builder receives. */
  function stepNode(metrics: PerfStepMetrics): PerfViewNode {
    return {
      key: `${metrics.turn}:${metrics.step}`,
      kind: 'perf-step',
      id: `${metrics.turn}:${metrics.step}`,
      target: 'perf',
      anchorSeq: metrics.startTime ?? 0,
      location: { kind: 'unresolved' },
      data: { kind: 'step', metrics },
    }
  }

  it('groups steps into ordered turns with the question and markers', () => {
    const one = completedStep(8, 1, 20_000)
    const two = completedStep(8, 2, 21_000)
    const open: PerfStepMetrics = {
      ...completedStep(9, 1, 30_000),
      endTime: null,
      wall: null,
      running: true,
    }
    const nodes: PerfViewNode[] = [
      stepNode(two),
      stepNode(one),
      stepNode(open),
      {
        key: '8:0',
        kind: 'perf-prompt',
        id: '8:0',
        target: 'perf',
        anchorSeq: 1,
        location: { kind: 'unresolved' },
        data: { kind: 'prompt', turn: 8, prompt: '问题', images: 2 },
      },
      {
        key: '9:100000',
        kind: 'perf-turn-end',
        id: '9:100000',
        target: 'perf',
        anchorSeq: 2,
        location: { kind: 'unresolved' },
        data: { kind: 'end', turn: 9, closeKind: 'interrupted', endTime: 31_000 },
      },
    ]
    const turns = buildTurns(nodes)
    expect(turns.map(turn => turn.turn)).toEqual([8, 9])
    expect(turns[0]?.steps.map(step => step.step)).toEqual([1, 2])
    expect(turns[0]?.prompt).toBe('问题')
    expect(turns[0]?.promptImages).toBe(2)
    // The interrupted turn closes its last step at the turn-end time.
    expect(turns[1]?.interrupted).toBe(true)
    expect(turns[1]?.steps[0]?.endTime).toBe(31_000)
    expect(turns[1]?.steps[0]?.wall).toBe(1_000)
    expect(turns[1]?.steps[0]?.running).toBe(false)
    expect(turns[1]?.steps[0]?.aborted).toBe(true)
  })

  it('never leaves a step running when a later step exists', () => {
    const running = { ...completedStep(10, 1, 40_000), running: true }
    const next = completedStep(10, 2, 41_000)
    const turns = buildTurns([stepNode(running), stepNode(next)])
    expect(turns[0]?.steps[0]?.running).toBe(false)
    expect(turns[0]?.steps[1]?.running).toBe(false)
  })

  it('drops the empty step an interruption appends', () => {
    const one = completedStep(11, 1, 50_000)
    const empty = {
      ...one,
      step: 2,
      context: null,
      ttft: null,
      model: null,
      tool: null,
      toolPending: 0,
      tools: [],
      wall: 0,
    }
    const turns = buildTurns([
      stepNode(one),
      stepNode(empty),
      {
        key: '11:100000',
        kind: 'perf-turn-end',
        id: '11:100000',
        target: 'perf',
        anchorSeq: 2,
        location: { kind: 'unresolved' },
        data: { kind: 'end', turn: 11, closeKind: 'interrupted', endTime: 51_000 },
      },
    ])
    expect(turns[0]?.steps).toHaveLength(1)
    expect(turns[0]?.steps[0]?.wall).not.toBeNull()
  })
})

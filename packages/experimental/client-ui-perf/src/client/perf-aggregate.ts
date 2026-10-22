/** Turn aggregation over the step metrics a window holds. */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {
  PerfCall, PerfContribution, PerfStepMetrics, PerfToolCount, PerfTurnMetrics, PerfViewNode,
} from './perf-contract.ts'
import { CALL_LIMIT, isCodeMode, toolSpanUnion } from './perf-fold.ts'
import { isNumber } from './perf-usage.ts'

/** One Code-Mode root call's inner contribution, before merging into its step. */
type InnerContribution = Extract<PerfContribution, { kind: 'inner' }>

/** Empty image list shared by turns whose trigger attached no image. */
const NO_IMAGES: readonly ImageAttachmentRef[] = []

/** The trigger that opened one turn, kept from the highest-priority source. */
interface TurnTrigger {
  readonly text: string
  readonly images: readonly ImageAttachmentRef[]
  readonly source: string
}

/** Human prompts outrank automation context; ties keep the first message. */
function triggerRank(source: string): number {
  switch (source) {
    case 'user': return 4
    case 'agent-message': return 3
    case 'subagent-settled': return 2
    case 'goal': return 1
    default: return 0
  }
}

/** Context measured last in the turn: steps without usage keep the previous value. */
function turnContext(steps: readonly PerfStepMetrics[]): number | null {
  let context: number | null = null
  for (const step of steps) if (isNumber(step.context)) context = step.context
  return context
}

/** Cache breakdown measured last in the turn, from the same step whose hit rate the row shows. */
function turnCache(steps: readonly PerfStepMetrics[]): { read: number | null; write: number | null } {
  let read: number | null = null
  let write: number | null = null
  for (const step of steps) {
    if (!isNumber(step.cacheHit)) continue
    read = step.cacheRead
    write = step.cacheWrite
  }
  return { read, write }
}

/** Tool tallies by descending count; ties keep call order. */
function tallyCalls(calls: readonly PerfCall[]): PerfToolCount[] {
  const counts = new Map<string, number>()
  for (const call of calls) {
    if (call.name === null) continue
    counts.set(call.name, (counts.get(call.name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count)
}

/**
 * Merge the Code-Mode dispatches of one step into its row. The runner call
 * disappears in favor of the real tools, so the row shows what the code called
 * and the characters those results pushed into the next prompt.
 * @param step - step row folded from native events only.
 * @param inner - the step's Code-Mode contributions.
 * @returns the merged row, or the original when no dispatch was recorded.
 */
function mergeInnerCalls(step: PerfStepMetrics, inner: readonly InnerContribution[]): PerfStepMetrics {
  if (inner.length === 0) return step
  const innerCalls = inner.flatMap(contribution => contribution.calls)
  const calls = [
    ...step.calls.filter(call => !isCodeMode(call.name)),
    ...innerCalls,
  ]
    .sort((left, right) => left.seq - right.seq)
    .slice(0, CALL_LIMIT)
  const chars = calls.reduce((sum, call) => sum + (call.chars ?? 0), 0)
  return {
    ...step,
    calls,
    tools: tallyCalls(calls),
    toolOutput: chars,
    toolWall: toolSpanUnion(calls),
    toolErrors: step.toolErrors + innerCalls.filter(call => call.error).length,
  }
}

/**
 * Aggregate one turn's steps into the row values the table shows.
 * @param turn - turn number.
 * @param steps - the turn's step metrics in step order.
 * @returns the turn row.
 */
export function aggregateTurn(turn: number, steps: readonly PerfStepMetrics[]): PerfTurnMetrics {
  let ttftSum = 0
  let ttftUnknown = 0
  let modelSum = 0
  let modelUnknown = 0
  let decodeSum = 0
  let decodeUnknown = 0
  let outputSum = 0
  let outputUnknown = 0
  let toolSum = 0
  let toolPairable = 0
  let toolPending = 0
  let toolWallSum = 0
  let toolWallMeasured = false
  const tools = new Map<string, number>()
  for (const step of steps) {
    for (const item of step.tools) tools.set(item.name, (tools.get(item.name) ?? 0) + item.count)
    // First-token waits accumulate too: the turn total is the sum of its steps.
    if (isNumber(step.ttft)) ttftSum += step.ttft
    else ttftUnknown += 1
    if (isNumber(step.model)) modelSum += step.model
    else modelUnknown += 1
    if (isNumber(step.decode)) decodeSum += step.decode
    else decodeUnknown += 1
    if (isNumber(step.output)) outputSum += step.output
    else outputUnknown += 1
    if (isNumber(step.tool)) {
      toolSum += step.tool
      toolPairable += 1
    }
    if (isNumber(step.toolWall)) {
      toolWallSum += step.toolWall
      toolWallMeasured = true
    }
    toolPending += step.toolPending
  }
  const first = steps[0]
  const last = steps[steps.length - 1]
  const wall = first !== undefined && last !== undefined
    && !last.running && isNumber(first.startTime) && isNumber(last.endTime)
    ? Math.max(0, last.endTime - first.startTime)
    : null
  // Last cache hit measured in the turn: the prompt grows, so the tail value is
  // the turn's actual level rather than the first step's cold start.
  let cacheHit: number | null = null
  let answer: string | null = null
  let retries = 0
  let toolErrors = 0
  let toolOutput = 0
  let lastStepWall: number | null = null
  for (const step of steps) {
    if (isNumber(step.cacheHit)) cacheHit = step.cacheHit
    if (step.answer !== null) answer = step.answer
    retries += step.retries
    toolErrors += step.toolErrors
    if (isNumber(step.toolOutput)) toolOutput += step.toolOutput
    if (isNumber(step.wall)) lastStepWall = step.wall
  }
  const cache = turnCache(steps)
  const all = steps.length
  const toolCounts: PerfToolCount[] = [...tools.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count)
  return {
    turn,
    steps,
    startTime: first !== undefined && isNumber(first.startTime) ? first.startTime : null,
    context: turnContext(steps),
    // Only "nothing measured" counts as unrecorded; partial coverage is a lower bound.
    ttft: ttftUnknown === all ? null : ttftSum,
    ttftPending: ttftUnknown === all ? 0 : ttftUnknown,
    model: modelUnknown === all ? null : modelSum,
    modelPending: modelUnknown,
    decode: decodeUnknown === all ? null : decodeSum,
    tps: decodeSum > 0 && outputSum > 0 ? outputSum / (decodeSum / 1000) : null,
    output: outputUnknown === all ? null : outputSum,
    tool: toolPairable === 0 ? null : toolSum,
    toolWall: toolWallMeasured ? toolWallSum : null,
    toolPending: toolPairable === 0 ? 0 : toolPending,
    tools: toolCounts,
    cacheHit,
    cacheRead: cache.read,
    cacheWrite: cache.write,
    retries,
    toolErrors,
    toolOutput,
    lastStepWall,
    running: last !== undefined && last.running,
    interrupted: steps.some(step => step.interrupted),
    aborted: steps.some(step => step.aborted),
    wall,
    prompt: null,
    promptImages: NO_IMAGES,
    promptSource: null,
    answer,
  }
}

/** A step with no measurement at all: the empty step an interruption appends. */
function isEmptyStep(step: PerfStepMetrics): boolean {
  return step.context === null && step.ttft === null && step.model === null
    && step.tool === null && step.toolPending === 0
    && step.tools.length === 0
    && (step.wall === null || step.wall === 0)
}

/**
 * Group published nodes into ordered turns, closing each turn with its markers.
 * Code-Mode contributions merge into the step that dispatched them, identified
 * by the root call id the node carries.
 * @param nodes - every node the target builder currently holds.
 * @returns turn rows ordered oldest first.
 */
export function buildTurns(nodes: Iterable<PerfViewNode>): PerfTurnMetrics[] {
  const grouped = new Map<number, PerfStepMetrics[]>()
  // turn/end marker: turn → end time and reason, so an interrupted tail closes.
  const closedAt = new Map<number, number>()
  const closedKind = new Map<number, string>()
  // User question per turn; the first typed question wins over later retries.
  const prompts = new Map<number, TurnTrigger>()
  // Code-Mode dispatches per step, merged after the steps are ordered.
  const inner = new Map<string, InnerContribution[]>()
  for (const node of nodes) {
    const data = node.data
    if (data.kind === 'prompt') {
      const previous = prompts.get(data.turn)
      const rank = triggerRank(data.source)
      if (previous === undefined
        || rank > triggerRank(previous.source)
        || (rank === triggerRank(previous.source) && previous.text === '' && (data.prompt ?? '') !== '')) {
        prompts.set(data.turn, {
          text: data.prompt ?? '',
          images: data.images,
          source: data.source,
        })
      }
      continue
    }
    if (data.kind === 'end') {
      if (isNumber(data.endTime)) closedAt.set(data.turn, data.endTime)
      if (data.closeKind !== null) closedKind.set(data.turn, data.closeKind)
      continue
    }
    if (data.kind === 'inner') {
      const key = `${data.turn}:${data.step}`
      const list = inner.get(key)
      if (list === undefined) inner.set(key, [data])
      else list.push(data)
      continue
    }
    const metrics = data.metrics
    if (!isNumber(metrics.turn)) continue
    const bucket = grouped.get(metrics.turn)
    if (bucket === undefined) grouped.set(metrics.turn, [metrics])
    else bucket.push(metrics)
  }
  const turns: PerfTurnMetrics[] = []
  const order = [...grouped.keys()].sort((left, right) => left - right)
  order.forEach((turn, index) => {
    const bucket = grouped.get(turn)
    /* v8 ignore next -- turn came from the map's own keys, so the bucket always exists. */
    if (bucket === undefined) return
    const steps = bucket.slice().sort((left, right) => left.step - right.step)
    // A late re-delivery of a pruned tool result names an old turn and has no
    // start, prompt, or end in this window: it is context, not a turn row.
    const boundary = prompts.has(turn) || closedAt.has(turn)
      || steps.some(step => step.startTime !== null || step.mark === 'end')
    if (!boundary) return
    // A step followed by another step cannot still be running: a trimmed window
    // can lose its step/end, and the row would otherwise stay "running" forever.
    for (let at = 0; at < steps.length - 1; at += 1) {
      const step = steps[at]
      if (step !== undefined && step.running) steps[at] = { ...step, running: false }
    }
    const at = closedAt.get(turn)
    const tail = steps[steps.length - 1]
    // An interruption appends an empty final step that only marks the break.
    if (at !== undefined && steps.length > 1 && tail !== undefined && isEmptyStep(tail)) steps.pop()
    const last = steps[steps.length - 1]
    // Interrupted tail: close the last step at the turn/end time so it shows
    // "unsettled" with a measured duration instead of "running" with no total.
    if (at !== undefined && last !== undefined && last.endTime === null) {
      steps[steps.length - 1] = {
        ...last,
        endTime: at,
        wall: isNumber(last.startTime) ? Math.max(0, at - last.startTime) : null,
        running: false,
        aborted: true,
      }
    }
    const merged = steps.map(step => mergeInnerCalls(step, inner.get(`${turn}:${step.step}`) ?? []))
    const aggregate = aggregateTurn(turn, merged)
    const prompt = prompts.get(turn)
    turns.push({
      ...aggregate,
      // A turn followed by another turn cannot still be running.
      running: (index < order.length - 1 || at !== undefined) ? false : aggregate.running,
      interrupted: closedKind.get(turn) === 'interrupted' ? true : aggregate.interrupted,
      prompt: prompt === undefined || prompt.text === '' ? null : prompt.text,
      promptImages: prompt === undefined ? NO_IMAGES : prompt.images,
      promptSource: prompt === undefined ? null : prompt.source,
    })
  })
  return turns
}

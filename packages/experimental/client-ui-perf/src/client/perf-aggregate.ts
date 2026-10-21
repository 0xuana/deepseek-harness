/** Turn aggregation over the step metrics a window holds. */

import type {
  PerfStepMetrics, PerfToolCount, PerfTurnMetrics, PerfViewNode,
} from './perf-contract.ts'
import { isNumber } from './perf-usage.ts'

/** Context measured last in the turn: steps without usage keep the previous value. */
function turnContext(steps: readonly PerfStepMetrics[]): number | null {
  let context: number | null = null
  for (const step of steps) if (isNumber(step.context)) context = step.context
  return context
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
  let retries = 0
  let toolErrors = 0
  let toolOutput = 0
  let lastStepWall: number | null = null
  for (const step of steps) {
    if (isNumber(step.cacheHit)) cacheHit = step.cacheHit
    retries += step.retries
    toolErrors += step.toolErrors
    if (isNumber(step.toolOutput)) toolOutput += step.toolOutput
    if (isNumber(step.wall)) lastStepWall = step.wall
  }
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
    toolPending: toolPairable === 0 ? 0 : toolPending,
    tools: toolCounts,
    cacheHit,
    retries,
    toolErrors,
    toolOutput,
    lastStepWall,
    running: last !== undefined && last.running,
    interrupted: steps.some(step => step.interrupted),
    aborted: steps.some(step => step.aborted),
    wall,
    prompt: null,
    promptImages: 0,
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
 * @param nodes - every node the target builder currently holds.
 * @returns turn rows ordered oldest first.
 */
export function buildTurns(nodes: Iterable<PerfViewNode>): PerfTurnMetrics[] {
  const grouped = new Map<number, PerfStepMetrics[]>()
  // turn/end marker: turn → end time and reason, so an interrupted tail closes.
  const closedAt = new Map<number, number>()
  const closedKind = new Map<number, string>()
  // User question per turn.
  const prompts = new Map<number, { text: string; images: number }>()
  for (const node of nodes) {
    const data = node.data
    if (data.kind === 'prompt') {
      if (data.prompt !== null && data.prompt !== '') {
        prompts.set(data.turn, { text: data.prompt, images: data.images })
      }
      continue
    }
    if (data.kind === 'end') {
      if (isNumber(data.endTime)) closedAt.set(data.turn, data.endTime)
      if (data.closeKind !== null) closedKind.set(data.turn, data.closeKind)
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
    /* v8 ignore next -- order is built from grouped's own keys, so the lookup always resolves. */
    if (bucket === undefined) return
    const steps = bucket.slice().sort((left, right) => left.step - right.step)
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
    const aggregate = aggregateTurn(turn, steps)
    const prompt = prompts.get(turn)
    turns.push({
      ...aggregate,
      // A turn followed by another turn cannot still be running.
      running: (index < order.length - 1 || at !== undefined) ? false : aggregate.running,
      interrupted: closedKind.get(turn) === 'interrupted' ? true : aggregate.interrupted,
      prompt: prompt === undefined ? null : prompt.text,
      promptImages: prompt === undefined ? 0 : prompt.images,
    })
  })
  return turns
}

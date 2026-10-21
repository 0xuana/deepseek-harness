/** Event folding and per-step metric derivation for the performance table. */

import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { assistantStreamFirstTokenTime } from '@deepseek-ai/dsh-llm/assistant-stream'
// Type-only: the PTC event members this fold reads.
import type {} from '@deepseek-ai/dsh-tools/types'
import type {
  PerfCall, PerfStepMetrics, PerfStepState, PerfToolCount, PerfUsage,
} from './perf-contract.ts'
import {
  cacheHitRate, cacheReadTokens, cacheWriteTokens, contextTokens, isNumber, isUsage,
  outputTokens,
} from './perf-usage.ts'

/** Result text kept per call for the accordion panel. */
const TEXT_LIMIT = 16_000

/** Total result text kept per step; calls past the budget keep only their size. */
const STEP_TEXT_BUDGET = 48_000

/** Before/after text kept per edit call. */
const EDIT_TEXT_LIMIT = 8_000

/** Raw arguments kept per call. */
const ARGS_LIMIT = 2_000

/** Calls listed per step. */
export const CALL_LIMIT = 12

/** Clamp text to one line and a maximum length. */
function clip(text: string | null | undefined, max: number): string | null {
  if (typeof text !== 'string') return null
  const value = text.trim().replace(/\s+/g, ' ')
  if (value === '') return null
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

/** Keep the last two path segments; a full path adds nothing to a table cell. */
function shortPath(value: string | null): string | null {
  if (value === null || value === '') return null
  const parts = value.split(/[\\/]/).filter(part => part !== '')
  return parts.length <= 2 ? value : parts.slice(-2).join('/')
}

/** Parse tool arguments into a field map, accepting the raw JSON string form. */
function argumentsOf(raw: unknown): Record<string, unknown> | null {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw !== 'string' || raw === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    // The model produced arguments this build cannot parse; the cell shows no hint.
    return null
  }
}

/** Raw arguments for the inspector, bounded and stringified when not already text. */
function rawArgs(raw: unknown): string | null {
  if (typeof raw === 'string') return boundedText(raw, ARGS_LIMIT).text
  if (raw === null || raw === undefined) return null
  try {
    return boundedText(JSON.stringify(raw), ARGS_LIMIT).text
  } catch {
    // A non-serializable argument value has no raw form to show.
    return null
  }
}

/** Keep the first `limit` characters, flagging whether anything was cut. */
function boundedText(text: string, limit: number): { text: string | null; truncated: boolean } {
  if (text === '') return { text: null, truncated: false }
  if (text.length <= limit) return { text, truncated: false }
  return { text: text.slice(0, limit), truncated: true }
}

/** Line count; an empty string counts as zero lines. */
function countLines(text: string): number {
  if (text === '') return 0
  let lines = 1
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lines += 1
  }
  return text.charCodeAt(text.length - 1) === 10 ? lines - 1 : lines
}

/** Longest common subsequence length, one rolling row; fine below 400 lines a side. */
function lcsLength(left: readonly string[], right: readonly string[]): number {
  const width = right.length + 1
  let previous = new Uint16Array(width)
  let current = new Uint16Array(width)
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      /* v8 ignore next -- an in-bounds typed-array read is always a number; the fallback only satisfies the index type. */
      const up = previous[column] ?? 0
      /* v8 ignore next -- an in-bounds typed-array read is always a number; the fallback only satisfies the index type. */
      const leftCell = current[column - 1] ?? 0
      /* v8 ignore next 3 -- the typed-array nullish fallback is unreachable; in-bounds reads never yield undefined. */
      current[column] = left[row - 1] === right[column - 1]
        ? (previous[column - 1] ?? 0) + 1
        : Math.max(up, leftCell)
    }
    const swap = previous
    previous = current
    current = swap
    current.fill(0)
  }
  /* v8 ignore next -- an in-bounds typed-array read is always a number; the fallback only satisfies the index type. */
  return previous[right.length] ?? 0
}

/** Lines actually added and removed by one replacement. */
function diffLines(before: string, after: string): { added: number; removed: number } {
  const left = before === '' ? [] : before.split('\n')
  const right = after === '' ? [] : after.split('\n')
  if (left.length === 0) return { added: right.length, removed: 0 }
  if (right.length === 0) return { added: 0, removed: left.length }
  if (left.length > 400 || right.length > 400) {
    return {
      added: Math.max(0, right.length - left.length),
      removed: Math.max(0, left.length - right.length),
    }
  }
  const common = lcsLength(left, right)
  return { added: right.length - common, removed: left.length - common }
}

/** Line delta of an edit or write call, or null when the tool has no such measure. */
function editDelta(
  name: string,
  raw: unknown,
): { added: number; removed: number; before: string | null; after: string | null } | null {
  if (name !== 'edit' && name !== 'write' && name !== 'apply_patch') return null
  const args = argumentsOf(raw)
  if (args === null) return null
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = args[key]
      if (typeof value === 'string') return value
    }
    return null
  }
  if (name === 'write') {
    const content = pick('content', 'text', 'file_text')
    if (content === null) return null
    return {
      added: countLines(content),
      removed: 0,
      before: null,
      after: boundedText(content, EDIT_TEXT_LIMIT).text,
    }
  }
  const beforeText = pick('old_string', 'old_str', 'old')
  const afterText = pick('new_string', 'new_str', 'new')
  if (beforeText === null && afterText === null) return null
  const counts = diffLines(beforeText ?? '', afterText ?? '')
  return {
    ...counts,
    before: boundedText(beforeText ?? '', EDIT_TEXT_LIMIT).text,
    after: boundedText(afterText ?? '', EDIT_TEXT_LIMIT).text,
  }
}

/** Short call description: file, pattern, command, or the first argument worth naming. */
function toolHint(name: string, raw: unknown): string | null {
  const args = argumentsOf(raw)
  if (args === null) return null
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = args[key]
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
    return null
  }
  switch (name) {
    case 'read':
    case 'write':
    case 'edit':
      return clip(shortPath(pick('file_path', 'path', 'file')), 34)
    case 'grep':
    case 'glob': {
      const pattern = pick('pattern')
      if (pattern === null) return null
      const include = pick('include')
      return clip(include === null ? pattern : `${pattern} (${include})`, 34)
    }
    case 'pwsh':
    case 'shell':
    case 'bash': {
      const description = pick('description') ?? pick('command') ?? ''
      return clip(description.split('\n')[0], 30)
    }
    case 'web_fetch': {
      const url = pick('url')
      return url === null ? null : clip(url.replace(/^https?:\/\//, ''), 34)
    }
    case 'web_search':
      return clip(pick('query'), 30)
    case 'run_code':
    case 'RunCode':
    case 'runCode':
      return clip(pick('description'), 34)
    default:
      return clip(pick('description', 'query', 'path', 'file_path', 'provider', 'method', 'name'), 30)
  }
}

/** Code-Mode steps call this one tool; the real tools run inside it. */
function isCodeMode(name: string | null): boolean {
  return name !== null && /^run_?code$/i.test(name)
}

/** Tool name of one call; a nameless call counts but invents no name. */
function calledTool(data: { readonly name?: unknown }): string | null {
  const name = data.name
  return typeof name === 'string' && name !== '' ? name : null
}

/** Whether one stream chunk counts as the first model token. */
function isTokenDelta(chunk: StreamChunk): boolean {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.text !== ''
    case 'tool-call-delta':
      return chunk.argumentsDelta !== '' || chunk.name !== undefined
    default:
      return false
  }
}

/** Root call id → step id, for inner Code-Mode calls that carry no turn/step. */
const PTC_STEPS = new Map<string, string>()
const PTC_STEPS_MAX = 4_000

/** Remember which step owns one Code-Mode root call, evicting the oldest entry. */
function rememberPtcCall(callId: string, stepId: string): void {
  PTC_STEPS.set(callId, stepId)
  if (PTC_STEPS.size <= PTC_STEPS_MAX) return
  const oldest = PTC_STEPS.keys().next().value
  /* v8 ignore next -- the size check above guarantees a first key, so the guard never sees undefined. */
  if (oldest !== undefined) PTC_STEPS.delete(oldest)
}

/**
 * Step id owning one Code-Mode root call.
 * @param rootCallId - root call id carried by a dispatch event.
 * @returns the owning step id, or null when the call was not recorded.
 */
export function ptcStepOf(rootCallId: unknown): string | null {
  return typeof rootCallId === 'string' ? PTC_STEPS.get(rootCallId) ?? null : null
}

/** Clear the Code-Mode owner table; tests use it to isolate cases. */
export function resetPtcSteps(): void {
  PTC_STEPS.clear()
}

/** Current turn number; `user/message` carries no turn and is attributed by order. */
let currentTurn: number | null = null

/**
 * Turn number of the latest `turn/start`.
 * @returns the current turn, or null before the window has one.
 */
export function currentTurnOf(): number | null {
  return currentTurn
}

/** Reset the current-turn marker; tests use it to isolate cases. */
export function resetCurrentTurn(): void {
  currentTurn = null
}

/**
 * Initial state of one step or one turn-level marker.
 * @param turn - turn number.
 * @param step - step number, or the marker's pseudo step.
 * @param mark - marker kind; steps pass null.
 * @returns the empty state.
 */
export function newState(
  turn: number,
  step: number,
  mark: PerfStepState['mark'] = null,
): PerfStepState {
  return {
    turn,
    step,
    startSeq: null,
    startTime: null,
    endTime: null,
    ended: false,
    firstTokenTime: null,
    messageTime: null,
    usage: null,
    interrupted: false,
    toolPairs: 0,
    toolMs: 0,
    toolOpen: 0,
    toolMissing: 0,
    pending: null,
    tools: null,
    calls: null,
    starts: null,
    retries: 0,
    toolErrors: 0,
    mark,
    prompt: null,
    images: 0,
    closed: false,
    closeKind: null,
  }
}

/** Call id of a tool result lives on the message source, not on the result event. */
function resultCallId(message: unknown): string | null {
  if (message === null || typeof message !== 'object') return null
  const source = (message as { source?: unknown }).source
  if (source === null || typeof source !== 'object') return null
  const callId = (source as { callId?: unknown }).callId
  return typeof callId === 'string' ? callId : null
}

/** Result text: the text blocks of the tool message joined by newlines. */
function resultText(message: unknown): string | null {
  /* v8 ignore next -- callers reach this helper only after resolving a call id from an object message. */
  if (message === null || typeof message !== 'object') return null
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const item of content as unknown[]) {
    if (item === null || typeof item !== 'object') continue
    const block = item as { type?: unknown; text?: unknown }
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.length === 0 ? null : parts.join('\n')
}

/** Size, line count, and bounded body of one tool result. */
function resultInfo(message: unknown): {
  chars: number
  lines: number
  text: string | null
  truncated: boolean
} {
  const text = resultText(message)
  if (text === null) return { chars: 0, lines: 0, text: null, truncated: false }
  let lines = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lines += 1
  }
  if (text.charCodeAt(text.length - 1) !== 10) lines += 1
  const body = boundedText(text, TEXT_LIMIT)
  return { chars: text.length, lines, text: body.text, truncated: body.truncated }
}

/** Whether one tool result reports an error. */
function resultFailed(message: unknown): boolean {
  return message !== null && typeof message === 'object'
    && (message as { isError?: unknown }).isError === true
}

/**
 * User question: `user/message` also carries injected runtime context and time
 * snapshots, so only `source.kind === 'user'` is the text the user typed.
 */
function promptOf(data: {
  readonly content?: unknown
  readonly source?: unknown
}): { text: string | null; images: number } {
  const content = data.content
  if (!Array.isArray(content)) return { text: null, images: 0 }
  const parts: string[] = []
  let images = 0
  for (const item of content as unknown[]) {
    if (item === null || typeof item !== 'object') continue
    const block = item as { type?: unknown; text?: unknown }
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    if (block.type === 'image') images += 1
  }
  return { text: clip(parts.join(' '), 400), images }
}

/** Add one call of `name` to the tally, preserving first-call order for ties. */
function bumpTool(tools: Readonly<Record<string, number>> | null, name: string): Record<string, number> {
  const next: Record<string, number> = { ...(tools ?? {}) }
  next[name] = (next[name] ?? 0) + 1
  return next
}

/**
 * Fold one session event into the step state. Events other than `step/start`
 * create a state when the window starts mid-step, so context and throughput
 * still show while start-dependent metrics stay unrecorded.
 * @param state - current state, or undefined before the first foldable event.
 * @param event - one durable or client-only session event.
 * @returns the next state, or undefined when the event needs a start it lacks.
 */
export function foldEvent(
  state: PerfStepState | undefined,
  event: SessionEventLike,
): PerfStepState | undefined {
  switch (event.type) {
    case 'step/start':
      return { ...newState(event.data.turn, event.data.step), startSeq: event.seq, startTime: event.time }

    case 'turn/start': {
      currentTurn = event.data.turn
      return newState(event.data.turn, 0, 'prompt')
    }

    case 'user/message': {
      const next = state ?? newState(currentTurn ?? 0, 0)
      const base: PerfStepState = { ...next, mark: 'prompt' }
      const source: unknown = event.data.source
      if (typeof source !== 'object' || source === null
        || (source as { kind?: unknown }).kind !== 'user') return base
      if (base.prompt !== null) return base
      const prompt = promptOf(event.data)
      return { ...base, prompt: prompt.text, images: prompt.images }
    }

    case 'assistant/live-chunk': {
      const next = state ?? newState(event.data.turn, event.data.step)
      const chunk = event.data.chunk
      if (chunk.type === 'usage') {
        const usage: PerfUsage = chunk.usage
        return isUsage(usage) ? { ...next, usage } : next
      }
      if (next.firstTokenTime === null && isTokenDelta(chunk)) {
        return { ...next, firstTokenTime: event.time }
      }
      return next
    }

    case 'assistant/attempt':
    case 'assistant/message': {
      let next = state ?? newState(event.data.turn, event.data.step)
      if (next.firstTokenTime === null) {
        const fromStream = assistantStreamFirstTokenTime(event.data.stream)
        if (isNumber(fromStream)) next = { ...next, firstTokenTime: fromStream }
      }
      if (event.type === 'assistant/attempt') return next
      const usage = event.data.usage
      return {
        ...next,
        messageTime: next.messageTime ?? event.time,
        usage: isUsage(usage) ? usage : next.usage,
        interrupted: event.data.interrupted === true,
      }
    }

    case 'tool/call': {
      const next = state ?? newState(event.data.turn, event.data.step)
      const callId = event.data.callId
      const pending: Record<string, number> = { ...(next.pending ?? {}) }
      const known = Object.hasOwn(pending, callId)
      pending[callId] = event.time
      const name = calledTool(event.data)
      const calls: Record<string, PerfCall> = { ...(next.calls ?? {}) }
      if (isCodeMode(name)) rememberPtcCall(callId, `${event.data.turn}:${event.data.step}`)
      if (!Object.hasOwn(calls, callId)) {
        const delta = name === null ? null : editDelta(name, event.data.arguments)
        calls[callId] = {
          callId,
          seq: event.seq,
          name,
          hint: name === null ? null : toolHint(name, event.data.arguments),
          chars: null,
          lines: null,
          error: false,
          added: delta === null ? null : delta.added,
          removed: delta === null ? null : delta.removed,
          before: delta === null ? null : delta.before,
          after: delta === null ? null : delta.after,
          args: rawArgs(event.data.arguments),
          inner: false,
          text: null,
          truncated: false,
          ms: null,
        }
      }
      return {
        ...next,
        pending,
        toolOpen: known ? next.toolOpen : next.toolOpen + 1,
        tools: name === null ? next.tools : bumpTool(next.tools, name),
        calls,
      }
    }

    case 'llm/retry':
      return { ...(state ?? newState(event.data.turn, event.data.step)), retries: (state?.retries ?? 0) + 1 }

    /**
     * Inner Code-Mode call: the name and arguments are the real tool's, the
     * content is the real result. It does not count toward tool time (the outer
     * `run_code` call already covers it), but its own dispatch span is measured.
     * The event carries no turn or step, so it only folds into a context the
     * root-call map already resolved.
     */
    case 'tool/ptc-dispatch-start': {
      if (state === undefined) return state
      const subCallId = event.data.subCallId
      return { ...state, starts: { ...(state.starts ?? {}), [subCallId]: event.time } }
    }

    case 'tool/ptc-dispatch': {
      const next = state
      if (next === undefined) return next
      const name = calledTool(event.data)
      if (name === null) return next
      const info = resultInfo({ content: event.data.content })
      const delta = editDelta(name, event.data.arguments)
      const callKey = event.data.subCallId
      const startedAt = next.starts?.[callKey]
      const calls: Record<string, PerfCall> = { ...(next.calls ?? {}) }
      calls[callKey] = {
        callId: callKey,
        seq: event.seq,
        name,
        hint: toolHint(name, event.data.arguments),
        chars: info.chars,
        lines: info.lines,
        text: info.text,
        truncated: info.truncated,
        error: event.data.isError,
        added: delta === null ? null : delta.added,
        removed: delta === null ? null : delta.removed,
        before: delta === null ? null : delta.before,
        after: delta === null ? null : delta.after,
        args: rawArgs(event.data.arguments),
        inner: true,
        ms: isNumber(startedAt) ? Math.max(0, event.time - startedAt) : null,
      }
      return {
        ...next,
        calls,
        tools: bumpTool(next.tools, name),
        toolErrors: event.data.isError ? next.toolErrors + 1 : next.toolErrors,
      }
    }

    case 'tool/result': {
      const next = state ?? newState(event.data.turn, event.data.step)
      const message = event.data.message
      const callId = resultCallId(message)
      const failed = resultFailed(message)
      const before = callId === null ? undefined : next.calls?.[callId]
      const calls: Record<string, PerfCall> = { ...(next.calls ?? {}) }
      if (callId !== null && before !== undefined) {
        calls[callId] = {
          ...before,
          ...resultInfo(message),
          error: failed || before.error,
        }
      }
      const withError = failed ? { ...next, toolErrors: next.toolErrors + 1 } : next
      // Own-property check: the call id is model generated, so a name such as
      // `constructor` must not resolve to an inherited function as a start time.
      const dispatched = callId === null ? undefined : next.pending?.[callId]
      if (!isNumber(dispatched)) {
        return { ...withError, calls, toolMissing: next.toolMissing + 1 }
      }
      const pending: Record<string, number> = {}
      /* v8 ignore next -- a numeric dispatched time implies pending exists, so the empty fallback is unreachable. */
      for (const [key, value] of Object.entries(next.pending ?? {})) {
        if (key !== callId) pending[key] = value
      }
      return {
        ...withError,
        calls,
        pending,
        toolOpen: Math.max(0, next.toolOpen - 1),
        toolPairs: next.toolPairs + 1,
        toolMs: next.toolMs + Math.max(0, event.time - dispatched),
      }
    }

    case 'step/end':
      return { ...(state ?? newState(event.data.turn, event.data.step)), ended: true, endTime: event.time }

    default:
      return state
  }
}

/** Calls of one step in call order, bounded per call and per step. */
function callList(calls: Readonly<Record<string, PerfCall>> | null): PerfCall[] {
  if (calls === null) return []
  const list = Object.values(calls)
    .sort((left, right) => left.seq - right.seq)
    .slice(0, CALL_LIMIT)
  let used = 0
  return list.map((call) => {
    const size = call.text === null ? 0 : call.text.length
    if (size === 0) return call
    if (used + size <= STEP_TEXT_BUDGET) {
      used += size
      return call
    }
    return { ...call, text: null, truncated: true }
  })
}

/** Tool result characters one step pushed into the next prompt. */
function outputChars(calls: Readonly<Record<string, PerfCall>> | null, skipRunner: boolean): number {
  if (calls === null) return 0
  let total = 0
  for (const call of Object.values(calls)) {
    if (skipRunner && isCodeMode(call.name) && !call.inner) continue
    if (isNumber(call.chars)) total += call.chars
  }
  return total
}

/** Tool tallies by descending count; ties keep first-call order. */
function sortedTools(tools: Readonly<Record<string, number>> | null): PerfToolCount[] {
  if (tools === null) return []
  return Object.entries(tools)
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count)
}

/**
 * Measured metrics of one step.
 * @param state - folded step state.
 * @returns the row values the table renders.
 */
export function stepMetrics(state: PerfStepState): PerfStepMetrics {
  const start = state.startTime
  const first = state.firstTokenTime
  const message = state.messageTime
  const context = contextTokens(state.usage)
  const output = outputTokens(state.usage)
  const ttft = isNumber(start) && isNumber(first) ? Math.max(0, first - start) : null
  const model = isNumber(start) && isNumber(message) ? Math.max(0, message - start) : null
  const decode = isNumber(first) && isNumber(message) ? Math.max(0, message - first) : null
  const tps = isNumber(decode) && decode > 0 && isNumber(output) && output > 0
    ? output / (decode / 1000)
    : null
  const settled = isNumber(message)
  const rawCalls = callList(state.calls)
  const inner = rawCalls.some(call => call.inner)
  const calls = inner ? rawCalls.filter(call => !isCodeMode(call.name)) : rawCalls
  const tools = sortedTools(state.tools).filter(item => !(inner && isCodeMode(item.name)))
  return {
    turn: state.turn,
    step: state.step,
    startTime: isNumber(start) ? start : null,
    endTime: isNumber(state.endTime) ? state.endTime : null,
    context,
    ttft,
    model,
    decode,
    tps,
    output,
    tool: state.toolPairs > 0 ? state.toolMs : null,
    tools,
    calls,
    toolOutput: outputChars(state.calls, inner),
    retries: state.retries,
    toolErrors: state.toolErrors,
    cacheRead: cacheReadTokens(state.usage),
    cacheWrite: cacheWriteTokens(state.usage),
    cacheHit: cacheHitRate(state.usage),
    wall: isNumber(start) && isNumber(state.endTime) ? Math.max(0, state.endTime - start) : null,
    toolPending: state.toolOpen + state.toolMissing,
    running: !state.ended,
    interrupted: state.interrupted,
    aborted: state.ended && !settled,
    mark: state.mark,
    prompt: state.prompt,
    images: state.images,
    closed: state.closed,
    closeKind: state.closeKind,
  }
}

/**
 * State rebuilt from the matches a window still holds when its state is absent.
 * Event order is preserved, so `step/start` and `step/end` restore the
 * boundaries whenever they survived.
 * @param matches - accepted matches in ascending sequence order.
 * @returns the folded state, or undefined when nothing was foldable.
 */
export function fallbackState(
  matches: readonly { readonly event: SessionEventLike }[],
): PerfStepState | undefined {
  let state: PerfStepState | undefined
  for (const match of matches) state = foldEvent(state, match.event)
  return state
}

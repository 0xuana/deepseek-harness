/** Published performance model: per-step metrics, per-turn aggregates, and marker contributions. */

import type {
  ConversationLocation, ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Token usage counts one assistant message reported. */
export interface PerfUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
}

/** One recorded tool call of a step, including its result size and preview. */
export interface PerfCall {
  readonly callId: string
  readonly seq: number
  readonly name: string | null
  readonly hint: string | null
  readonly chars: number | null
  readonly lines: number | null
  readonly error: boolean
  readonly added: number | null
  readonly removed: number | null
  readonly before: string | null
  readonly after: string | null
  readonly args: string | null
  /** Code-Mode dispatch recorded inside a `run_code` call. */
  readonly inner: boolean
  /** Result text kept for the accordion panel. */
  readonly text: string | null
  readonly truncated: boolean
  /** Measured tool duration, or null while the result is missing. */
  readonly ms: number | null
  /** Wall-clock start of the call, for the non-overlapping tool-span union. */
  readonly startedAt: number | null
  /** Wall-clock end of the call, present only after its result settled. */
  readonly endedAt: number | null
}

/** Tool call tally shown as one pill. */
export interface PerfToolCount {
  readonly name: string
  readonly count: number
}

/** Per-step state folded from the event stream. */
export interface PerfStepState {
  readonly turn: number
  readonly step: number
  readonly startSeq: number | null
  readonly startTime: number | null
  readonly endTime: number | null
  readonly ended: boolean
  readonly firstTokenTime: number | null
  readonly messageTime: number | null
  readonly usage: PerfUsage | null
  readonly interrupted: boolean
  readonly toolPairs: number
  readonly toolMs: number
  readonly toolOpen: number
  readonly toolMissing: number
  readonly pending: Readonly<Record<string, number>> | null
  readonly tools: Readonly<Record<string, number>> | null
  readonly calls: Readonly<Record<string, PerfCall>> | null
  readonly starts: Readonly<Record<string, number>> | null
  readonly retries: number
  readonly toolErrors: number
  /** Turn-level marker kind; step states leave this null. */
  readonly mark: 'prompt' | 'end' | null
  readonly prompt: string | null
  readonly images: number
  readonly closed: boolean
  readonly closeKind: string | null
  /** Producer source kind of the trigger prompt Context. */
  readonly trigger: string | null
  /** Trimmed one-message answer text, for the Did column preview. */
  readonly answer: string | null
}

/** Measured metrics of one step. */
export interface PerfStepMetrics {
  readonly turn: number
  readonly step: number
  readonly startTime: number | null
  readonly endTime: number | null
  readonly context: number | null
  readonly ttft: number | null
  readonly model: number | null
  readonly decode: number | null
  readonly tps: number | null
  readonly output: number | null
  readonly tool: number | null
  /** Union of the paired calls' wall intervals; tool calls may run in parallel. */
  readonly toolWall: number | null
  readonly tools: readonly PerfToolCount[]
  readonly calls: readonly PerfCall[]
  readonly toolOutput: number | null
  readonly retries: number
  readonly toolErrors: number
  /** Trimmed answer text of the settled assistant message, or null. */
  readonly answer: string | null
  readonly cacheRead: number | null
  readonly cacheWrite: number | null
  readonly cacheHit: number | null
  readonly wall: number | null
  readonly toolPending: number
  readonly running: boolean
  readonly interrupted: boolean
  readonly aborted: boolean
  readonly ttftPending?: number
  readonly mark?: 'prompt' | 'end' | null
  readonly prompt?: string | null
  readonly images?: number
  readonly closed?: boolean
  readonly closeKind?: string | null
}

/** Aggregate of one turn. */
export interface PerfTurnMetrics {
  readonly turn: number
  readonly steps: readonly PerfStepMetrics[]
  readonly startTime: number | null
  readonly context: number | null
  readonly ttft: number | null
  readonly ttftPending: number
  readonly model: number | null
  readonly modelPending: number
  readonly decode: number | null
  readonly tps: number | null
  readonly output: number | null
  readonly tool: number | null
  /** Union of the turn's step tool spans; steps never overlap. */
  readonly toolWall: number | null
  readonly toolPending: number
  readonly tools: readonly PerfToolCount[]
  readonly cacheHit: number | null
  /** Cache breakdown of the last step that reported usage, for the turn tooltip. */
  readonly cacheRead: number | null
  readonly cacheWrite: number | null
  readonly retries: number
  readonly toolErrors: number
  readonly toolOutput: number
  readonly lastStepWall: number | null
  readonly running: boolean
  readonly interrupted: boolean
  readonly aborted: boolean
  readonly wall: number | null
  readonly prompt: string | null
  readonly promptImages: number
  /** Producer source kind that opened the turn (`user`, `agent-message`, ...). */
  readonly promptSource: string | null
  /** Last answer preview measured in the turn. */
  readonly answer: string | null
}

/** One published node: a step's metrics or a turn-level marker. */
export type PerfContribution =
  | { readonly kind: 'step'; readonly metrics: PerfStepMetrics }
  | {
    /** Inner tool calls one Code-Mode root call dispatched; merged into its step. */
    readonly kind: 'inner'
    readonly turn: number
    readonly step: number
    readonly calls: readonly PerfCall[]
  }
  | {
    readonly kind: 'prompt'
    readonly turn: number
    readonly prompt: string | null
    readonly images: number
    /** Producer source kind of the triggering user message. */
    readonly source: string
  }
  | {
    readonly kind: 'end'
    readonly turn: number
    readonly closeKind: string | null
    readonly endTime: number | null
  }

/** View node carried from the Definitions into the target builder. */
export interface PerfViewNode extends ConversationViewNode {
  readonly anchorSeq: number
  readonly location: ConversationLocation
  readonly data: PerfContribution
}

/** Snapshot published to the view component. */
export interface PerfSnapshot {
  readonly turns: readonly PerfTurnMetrics[]
  readonly stepCount: number
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    /** Turn and step metrics this target assembles. */
    perf: PerfSnapshot
  }
}

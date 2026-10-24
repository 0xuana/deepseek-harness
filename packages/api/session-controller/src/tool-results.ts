/** Ephemeral tool values owned by live Session instances, outside the durable journal. */
import { Context } from '@deepseek-ai/cordis'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tool-executor-ptc'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SessionToolResultRequest, SessionToolResultValue } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Non-restorable tool values retained only while their Session is live. */
    sessionToolResults: SessionToolResults
  }
}

interface LiveResults {
  readonly pending: Map<ToolCallId, JsonValue>
  readonly values: Map<number, JsonValue>
  readonly listeners: Map<number, Set<() => void>>
}

function emptyResults(): LiveResults {
  return { pending: new Map(), values: new Map(), listeners: new Map() }
}

/** Read-only Remote inspection of tool values produced in this Session lifetime. */
export class SessionToolResults extends TypertRemoteService {
  static inject = ['sessions', 'typert']
  private results = new WeakMap<Session, LiveResults>()
  private readonly followers = new Set<() => void>()

  /** @param ctx - Owner of the live Session registry and tool result notifications. */
  constructor(ctx: Context) {
    super(ctx, 'sessionToolResults', { namespace: 'toolResults' })
    ctx.on('tools/result', (exec, result) => {
      const session = exec.agent?.session
      if (result.isError || session === undefined || ctx.sessions.get(session.id) !== session) return
      this.forSession(session).pending.set(exec.callId, result.value)
    }, { global: true })
    ctx.on('session/event', (session, event) => {
      const callId = event.type === 'tool/result' ? event.data.message.toolCallId
        : event.type === 'tool/ptc-dispatch' ? event.data.subCallId : undefined
      if (callId === undefined) return
      const state = this.results.get(session)
      const value = state?.pending.get(callId)
      if (state === undefined || value === undefined) return
      state.pending.delete(callId)
      state.values.set(event.seq, value)
      for (const listener of state.listeners.get(event.seq) ?? []) listener()
    }, { global: true })
    ctx.on('session/disposed', (session) => {
      const state = this.results.get(session)
      if (state === undefined) return
      this.results.delete(session)
      state.pending.clear()
      state.values.clear()
      for (const listeners of state.listeners.values()) for (const listener of listeners) listener()
    }, { global: true })
    ctx.effect(() => () => {
      this.results = new WeakMap()
      for (const close of this.followers) close()
      this.followers.clear()
    }, 'tool-results: live values and followers')
  }

  private forSession(session: Session): LiveResults {
    let state = this.results.get(session)
    if (state === undefined) {
      state = emptyResults()
      this.results.set(session, state)
    }
    return state
  }

  private forRequest(request: SessionToolResultRequest): LiveResults {
    const session = this.ctx.sessions.get(request.sessionId)
    return session === undefined ? emptyResults() : this.forSession(session)
  }

  /**
   * Observe one committed result without loading a Session or reading its history.
   * Values disappear when the exact Session instance leaves the registry. A cold
   * read stays unavailable; opening a new stream observes the current instance.
   * @param request - Authorized Session identity and durable result event sequence.
   * @param signal - Remote consumer lifetime.
   * @returns Current availability and changes until cancellation or service disposal.
   */
  @Remote({ mode: 'stream' })
  async *watch(request: SessionToolResultRequest, signal: AbortSignal): AsyncIterable<SessionToolResultValue> {
    const state = this.forRequest(request)
    let dirty = true
    const lifetime = { closed: false }
    let wake: (() => void) | undefined
    const changed = (): void => { dirty = true; wake?.() }
    const close = (): void => { lifetime.closed = true; state.values.clear(); state.pending.clear(); wake?.() }
    let listeners = state.listeners.get(request.seq)
    if (listeners === undefined) { listeners = new Set(); state.listeners.set(request.seq, listeners) }
    listeners.add(changed)
    this.followers.add(close)
    signal.addEventListener('abort', changed, { once: true })
    try {
      while (!signal.aborted && !lifetime.closed) {
        if (dirty) {
          dirty = false
          const value = state.values.get(request.seq)
          yield value === undefined ? { available: false } : { available: true, value }
        } else {
          await new Promise<void>((resolve) => { wake = resolve })
          wake = undefined
        }
      }
    } finally {
      listeners.delete(changed)
      if (listeners.size === 0) state.listeners.delete(request.seq)
      this.followers.delete(close)
      signal.removeEventListener('abort', changed)
    }
  }
}

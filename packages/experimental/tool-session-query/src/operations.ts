/**
 * Tool operation orchestration over session-query service capabilities.
 *
 * @module @deepseek-ai/dsh-tool-session-query/operations
 */

import { turnBoundaryProjectionDefinition, type TurnBoundaryProjection } from '@deepseek-ai/dsh-agent'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  SessionQueryError,
  type SessionEventSearchPage,
  type SessionEventSurface,
  type SessionRecord,
  type SessionSearchCursor,
} from '@deepseek-ai/dsh-session-query'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { toolInput } from './input.ts'
import { presentation } from './presentation.ts'
import { serviceBoundary } from './service-boundary.ts'
import { workspaceAccess } from './workspace-access.ts'

type SessionSearchArgs = Parameters<typeof toolInput.buildSessionFilters>[0]

interface EventSearchArgs {
  session_id?: string
  query: string
  seq_from?: number
  seq_to?: number
  time_from?: string
  time_to?: string
  event_types?: string[]
  surfaces?: SessionEventSurface[]
}

interface SessionTargetArgs {
  session_id?: string
}

interface EventTargetArgs extends SessionTargetArgs {
  seq: number
}

interface EventReadArgs extends EventTargetArgs {
  before?: number
  after?: number
}

interface SearchCollection<T> {
  readonly items: T[]
  readonly capped: boolean
}

/** Session-history tool operations over the caller’s current turn state. */
export class SessionQueryOperations {
  private turnBoundary!: ProjectionHandle<TurnBoundaryProjection>

  constructor(private readonly ctx: Context) {}

  /**
   * Acquire projection readers before exposing dependent operations.
   * @returns when all required registrations are ready.
   */
  async initialize(): Promise<void> {
    this.turnBoundary = await this.ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
  }

  private callerOf(exec: ToolRunContext) {
    const agent = exec.agent
    if (agent === undefined) {
      throw new HarnessError(
        'session query tools require an agent-bound caller',
        'SESSION_QUERY_TOOL_MISSING_AGENT',
      )
    }
    return {
      id: agent.session.id,
      header: agent.session.header,
      boundary: this.turnBoundary.stateOf(agent.session),
    }
  }

  /**
   * Search other Sessions within the caller’s authorized workspace.
   * @param args - Session and event filters.
   * @param exec - Agent-bound caller and cancellation signal.
   * @param maxResults - Maximum number of authorized matches to return.
   * @returns Formatted authorized Session matches and truncation status.
   */
  async executeSessionSearch(
    args: SessionSearchArgs,
    exec: ToolRunContext,
    maxResults: number,
  ): Promise<string> {
    const ctx = this.ctx
    const caller = this.callerOf(exec)
    const cwd = caller.header.cwd
    if (cwd === undefined) {
      throw new HarnessError(
        'cross-session search is unavailable because the caller session has no workspace',
        'SESSION_QUERY_TOOL_UNAUTHORIZED',
      )
    }
    const query = toolInput.normalizeQuery(args.query)
    const sessionFilters = toolInput.buildSessionFilters(args)
    const eventFilters = toolInput.buildEventFilters({
      seqFrom: args.event_seq_from,
      seqTo: args.event_seq_to,
      timeFrom: args.event_time_from,
      timeTo: args.event_time_to,
      eventTypes: args.event_types,
      surfaces: args.event_surfaces,
    })
    const requestedParentIds = toolInput.materializeParentSessionIds(args.parent_session_ids)
    if (requestedParentIds !== undefined || args.include_root_sessions === true) {
      const authorizedParentIds = requestedParentIds === undefined
        ? new Set<SessionId>()
        : await workspaceAccess.authorizeSessionIds(ctx, caller, requestedParentIds, exec.signal)
      const parentValues: Array<SessionId | null> = requestedParentIds
        ?.filter(id => authorizedParentIds.has(id)) ?? []
      if (args.include_root_sessions === true) parentValues.push(null)
      if (parentValues.length === 0) return presentation.formatEmptySessionSearch()
      sessionFilters.push({ kind: 'parent', values: parentValues })
    }
    sessionFilters.push({ kind: 'cwd', values: [cwd] })
    const collected = await collectPages(
      maxResults,
      exec.signal,
      cursor => serviceBoundary.call(ctx, exec.signal, 'session search', () =>
        ctx.sessionQuery.searchSessions({
          query,
          sessionFilters,
          eventFilters,
          ...cursor === undefined ? {} : { cursor },
        }, { signal: exec.signal })),
      hit => hit.header.id !== caller.id && workspaceAccess.recordAuthorized(hit, caller),
    )

    const parentIds = collected.items
      .map(hit => hit.header.parentSession)
      .filter((id): id is SessionId => id !== undefined)
    const authorizedParents = await workspaceAccess.authorizeSessionIds(ctx, caller, parentIds, exec.signal)
    const titles = await workspaceAccess.readTitles(
      ctx,
      caller,
      collected.items.map(hit => hit.header.id),
      exec.signal,
    )
    return presentation.formatSessionSearch(collected, titles, authorizedParents)
  }

  /**
   * Search authorized Session events, excluding the caller’s current step.
   * @param args - Target Session and event filters.
   * @param exec - Agent-bound caller and cancellation signal.
   * @param maxResults - Maximum number of authorized matches to return.
   * @returns Formatted matching events and truncation status.
   */
  async executeEventSearch(
    args: EventSearchArgs,
    exec: ToolRunContext,
    maxResults: number,
  ): Promise<string> {
    const ctx = this.ctx
    const caller = this.callerOf(exec)
    const sessionId = workspaceAccess.targetId(args, caller)
    await workspaceAccess.authorizeTarget(ctx, caller, sessionId, exec.signal)
    const query = toolInput.normalizeQuery(args.query)
    const range = toolInput.sequenceRange(args.seq_from, args.seq_to)
    if (sessionId === caller.id) {
      const stepStartSeq = caller.boundary.lastStepStartSeq
      // `null` (no step started yet) caps the range to a degenerate `to` the
      // filter validation rejects — the loop never runs tools outside a step.
      range.to = Math.min(range.to ?? Number.MAX_SAFE_INTEGER, (stepStartSeq ?? 0) - 1)
    }
    const title = await workspaceAccess.readTitle(ctx, caller, sessionId, exec.signal)
    if (range.from !== undefined && range.to !== undefined && range.from > range.to) {
      return presentation.formatEventSearch(sessionId, title, { items: [], capped: false })
    }
    const filters = toolInput.buildEventFilters({
      seqFrom: range.from,
      seqTo: range.to,
      timeFrom: args.time_from,
      timeTo: args.time_to,
      eventTypes: args.event_types,
      surfaces: args.surfaces,
    })
    const collected = await collectPages(
      maxResults,
      exec.signal,
      async (cursor): Promise<SessionEventSearchPage> => {
        const page = await serviceBoundary.call(ctx, exec.signal, 'event search', () =>
          ctx.sessionQuery.searchEvents({
            sessionId,
            query,
            filters,
            ...cursor === undefined ? {} : { cursor },
          }, { signal: exec.signal }))
        workspaceAccess.assertObservedTargetAuthorized(caller, sessionId, page.session)
        return page
      },
      () => true,
    )
    return presentation.formatEventSearch(sessionId, title, collected)
  }

  /**
   * Trace Session lineage within the caller’s workspace permissions.
   * @param args - Optional target Session id; defaults to the caller.
   * @param exec - Agent-bound caller and cancellation signal.
   * @returns Formatted authorized ancestors and descendants.
   */
  async executeSessionTrace(
    args: SessionTargetArgs,
    exec: ToolRunContext,
  ): Promise<string> {
    const ctx = this.ctx
    const caller = this.callerOf(exec)
    const sessionId = workspaceAccess.targetId(args, caller)
    await workspaceAccess.authorizeTarget(ctx, caller, sessionId, exec.signal)
    const trace = await serviceBoundary.call(ctx, exec.signal, 'session lineage trace', () =>
      ctx.sessionQuery.traceSession(sessionId, exec.signal))
    workspaceAccess.assertObservedTargetAuthorized(caller, sessionId, trace.target.header)

    const ancestors: SessionRecord[] = []
    let ancestorBoundary = false
    for (const ancestor of trace.ancestors) {
      if (!workspaceAccess.recordAuthorized(ancestor, caller)) {
        ancestorBoundary = true
        break
      }
      ancestors.push(ancestor)
    }
    if (ancestors.length === trace.ancestors.length && !trace.complete) ancestorBoundary = true
    const descendants = workspaceAccess.authorizeDescendants(trace.descendants, caller)
    const visibleIds = [
      trace.target.header.id,
      ...ancestors.map(record => record.header.id),
      ...workspaceAccess.descendantIds(descendants),
    ]
    const titles = await workspaceAccess.readTitles(ctx, caller, visibleIds, exec.signal)
    return presentation.formatSessionTrace(trace, ancestors, ancestorBoundary, descendants, titles)
  }

  /**
   * Trace an event after authorizing its owning Session.
   * @param args - Target Session and event sequence.
   * @param exec - Agent-bound caller and cancellation signal.
   * @returns Formatted event lineage.
   */
  async executeEventTrace(
    args: EventTargetArgs,
    exec: ToolRunContext,
  ): Promise<string> {
    const ctx = this.ctx
    toolInput.assertNonNegativeSafeInteger('seq', args.seq)
    const seq = SessionSeq(args.seq)
    const caller = this.callerOf(exec)
    const sessionId = workspaceAccess.targetId(args, caller)
    await workspaceAccess.authorizeTarget(ctx, caller, sessionId, exec.signal)
    const trace = await serviceBoundary.call(ctx, exec.signal, 'event trace', () =>
      ctx.sessionQuery.traceEvent({ sessionId, seq }, exec.signal))
    workspaceAccess.assertObservedTargetAuthorized(caller, sessionId, trace.session)
    const title = await workspaceAccess.readTitle(ctx, caller, sessionId, exec.signal)
    return presentation.formatEventTrace(sessionId, title, trace)
  }

  /**
   * Read an event window after authorizing its owning Session.
   * @param args - Target event and surrounding event counts.
   * @param exec - Agent-bound caller and cancellation signal.
   * @returns Formatted event window.
   */
  async executeEventRead(
    args: EventReadArgs,
    exec: ToolRunContext,
  ): Promise<string> {
    const ctx = this.ctx
    toolInput.assertNonNegativeSafeInteger('seq', args.seq)
    const seq = SessionSeq(args.seq)
    if (args.before !== undefined) toolInput.assertNonNegativeSafeInteger('before', args.before)
    if (args.after !== undefined) toolInput.assertNonNegativeSafeInteger('after', args.after)
    const caller = this.callerOf(exec)
    const sessionId = workspaceAccess.targetId(args, caller)
    await workspaceAccess.authorizeTarget(ctx, caller, sessionId, exec.signal)
    const window = await serviceBoundary.call(ctx, exec.signal, 'event read', () =>
      ctx.sessionQuery.readEvent({
        sessionId,
        seq,
        ...args.before === undefined ? {} : { before: args.before },
        ...args.after === undefined ? {} : { after: args.after },
      }, exec.signal))
    workspaceAccess.assertObservedTargetAuthorized(caller, sessionId, window.session)
    const title = await workspaceAccess.readTitle(ctx, caller, sessionId, exec.signal)
    return presentation.formatEventRead(sessionId, title, window)
  }
}

async function collectPages<T>(
  maxResults: number,
  signal: AbortSignal,
  request: (cursor?: SessionSearchCursor) => Promise<{
    readonly items: readonly T[]
    readonly nextCursor?: SessionSearchCursor
  }>,
  accept: (item: T) => boolean,
): Promise<SearchCollection<T>> {
  const items: T[] = []
  const seen = new Set<SessionSearchCursor>()
  let cursor: SessionSearchCursor | undefined
  while (true) {
    signal.throwIfAborted()
    const page = await request(cursor)
    signal.throwIfAborted()
    for (const item of page.items) {
      if (!accept(item)) continue
      if (items.length === maxResults) {
        return { items, capped: true }
      }
      items.push(item)
    }
    if (page.nextCursor === undefined) return { items, capped: false }
    if (seen.has(page.nextCursor)) {
      throw new SessionQueryError(
        'session-search provider repeated a continuation cursor',
        'SESSION_QUERY_INVALID_CURSOR',
      )
    }
    seen.add(page.nextCursor)
    cursor = page.nextCursor
  }
}

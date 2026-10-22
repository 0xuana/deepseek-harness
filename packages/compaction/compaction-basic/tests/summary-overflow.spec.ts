import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CONTEXT_WINDOW_EXCEEDED_CODE, createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage, LlmError, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { compactSurfaceRegion } from '../src/region.ts'
import type { SummarizationInput, SummaryResult } from '../src/summarizer.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

const historyText = 'A retained source fact with enough detail for a smaller checkpoint. '.repeat(80)

function overflow(): LlmError {
  return new LlmError('summary input exceeds the model context', CONTEXT_WINDOW_EXCEEDED_CODE)
}

function summary(text = 'The older task details are summarized.'): SummaryResult {
  return { summary: [{ type: 'text', text }], provider: 'test', model: 'summary' }
}

/** Each tool unit contains two calls and both results; user units contain one message. */
function harness(units: readonly ('user' | 'tools')[]) {
  const ctx = new Context()
  contexts.push(ctx)
  new SessionProjectionRegistry(ctx)
  const meter = new TokenMeter(ctx)
  const session = Session.create(SessionId('summary-overflow'))
  session.append('turn/start', { turn: 1 })
  const head = session.append('system/message', {
    turn: 1, step: 1, message: createSystemMessage(historyText),
  }, { surfaceOp: 'append' })
  for (const [index, unit] of units.entries()) {
    if (unit === 'user') {
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: `${index}: ${historyText}` }], source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      continue
    }
    const step = index + 1
    const callIds = [ToolCallId(`call-${index}-a`), ToolCallId(`call-${index}-b`)]
    session.append('step/start', { turn: 1, step })
    session.append('assistant/message', {
      turn: 1, step, stream: [],
      message: createAssistantMessage({
        source: { provider: 'test', model: 'test' },
        content: callIds.map(id => ({ type: 'tool-call', id, name: 'read', arguments: '{}' })),
      }),
    }, { surfaceOp: 'append' })
    for (const callId of callIds) {
      session.append('tool/call', { turn: 1, step, callId, name: 'read', arguments: '{}' })
      session.append('tool/result', {
        turn: 1, step,
        message: createToolResultMessage({ callId, content: [{ type: 'text', text: historyText }], isError: false }),
      }, { surfaceOp: 'append' })
    }
    session.append('step/end', { turn: 1, step })
  }
  const selected = session.surface.nodes.slice(1)
  const start = selected[0]
  const end = selected.at(-1)
  if (start === undefined || end === undefined) throw new Error('fixture needs a nonempty selection')
  const tail = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Keep the newest request verbatim.' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const agent = { session, options: { provider: 'test', model: 'test' } } as Agent
  const summarize = vi.fn<(input: SummarizationInput) => Promise<SummaryResult>>()
  const recover = vi.fn<Parameters<typeof compactSurfaceRegion>[0]['recover']>(() => false)
  const requests: SummarizationInput[] = []
  const run = (allowSmallerPrefix = true, signal?: AbortSignal, owner: 'current-turn' | null = 'current-turn') => compactSurfaceRegion({
    meter,
    summarize(input) { requests.push(input); return summarize(input) },
    recover,
  }, session, start, end, agent, {
    owner, stability: owner === null ? 'selected-span' : 'whole-surface',
    ...allowSmallerPrefix ? { allowSmallerPrefix: true as const } : {},
  }, signal)
  return { session, head, tail, selected, requests, summarize, recover, run }
}

function sourceCount(input: SummarizationInput): number {
  return input.messages.filter(message => message.role !== 'system').length
}

function compactionTypes(session: Session): string[] {
  return session.snapshotEvents().filter(event => event.type.startsWith('compaction/')).map(event => event.type)
}

describe('summary context overflow', () => {
  it.each([8, 9])('halves complete prefixes until one fits and preserves the excluded suffix: %s units', async (count) => {
    const h = harness(Array.from({ length: count }, () => 'user'))
    h.summarize.mockImplementation(async (input) => {
      if (sourceCount(input) > 2) throw overflow()
      return summary()
    })
    const result = await h.run()
    expect(h.requests.map(sourceCount)).toEqual(count === 8 ? [8, 4, 2] : [9, 5, 3, 2])
    expect(result.shadowedSeqs).toEqual(h.selected.slice(0, 2))
    expect(h.session.surface.nodes.slice(2)).toEqual([...h.selected.slice(2), h.tail.seq])
    expect(h.session.surface.nodes[0]).toBe(h.head.seq)
    expect(compactionTypes(h.session)).toEqual(['compaction/start', 'compaction/summary', 'compaction/end'])
  })

  it('counts a tool-call message and all its results as one indivisible unit', async () => {
    const h = harness(['tools', 'user', 'user', 'user'])
    h.summarize.mockRejectedValueOnce(overflow()).mockResolvedValue(summary())
    const result = await h.run()
    expect(h.requests.map(sourceCount)).toEqual([6, 4])
    expect(h.requests[1]?.messages.map(message => message.role)).toEqual(['system', 'assistant', 'tool', 'tool', 'user'])
    expect(result.shadowedSeqs).toEqual(h.selected.slice(0, 4))
    expect(h.session.surface.nodes.slice(2)).toEqual([...h.selected.slice(4), h.tail.seq])
  })

  it.each(['user', 'tools'] as const)('stops at one indivisible %s unit without committing a checkpoint', async (unit) => {
    const h = harness([unit])
    const error = overflow()
    h.summarize.mockRejectedValue(error)
    const original = [...h.session.surface.nodes]
    await expect(h.run()).rejects.toBe(error)
    expect(h.summarize).toHaveBeenCalledTimes(1)
    expect(h.session.surface.nodes).toEqual(original)
    expect(compactionTypes(h.session)).toEqual(['compaction/start', 'compaction/end'])
  })

  it('exhausts progressively smaller prefixes when even the first unit overflows', async () => {
    const h = harness(Array.from({ length: 8 }, () => 'user'))
    const error = overflow()
    h.summarize.mockRejectedValue(error)
    const original = [...h.session.surface.nodes]
    await expect(h.run()).rejects.toBe(error)
    expect(h.requests.map(sourceCount)).toEqual([8, 4, 2, 1])
    expect(h.session.surface.nodes).toEqual(original)
    expect(compactionTypes(h.session)).toEqual(['compaction/start', 'compaction/end'])
  })

  it('keeps an explicitly requested range exact', async () => {
    const h = harness(['user', 'user', 'user', 'user'])
    const error = overflow()
    h.summarize.mockRejectedValue(error)
    await expect(h.run(false)).rejects.toBe(error)
    expect(h.summarize).toHaveBeenCalledTimes(1)
  })

  it.each([
    new LlmError('credentials expired', 'AUTH'),
    new LlmError('provider unavailable', 'SERVER'),
    new LlmError('summary truncated', 'MAX_TOKENS'),
    Object.assign(new Error('unclassified failure'), { code: CONTEXT_WINDOW_EXCEEDED_CODE }),
  ])('does not shorten for other failures: %s', async (error) => {
    const h = harness(['user', 'user', 'user', 'user'])
    h.summarize.mockRejectedValue(error)
    await expect(h.run()).rejects.toBe(error)
    expect(h.summarize).toHaveBeenCalledTimes(1)
    expect(compactionTypes(h.session)).toEqual(['compaction/start', 'compaction/end'])
  })

  it('does not retry or invoke recovery after cancellation', async () => {
    const h = harness(['user', 'user', 'user', 'user'])
    const controller = new AbortController()
    const error = overflow()
    h.summarize.mockImplementation(async () => { controller.abort('cancelled'); throw error })
    await expect(h.run(true, controller.signal)).rejects.toBe(error)
    expect(h.summarize).toHaveBeenCalledTimes(1)
    expect(h.recover).not.toHaveBeenCalled()
    expect(compactionTypes(h.session)).toEqual(['compaction/start', 'compaction/end'])
  })

  it('rejects a changed surface before considering a smaller selection', async () => {
    const h = harness(['user', 'user', 'user', 'user'])
    h.summarize.mockImplementation(async () => {
      h.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'concurrent input' }], source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      throw overflow()
    })
    await expect(h.run()).rejects.toThrow('session surface changed during summarization')
    expect(h.summarize).toHaveBeenCalledTimes(1)
    expect(h.recover).not.toHaveBeenCalled()
    expect(compactionTypes(h.session)).toEqual(['compaction/start', 'compaction/end'])
  })

  it.each(['manual', 'automatic'] as const)('retains %s stability rules when the excluded suffix changes after shortening', async (mode) => {
    const h = harness(Array.from({ length: 8 }, () => 'user'))
    if (mode === 'manual') h.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const replaced = h.selected[6]
    if (replaced === undefined) throw new Error('fixture needs a suffix node')
    let replacement = replaced
    h.summarize.mockRejectedValueOnce(overflow()).mockImplementation(async () => {
      replacement = h.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'Updated excluded suffix' }], source: { kind: 'user' },
      }), {
        surfaceOp: { op: 'replace', startSeq: replaced, endSeq: replaced }, sourceEventSeqs: [replaced],
      }).seq
      return summary()
    })
    const operation = h.run(true, undefined, mode === 'manual' ? null : 'current-turn')
    if (mode === 'manual') {
      const result = await operation
      expect(result.shadowedSeqs).toEqual(h.selected.slice(0, 4))
      expect(h.session.surface.nodes.slice(2)).toEqual([
        ...h.selected.slice(4, 6), replacement, ...h.selected.slice(7), h.tail.seq,
      ])
      expect(h.session.snapshotEvents().find(event => event.type === 'compaction/start')?.data).toMatchObject({ turn: null })
      expect(compactionTypes(h.session)).toEqual(['compaction/start', 'compaction/summary', 'compaction/end'])
    } else {
      await expect(operation).rejects.toThrow('session surface changed during summarization')
      expect(compactionTypes(h.session)).toEqual(['compaction/start', 'compaction/end'])
    }
    expect(h.requests.map(sourceCount)).toEqual([8, 4])
  })

  it('allows a registered durable repair to retain the entire selection', async () => {
    const h = harness(['user', 'user', 'user', 'user'])
    h.summarize.mockRejectedValueOnce(overflow()).mockResolvedValue(summary())
    h.recover.mockImplementationOnce(() => {
      h.session.append('system/message', {
        turn: 1, step: 1, message: createSystemMessage('Reduced system input'),
      }, { surfaceOp: { op: 'replace', startSeq: h.head.seq, endSeq: h.head.seq }, sourceEventSeqs: [h.head.seq] })
      return true
    })
    const result = await h.run()
    expect(h.requests.map(sourceCount)).toEqual([4, 4])
    expect(h.requests[1]?.messages[0]?.content).toEqual([{ type: 'text', text: 'Reduced system input' }])
    expect(result.shadowedSeqs).toEqual(h.selected)
    expect(compactionTypes(h.session)).toEqual(['compaction/start', 'compaction/summary', 'compaction/end'])
  })

  it('preserves the original surface if a smaller summary fails for another reason', async () => {
    const h = harness(['user', 'user', 'user', 'user'])
    const error = new LlmError('provider unavailable', 'SERVER')
    h.summarize.mockRejectedValueOnce(overflow()).mockRejectedValue(error)
    const original = [...h.session.surface.nodes]
    await expect(h.run()).rejects.toBe(error)
    expect(h.requests.map(sourceCount)).toEqual([4, 2])
    expect(h.session.surface.nodes).toEqual(original)
    expect(compactionTypes(h.session)).toEqual(['compaction/start', 'compaction/end'])
  })

  it('compares the checkpoint with the smaller source span before committing', async () => {
    const h = harness(['user', 'user', 'user', 'user'])
    h.summarize.mockRejectedValueOnce(overflow()).mockResolvedValue(summary(historyText.repeat(3)))
    const original = [...h.session.surface.nodes]
    await expect(h.run()).rejects.toThrow('summary is not smaller than the shadowed content')
    expect(h.requests.map(sourceCount)).toEqual([4, 2])
    expect(h.session.surface.nodes).toEqual(original)
    expect(compactionTypes(h.session)).toEqual(['compaction/start', 'compaction/end'])
  })
})

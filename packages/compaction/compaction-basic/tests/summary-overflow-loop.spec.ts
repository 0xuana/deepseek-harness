/** Summary overflow recovery through the real agent loop and image projections. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import {
  CONTEXT_WINDOW_EXCEEDED_CODE, LlmAdapter, LlmError, ToolCallId, createUserMessage,
} from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import * as imageOffload from '@deepseek-ai/dsh-compaction-image-offload'
import BasicCompactionEngine from '../src/index.ts'

type ImageBlock = Extract<ContentBlock, { type: 'image' }>

function image(name: string): ImageBlock {
  return {
    type: 'image',
    attachment: {
      attachmentId: `sha256:${'a'.repeat(64)}` as ImageBlock['attachment']['attachmentId'],
      name, mediaType: 'image/png', bytes: 1024, width: 1920, height: 1080,
    },
  }
}

function imageNames(options: GenerateOptions): string[] {
  return options.messages.flatMap(message => message.content.flatMap(block =>
    block.type === 'image' && block.offloaded !== true ? [block.attachment.name ?? ''] : []))
}

/** Capacity is computed from valid image occurrences; successful calls report exact fixture usage. */
class ImageCapacityAdapter extends LlmAdapter {
  readonly requests: Array<{ purpose: string; images: string[]; overflow: boolean }> = []
  private toolIssued = false

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'], context: { contextWindow: 10_000 } })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const images = imageNames(options)
    const textTokens = options.messages.reduce((total, message) => total + message.content.reduce((sum, block) =>
      sum + (block.type === 'text' ? Math.ceil(block.text.length / 4) : 0), 4), 0)
    const inputTokens = images.length * 2000 + textTokens
    const overflow = inputTokens + (options.maxTokens ?? 0) > 10_000
    this.requests.push({ purpose: options.purpose ?? 'conversation', images, overflow })
    if (overflow) throw new LlmError('fixture image context exceeds the model window', CONTEXT_WINDOW_EXCEEDED_CODE)

    const lastText = options.messages.at(-1)?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
    const callsTool = options.purpose !== 'compaction' && lastText === 'Collect two more screenshots.' && !this.toolIssued
    if (callsTool) {
      this.toolIssued = true
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('capture'), name: 'capture_images', arguments: '{}' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: options.purpose === 'compaction' ? 'Earlier screenshots were reviewed.' : 'Received.' } }
    }
    yield { type: 'usage', usage: { inputTokens, outputTokens: 10 } }
    yield { type: 'finish', reason: { kind: callsTool ? 'tool-calls' : 'stop' } }
  }
}

describe('summary overflow through the agent loop', () => {
  it('summarizes a smaller prefix and retries with the untouched image suffix', async () => {
    const ctx = new Context()
    const adapter = new ImageCapacityAdapter()
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(imageOffload)
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(TokenMeter)
      ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
      ctx.effect(() => ctx.tools.register(defineContentToolFixture({
        name: 'capture_images', description: 'Return two screenshot references', parameters: {},
        async execute(_args, exec) {
          if (exec.agent === undefined) throw new Error('image fixture requires an agent')
          // Steering makes the complete tool exchange eligible for prefix compaction.
          exec.agent.steer(createUserMessage({ content: [{ type: 'text', text: 'Continue inspecting the screenshots.' }], source: { kind: 'user' } }))
          return [image('recent-a'), image('recent-b')]
        },
      })))
      await ctx.plugin(BasicCompactionEngine, { headroomTokens: 0, thresholdRatio: 1, retainTokens: 100, maxTokens: 256 })
      const agent = await ctx.agentLoop.create(SessionId('image-summary-overflow'), { provider: 'mock', model: 'vision', maxTokens: 256 })
      for (const label of ['old', 'middle']) {
        agent.followup(createUserMessage({
          content: [{ type: 'text', text: `${label}: ${'dashboard details '.repeat(40)}` }, image(`${label}-a`), image(`${label}-b`)],
          source: { kind: 'user' },
        }))
        await agent.whenIdle()
        expect(agent.session.snapshotEvents().at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      }
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Collect two more screenshots.' }], source: { kind: 'user' } }))
      await agent.whenIdle()

      const summaries = adapter.requests.filter(request => request.purpose === 'compaction')
      expect(summaries).toHaveLength(2)
      expect(summaries[0]).toMatchObject({ overflow: true, images: ['old-a', 'old-b', 'middle-a', 'middle-b', 'recent-a', 'recent-b'] })
      expect(summaries[1]).toMatchObject({ overflow: false, images: ['old-a', 'old-b', 'middle-a', 'middle-b'] })
      expect(adapter.requests.at(-1)).toMatchObject({ purpose: 'conversation', overflow: false, images: ['recent-a', 'recent-b'] })

      const events = agent.session.snapshotEvents()
      expect(events.filter(event => event.type === 'compaction/start')).toHaveLength(1)
      expect(events.filter(event => event.type === 'compaction/end')).toHaveLength(1)
      expect(events.filter(event => event.type === 'compaction/summary')).toHaveLength(1)
      expect(events.filter(event => event.type === 'image/offload')).toEqual([])
      expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      expect(agent.session.surface.replaceGeneration).toBe(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

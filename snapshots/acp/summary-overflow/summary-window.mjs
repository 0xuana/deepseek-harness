/** Reject summaries containing both screenshot groups without consuming a replay entry. */
export const name = 'summary-window'
export const inject = ['llm']

/** @param {import('@deepseek-ai/cordis').Context} ctx - Scenario-local context. */
export function apply(ctx) {
  ctx.on('llm/stream', async function* (options, next) {
    const images = options.messages.flatMap(message => message.content)
      .filter(block => block.type === 'image')
    if (options.purpose === 'compaction' && images.length > 3) {
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: {
          code: 'CONTEXT_WINDOW_EXCEEDED', message: 'summary screenshots exceed the authored context window',
        } },
      }
      return
    }
    const hasCheckpoint = options.messages.some(message => message.source?.kind === 'compact-checkpoint')
    if (options.purpose !== 'compaction' && hasCheckpoint
      && (images.length !== 3 || images.some(image => image.offloaded === true))) {
      throw new Error('summary recovery must retain the second screenshot group')
    }
    yield* next()
  })
}

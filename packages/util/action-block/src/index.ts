/** Fenced `dsh-action` blocks: JSON objects an assistant answer ends with to propose a card the user may click.
 * @module @deepseek-ai/dsh-util-action-block */

/** Fence language that marks a proposal block; chat renderers hide fences with this language. */
export const ACTION_BLOCK_LANGUAGE = 'dsh-action'

const FENCE = /```dsh-action[^\n]*\n([\s\S]*?)\n```/gu

/**
 * Parse every well-formed JSON object inside `dsh-action` fences, in order. Malformed JSON and
 * non-object values create no block; callers validate the fields of each object.
 * @param text - assistant answer text.
 * @returns parsed objects, in answer order.
 */
export function actionBlocksOf(text: string): unknown[] {
  const objects: unknown[] = []
  for (const match of text.matchAll(FENCE)) {
    try {
      const value: unknown = JSON.parse(String(match[1]).trim())
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) objects.push(value)
    } catch {
      // Malformed JSON inside a fence creates no block; the answer stays as written.
    }
  }
  return objects
}

/**
 * Read the action a parsed block names, so a card experiment can tell its own blocks from another's.
 * @param block - a value returned by {@link actionBlocksOf}.
 * @returns the non-blank `action` string, or undefined when the block names none.
 */
export function actionOf(block: unknown): string | undefined {
  if (typeof block !== 'object' || block === null || !('action' in block)) return undefined
  const { action } = block
  return typeof action === 'string' && action.trim() !== '' ? action : undefined
}

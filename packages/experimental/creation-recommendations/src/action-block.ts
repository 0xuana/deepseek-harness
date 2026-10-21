/** Model-written proposal blocks: fenced `dsh-action` JSON objects in an assistant answer. */

/** Fence language that marks a proposal block; the chat hides fences with this language. */
export const ACTION_BLOCK_LANGUAGE = 'dsh-action'

const FENCE = /```dsh-action[^\n]*\n([\s\S]*?)\n```/gu

/** Parse every well-formed JSON object inside `dsh-action` fences, in order; malformed fences are skipped.
 * @param text - assistant answer text.
 * @returns parsed objects; callers validate their fields.
 */
export function actionBlocksOf(text: string): unknown[] {
  const objects: unknown[] = []
  for (const match of text.matchAll(FENCE)) {
    try {
      const value: unknown = JSON.parse(match[1]!.trim())
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) objects.push(value)
    } catch {
      // Malformed JSON inside a fence creates no proposal; the answer stays as written.
    }
  }
  return objects
}

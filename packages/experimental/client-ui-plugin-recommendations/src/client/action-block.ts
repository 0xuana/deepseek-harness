/** Browser-side reader for `dsh-action` proposal blocks; the Host validates the same format. */

const FENCE = /```dsh-action[^\n]*\n([\s\S]*?)\n```/gu

/** Parse every well-formed JSON object inside `dsh-action` fences, in order; malformed fences are skipped.
 * @param text - assistant answer text.
 * @returns parsed objects; callers validate their fields.
 */
// Each optional card bundle reads blocks in its own Client bundle until the shared action-card layer owns this reader.
/* jscpd:ignore-start */
export function actionBlocksOf(text: string): unknown[] {
  const objects: unknown[] = []
  for (const match of text.matchAll(FENCE)) {
    try {
      const value: unknown = JSON.parse((match[1] as string).trim())
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) objects.push(value)
    } catch {
      // A malformed fence is ordinary text for the reader; it creates no card.
    }
  }
  return objects
}
/* jscpd:ignore-end */

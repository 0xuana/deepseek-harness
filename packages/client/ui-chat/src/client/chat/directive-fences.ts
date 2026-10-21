/** Fences in the `dsh-` language namespace carry Host-interpreted blocks, not prose; the chat hides them. */

const FENCE = /(^|\n)```dsh-[^\n]*\n[\s\S]*?(?:\n```[^\S\n]*(?=\n|$)|$)/gu

/** Remove `dsh-` fences from answer text, including an unclosed fence still streaming.
 * @param text - assistant text block.
 * @returns the text without directive fences; surrounding prose is unchanged.
 */
export function hideDirectiveFences(text: string): string {
  if (!text.includes('```dsh-')) return text
  return text.replace(FENCE, '$1').replace(/\n{3,}/gu, '\n\n').replace(/^\n+/u, '').trimEnd()
}

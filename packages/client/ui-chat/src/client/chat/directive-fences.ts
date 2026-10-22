/** Fences in the `dsh-` language namespace carry Host-interpreted blocks, not prose; the chat hides them. */
import { hideDirectiveFences as withoutDirectiveFences } from '@deepseek-ai/dsh-util-action-block'

/** Remove top-level `dsh-` fences from answer text by the shared CommonMark scan.
 * @param text - assistant text.
 * @param options - `streaming` also removes an unclosed last fence; a finished answer keeps it as text.
 * @returns the text unchanged when nothing is hidden; otherwise without the fences, leading line breaks or trailing whitespace.
 */
export function hideDirectiveFences(text: string, options?: { readonly streaming?: boolean }): string {
  const shown = withoutDirectiveFences(text, options)
  return shown === text ? text : shown.replace(/^\n+/u, '').trimEnd()
}

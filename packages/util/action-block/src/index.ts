/** Fenced `dsh-` directive blocks of assistant answers: the top-level fence scan, the `dsh-action` JSON
 * blocks an answer ends with to propose a card, and the answer text without directive fences.
 * @module @deepseek-ai/dsh-util-action-block */

/** Fence language that marks a proposal block. */
export const ACTION_BLOCK_LANGUAGE = 'dsh-action'

/** Language prefix of every directive fence; chat renderers hide these fences. */
const DIRECTIVE_PREFIX = 'dsh-'

/** One top-level fenced code block whose language starts with `dsh-`. */
export interface DirectiveFence {
  /** First word of the info string, such as `dsh-action`. */
  readonly language: string
  /** Offset of the opening fence line. */
  readonly start: number
  /** Offset just past the closing fence line and its line ending, or the text length when the fence is unclosed. */
  readonly end: number
  /** False when no closing fence line follows, so the block runs to the end of the text. */
  readonly closed: boolean
  /** Lines between the fence lines without their line endings, joined with `\n`. */
  readonly body: string
}

interface Line {
  readonly start: number
  /** Offset just past the line ending, or the text length for an unterminated last line. */
  readonly end: number
  /** Line content without `\n` or `\r\n`. */
  readonly text: string
}

interface Fence {
  readonly language: string
  readonly marker: string
  readonly opening: Line
  readonly closing: Line | undefined
  readonly content: readonly Line[]
  /** Line indexes of the opening line and of the closing line, or of the last line when unclosed. */
  readonly first: number
  readonly last: number
}

const OPENING = /^ {0,3}(?:`{3,}|~{3,})/u
const CLOSING = /^ {0,3}(?:`{3,}|~{3,})[ \t]*$/u
const BLANK = /^[ \t]*$/u

function linesOf(text: string): Line[] {
  const lines: Line[] = []
  let start = 0
  while (start < text.length) {
    const newline = text.indexOf('\n', start)
    const end = newline === -1 ? text.length : newline + 1
    const content = text.slice(start, newline === -1 ? end : newline)
    lines.push({ start, end, text: content.endsWith('\r') ? content.slice(0, -1) : content })
    start = end
  }
  return lines
}

function closes(text: string, marker: string): boolean {
  const closing = CLOSING.exec(text)
  if (closing === null) return false
  const run = closing[0].trim()
  return run.charAt(0) === marker.charAt(0) && run.length >= marker.length
}

/** CommonMark fenced code blocks outside any other fence, of every language, in text order. */
function fencesOf(lines: readonly Line[]): Fence[] {
  const fences: Fence[] = []
  let open: Omit<Fence, 'closing' | 'content' | 'last'> & { readonly content: Line[] } | undefined
  for (const [index, line] of lines.entries()) {
    if (open === undefined) {
      const opening = OPENING.exec(line.text)
      if (opening === null) continue
      const marker = opening[0].trimStart()
      const info = line.text.slice(opening[0].length).trim()
      // A backtick fence's info string cannot contain a backtick; such a line is inline code.
      if (marker.startsWith('`') && info.includes('`')) continue
      const space = info.search(/[ \t]/u)
      open = { language: space === -1 ? info : info.slice(0, space), marker, opening: line, content: [], first: index }
    } else if (closes(line.text, open.marker)) {
      fences.push({ ...open, closing: line, last: index })
      open = undefined
    } else {
      open.content.push(line)
    }
  }
  if (open !== undefined) fences.push({ ...open, closing: undefined, last: lines.length - 1 })
  return fences
}

/**
 * Find the fenced code blocks whose language starts with `dsh-`, following CommonMark for fences outside any
 * other fence. An opening line has at most three spaces of indentation, three or more backticks or tildes, and an
 * info string whose first word is the language; a backtick fence's info string contains no backtick. The first
 * later line with at most three spaces of indentation, at least as many of the same character and nothing else
 * but spaces or tabs closes it. Lines inside a fence of any language are its content, and fence characters after
 * other text on a line open nothing. Block quotes and list items are not parsed as containers. Lines may end with
 * `\n` or `\r\n`.
 * @param text - assistant answer text.
 * @returns the directive fences in text order, including an unclosed last fence.
 */
export function scanDirectiveFences(text: string): readonly DirectiveFence[] {
  return fencesOf(linesOf(text)).flatMap(fence => fence.language.startsWith(DIRECTIVE_PREFIX) ? [{
    language: fence.language, start: fence.opening.start,
    end: fence.closing === undefined ? text.length : fence.closing.end, closed: fence.closing !== undefined,
    body: fence.content.map(line => line.text).join('\n'),
  }] : [])
}

function objectOf(body: string): object | undefined {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    // JSON.parse throws SyntaxError for a malformed block, which creates no block; the answer stays as written.
    return undefined
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

/**
 * Parse every JSON object inside a closed `dsh-action` fence found by {@link scanDirectiveFences}, in order.
 * Malformed JSON, arrays, scalars and unclosed fences create no block; callers validate the fields of each object.
 * @param text - assistant answer text.
 * @returns parsed objects, in answer order.
 */
export function actionBlocksOf(text: string): unknown[] {
  return scanDirectiveFences(text).flatMap((fence) => {
    const value = fence.closed && fence.language === ACTION_BLOCK_LANGUAGE ? objectOf(fence.body.trim()) : undefined
    return value === undefined ? [] : [value]
  })
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

/**
 * Remove the lines of each fence found by {@link scanDirectiveFences}, from the opening line through the closing
 * line and its line ending. Other text is unchanged with two exceptions at a removed fence preceded by a blank
 * line: a blank line directly after the fence is removed too, and when nothing follows the fence, the blank line
 * before it is removed.
 * @param text - assistant answer text.
 * @param options - `streaming` also removes an unclosed last fence, whose rest has not arrived yet; otherwise an
 * unclosed fence stays in the text.
 * @returns the text to render.
 */
export function hideDirectiveFences(text: string, options: { readonly streaming?: boolean } = {}): string {
  const lines = linesOf(text)
  const hidden = new Set<number>()
  for (const fence of fencesOf(lines)) {
    if (!fence.language.startsWith(DIRECTIVE_PREFIX) || fence.closing === undefined && options.streaming !== true) continue
    for (let index = fence.first; index <= fence.last; index++) hidden.add(index)
    let before = fence.first - 1
    while (hidden.has(before)) before--
    const previous = lines[before]
    if (previous === undefined || !BLANK.test(previous.text)) continue
    const next = lines[fence.last + 1]
    if (next === undefined) hidden.add(before)
    else if (BLANK.test(next.text)) hidden.add(fence.last + 1)
  }
  if (hidden.size === 0) return text
  return lines.flatMap((line, index) => hidden.has(index) ? [] : [text.slice(line.start, line.end)]).join('')
}

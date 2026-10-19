/**
 * Performance table for one conversation: per-turn aggregates, expandable step
 * rows, the time-composition bars, and the per-step tool-call accordion.
 */

import { Fragment, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  PerfCall, PerfSnapshot, PerfStepMetrics, PerfToolCount, PerfTurnMetrics,
} from './perf-contract.ts'
import {
  DASH, barShare, formatChars, formatClock, formatDateTime, formatMs, formatPercent,
  formatTokens, formatTokensDelta, formatTokensShort, formatTps,
} from './perf-format.ts'
import { isNumber } from './perf-usage.ts'
import type { PerfTranslate } from './locales.ts'
import css from './perf.module.css'

/** Turns rendered per page; the newest page is the tail of the turn list. */
const PAGE_SIZE = 10
/** Steps one turn renders before the "show all" control appears. */
const STEP_LIMIT = 24
/** Tool calls one step's accordion lists; the builder keeps at most this many. */
const CALL_LIMIT = 12
/** Lines one code block renders before the line-cap notice. */
const CODE_LINE_LIMIT = 400
/** Line count above which a diff falls back to whole-side removal and addition. */
const DIFF_LINE_LIMIT = 300
/** Numeric columns in table order. */
const COLUMNS = ['context', 'output', 'cache', 'ttft', 'model', 'tps', 'tool'] as const

/** One numeric column name. */
type NumericColumn = typeof COLUMNS[number]

/** Column count of the scope, prompt, did, numeric, and time columns. */
const TOTAL_COLUMNS = COLUMNS.length + 4

/** Fixed palette indexes for tools that keep one tone across sessions. */
const TOOL_TONES: Readonly<Record<string, number>> = {
  read: 0,
  glob: 1,
  grep: 1,
  edit: 2,
  write: 2,
  apply_patch: 2,
  pwsh: 4,
  shell: 4,
  bash: 4,
  web_fetch: 5,
  web_search: 5,
  ask_user_question: 3,
  todo_write: 7,
  subagent: 5,
  subagent_fork: 5,
}

/** Tone classes, one per palette index; each sets `--perf-tool-color`. */
const TONE_CLASSES: readonly (string | undefined)[] = [
  css.tone0, css.tone1, css.tone2, css.tone3,
  css.tone4, css.tone5, css.tone6, css.tone7,
]

/**
 * Join CSS module classes into one `className`, dropping absent entries: the
 * module's index-signature declaration types every lookup as possibly absent
 * under `noUncheckedIndexedAccess`.
 * @param names - class names in declaration order.
 * @returns the space-joined class list.
 */
function cx(...names: readonly (string | undefined)[]): string {
  return names.filter((name): name is string => name !== undefined).join(' ')
}

/** Business face injected by the browser plugin. */
export interface PerfViewInjected {
  /** Snapshot sources bound by InjectFace. */
  hooks: {
    /** This target's snapshot; InjectFace exposes it as `usePerf`. */
    perf: ObservableSnapshot<PerfSnapshot>
  }
}

/** Full props of the performance conversation View. */
export type PerfViewProps =
  ConvViewProps & InjectFace<PerfViewInjected> & PropsLocale<'perf'>

/** Open/closed default for turns the user never toggled explicitly. */
type ViewMode = 'newest' | 'all' | 'none'

/** Step-list presentation of one turn: newest slice or all steps, plus filters. */
interface StepViewState {
  readonly mode?: 'tail' | 'all'
  readonly filter?: string | null
  readonly open?: Readonly<Record<number, boolean>>
  readonly raw?: Readonly<Record<string, boolean>>
  readonly wrap?: boolean
}

/** Component-local table state: page anchor, turn folds, and per-turn step state. */
interface ViewState {
  readonly anchor: number | null
  readonly mode: ViewMode
  readonly openTurns: Readonly<Record<number, boolean>>
  readonly stepViews: Readonly<Record<number, StepViewState>>
}

/** Fields both row kinds expose to the numeric column helpers. */
interface MetricsValues {
  readonly context: number | null
  readonly output: number | null
  readonly cacheHit: number | null
  readonly ttft: number | null
  readonly model: number | null
  readonly tps: number | null
  readonly tool: number | null
  readonly cacheRead?: number | null
  readonly cacheWrite?: number | null
  readonly ttftPending?: number
  readonly modelPending?: number
  readonly toolPending?: number
}

/** Fields the scope markers read from a turn or step row. */
interface ScopeState {
  readonly running: boolean
  readonly interrupted: boolean
  readonly aborted: boolean
  readonly retries: number
  readonly cacheHit: number | null
}

/** Fields the time-composition bar reads from a turn or step row. */
interface TimeState {
  readonly running: boolean
  readonly startTime: number | null
  readonly wall: number | null
  readonly ttft: number | null
  readonly model: number | null
  readonly tool: number | null
}

/** Context growth from the previous step of the same turn. */
interface ContextDelta {
  readonly from: number
  readonly to: number
  readonly diff: number
  readonly chars: number
  readonly tokens: number | null
}

/** Text and tooltip of one numeric cell. */
interface CellText {
  readonly text: string
  readonly title: string
}

/** One numeric cell with its column name. */
interface MetricCell extends CellText {
  readonly name: NumericColumn
}

/** One rendered code line: diff sign plus the line text. */
interface CodeLine {
  readonly sign: ' ' | '+' | '−'
  readonly text: string
}

/** File body unwrapped from a `read` tool result. */
interface FileContent {
  readonly path: string | null
  readonly body: string
}

/** A tool-name plus target group shown in the step's did column. */
interface CallGroup {
  readonly key: string
  readonly name: string | null
  readonly hint: string | null
  readonly calls: readonly PerfCall[]
}

/** Table state shared by one turn's rendered rows. */
interface TurnRowsOptions {
  readonly turn: PerfTurnMetrics
  readonly t: PerfTranslate
  readonly now: number
  readonly open: boolean
  readonly state: StepViewState
  readonly turnScale: number
  readonly onToggle: () => void
  readonly onToggleDetail: (stepNumber: number) => void
  readonly onControl: (patch: Partial<StepViewState>) => void
}

/** Row state of one turn's step rows (no turn header fields). */
interface StepRowsOptions {
  readonly turn: PerfTurnMetrics
  readonly t: PerfTranslate
  readonly now: number
  readonly state: StepViewState
  readonly onToggleDetail: (stepNumber: number) => void
  readonly onControl: (patch: Partial<StepViewState>) => void
}

/** Props of one tool-call block inside the step accordion. */
interface CallBlockProps {
  readonly call: PerfCall
  readonly t: PerfTranslate
  readonly wrap: boolean
  readonly raw: boolean
  readonly onToggleRaw: () => void
}

/** Props of the clipboard button. */
interface CopyButtonProps {
  readonly clipboardValue: string
  readonly t: PerfTranslate
}

/** Props of one numeric cell group (context excluded by the caller). */
interface MetricCellsProps {
  readonly cells: readonly MetricCell[]
  readonly className: string | undefined
}

/** Props of the context column cell. */
interface ContextCellProps {
  readonly value: number | null
  readonly delta: number | null
  readonly title: string
  readonly className: string | undefined
}

/** Props of the time-composition cell. */
interface TimeCellProps {
  readonly value: TimeState
  readonly scale: number
  readonly gap: number | undefined
  readonly className: string | undefined
  readonly trackClass: string | undefined
  readonly now: number
  readonly t: PerfTranslate
}

/** Props of the pagination/expand footer button. */
interface TableButtonProps {
  readonly caption: string
  readonly enabled: boolean
  readonly onClick: () => void
}

/** Props of the prompt column cell. */
interface PromptCellProps {
  readonly turn: PerfTurnMetrics
  readonly t: PerfTranslate
  readonly className: string | undefined
}

/** Empty per-turn step state, shared so unexpanded turns allocate nothing. */
const EMPTY_STEP_VIEW: StepViewState = {}

/** Index of the tool tone for one call name; unknown names hash to a stable tone. */
function toneIndex(name: string | null): number {
  if (name === null) return 7
  const fixed = TOOL_TONES[name]
  if (fixed !== undefined) return fixed
  let hash = 0
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 9973
  }
  return hash % TONE_CLASSES.length
}

/** CSS class carrying the tool tone for one call name. */
function toneClass(name: string | null): string | undefined {
  return TONE_CLASSES[toneIndex(name)]
}

/** Whether a row is running with no measured wall time yet. */
function isTimeRunning(value: TimeState): boolean {
  return value.running && !isNumber(value.wall) && isNumber(value.startTime)
}

/** Measured span; a running row falls back to the elapsed time at `now`. */
function totalSpan(value: TimeState, now: number): number | null {
  if (isNumber(value.wall)) return value.wall
  if (isNumber(value.startTime) && value.running) return Math.max(0, now - value.startTime)
  return null
}

/** Default fold state of a turn the user never toggled. */
function defaultTurnOpen(mode: ViewMode, turnNumber: number, latestTurn: number | null): boolean {
  if (mode === 'all') return true
  if (mode === 'none') return false
  return turnNumber === latestTurn
}

/** Fresh table state: follow the newest page, expand the newest turn. */
function createViewState(): ViewState {
  return { anchor: null, mode: 'newest', openTurns: {}, stepViews: {} }
}

/** Read an array element whose index the surrounding bounds already prove. */
function at(lines: readonly string[], index: number): string {
  return lines[index] as string
}

/** Split a text block into lines; an empty string has no lines. */
function splitLines(text: string): readonly string[] {
  return text === '' ? [] : text.split('\n')
}

/** Map a plain text block to code lines. */
function textLines(text: string): readonly CodeLine[] {
  return splitLines(text).map(line => ({ sign: ' ', text: line }))
}

/**
 * Line-level diff: removal/addition rows for the parts that differ, common
 * lines kept in place. Above the size cap the two sides are shown whole.
 */
function lineDiff(before: string | null, after: string | null): readonly CodeLine[] {
  const left = splitLines(before ?? '')
  const right = splitLines(after ?? '')
  if (left.length > DIFF_LINE_LIMIT || right.length > DIFF_LINE_LIMIT) {
    return [
      ...left.map(text => ({ sign: '−' as const, text })),
      ...right.map(text => ({ sign: '+' as const, text })),
    ]
  }
  const width = right.length + 1
  // LCS lengths for cells with row and column at least 1; the implicit zero row
  // and column are served by the missing-key fallback, never stored.
  const table = new Map<number, number>()
  let previousRow = 0
  for (let row = 1; row <= left.length; row += 1) {
    let leftCell = 0
    for (let column = 1; column <= right.length; column += 1) {
      const up = table.get(previousRow + column) ?? 0
      const diagonal = table.get(previousRow + column - 1) ?? 0
      const value = at(left, row - 1) === at(right, column - 1)
        ? diagonal + 1
        : Math.max(up, leftCell)
      table.set(row * width + column, value)
      leftCell = value
    }
    previousRow = row * width
  }
  const rows: CodeLine[] = []
  let row = left.length
  let column = right.length
  while (row > 0 && column > 0) {
    const leftLine = at(left, row - 1)
    const rightLine = at(right, column - 1)
    if (leftLine === rightLine) {
      rows.push({ sign: ' ', text: leftLine })
      row -= 1
      column -= 1
    } else if ((table.get((row - 1) * width + column) ?? 0) >= (table.get(row * width + column - 1) ?? 0)) {
      rows.push({ sign: '−', text: leftLine })
      row -= 1
    } else {
      rows.push({ sign: '+', text: rightLine })
      column -= 1
    }
  }
  while (row > 0) {
    rows.push({ sign: '−', text: at(left, row - 1) })
    row -= 1
  }
  while (column > 0) {
    rows.push({ sign: '+', text: at(right, column - 1) })
    column -= 1
  }
  return rows.reverse()
}

/** Unwrap the `<path>`/`<content>` envelope a `read` result carries. */
function fileContentOf(text: string | null): FileContent | null {
  if (text === null) return null
  const open = text.indexOf('<content>')
  const close = text.lastIndexOf('</content>')
  if (open < 0 || close < 0 || close < open) return null
  const pathMatch = /<path>([\s\S]*?)<\/path>/.exec(text)
  const body = text.slice(open + '<content>'.length, close).replace(/^\n/, '')
  let path: string | null = null
  if (pathMatch !== null) {
    /* v8 ignore next -- a matched `<path>` group is non-optional in the regexp, so the fallback is unreachable. */
    path = (pathMatch[1] ?? '').trim()
  }
  return { path, body }
}

/** CSS class of one code line by its diff sign. */
function lineClass(sign: CodeLine['sign']): string | undefined {
  if (sign === '+') return css.diffAdd
  if (sign === '−') return css.diffDel
  return css.codeLine
}

/** Code block: monospaced lines, capped at CODE_LINE_LIMIT rows. */
function codeBlock(lines: readonly CodeLine[], t: PerfTranslate, wrap: boolean): ReactElement {
  const shown = lines.length > CODE_LINE_LIMIT ? lines.slice(0, CODE_LINE_LIMIT) : lines
  return (
    <pre className={wrap ? cx(css.code, css.codeWrap) : css.code}>
      {shown.map((line, index) => (
        <span key={index} className={lineClass(line.sign)}>
          {line.sign === ' ' ? line.text : `${line.sign} ${line.text}`}
        </span>
      ))}
      {shown.length < lines.length ? (
        <span className={css.blockEmpty}>
          {t('detail.lineCap', { shown: formatTokens(shown.length), total: formatTokens(lines.length) })}
        </span>
      ) : null}
    </pre>
  )
}

/** Body of one tool call: raw arguments, a line diff, a file, or result text. */
function callBody(call: PerfCall, t: PerfTranslate, wrap: boolean, raw: boolean): ReactNode {
  if (raw && call.args !== null) {
    return (
      <Fragment>
        <div className={css.blockSub}>{t('detail.args')}</div>
        {codeBlock(textLines(call.args), t, wrap)}
      </Fragment>
    )
  }
  const edited = call.name === 'edit' || call.name === 'write' || call.name === 'apply_patch'
  if (edited) {
    const rows = lineDiff(call.before, call.after)
    if (rows.length > 0) {
      return (
        <Fragment>
          <div className={css.blockSub}>{t('detail.diff')}</div>
          {codeBlock(rows, t, wrap)}
        </Fragment>
      )
    }
  }
  const file = call.name === 'read' ? fileContentOf(call.text) : null
  if (file !== null) {
    const lines: readonly CodeLine[] = file.body.split('\n').map(line => ({
      sign: ' ' as const,
      text: line.replace(/^\s*\d+:\s?/, ''),
    }))
    return (
      <Fragment>
        <div className={css.blockSub}>
          {file.path ?? t('detail.file')}
          {` · ${t('detail.lines', { lines: formatTokens(lines.length) })}`}
        </div>
        {codeBlock(lines, t, wrap)}
      </Fragment>
    )
  }
  if (call.text === null) return <div className={css.blockEmpty}>{t('detail.emptyBody')}</div>
  return (
    <Fragment>
      {call.truncated ? (
        <div className={css.blockSub}>
          {t('detail.truncated', { chars: formatTokens(call.text.length) })}
        </div>
      ) : null}
      {codeBlock(textLines(call.text), t, wrap)}
    </Fragment>
  )
}

/** Clipboard button: copies the body and reports success for a moment. */
function CopyButton({ clipboardValue, t }: CopyButtonProps): ReactElement {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => { setCopied(false) }, 1200)
    return () => { clearTimeout(timer) }
  }, [copied])
  return (
    <button
      type="button"
      className={css.copy}
      title={t('detail.copy.title')}
      onClick={() => {
        try {
          void navigator.clipboard.writeText(clipboardValue).then(
            () => { setCopied(true) },
            () => undefined,
          )
        } catch {
          // The Clipboard API is absent outside secure contexts; the click stays silent.
        }
      }}
    >
      {copied ? t('detail.copied') : t('detail.copy')}
    </button>
  )
}

/** One tool call's accordion block: head metadata plus the selected body. */
function CallBlock({ call, t, wrap, raw, onToggleRaw }: CallBlockProps): ReactElement {
  const meta: string[] = []
  if (isNumber(call.chars)) meta.push(t('detail.chars', { chars: formatTokens(call.chars) }))
  if (isNumber(call.lines)) meta.push(t('detail.lines', { lines: formatTokens(call.lines) }))
  if (isNumber(call.ms)) meta.push(formatMs(call.ms))
  const fallback = [call.before ?? '', call.after ?? ''].filter(part => part !== '').join('\n')
  const clipboardValue = call.text ?? fallback
  return (
    <div className={css.block}>
      <div className={css.blockHead}>
        <span className={cx(css.toolName, toneClass(call.name))}>{call.name ?? '?'}</span>
        {call.hint === null ? null : <span className={css.blockHint}>{` ${call.hint}`}</span>}
        {meta.length === 0 ? null : <span className={css.blockMeta}>{` · ${meta.join(' · ')}`}</span>}
        {call.error ? (
          <span className={css.failPill} title={t('tool.failed.title', { count: 1 })}>
            {t('tool.failed', { count: 1 })}
          </span>
        ) : null}
        {call.args === null ? null : (
          <button
            type="button"
            className={raw ? css.chipOn : css.chip}
            title={t('detail.raw.title')}
            aria-pressed={raw}
            onClick={(event) => {
              event.stopPropagation()
              onToggleRaw()
            }}
          >
            {'{}'}
          </button>
        )}
        {clipboardValue === '' ? null : <CopyButton clipboardValue={clipboardValue} t={t} />}
      </div>
      {callBody(call, t, wrap, raw)}
    </div>
  )
}

/** Scope markers: running/interrupted/unsettled, retries, and cache misses. */
function scopeMarkers(value: ScopeState, t: PerfTranslate): ReactNode {
  return (
    <Fragment>
      {value.running ? <span className={css.stateRunning}>{t('state.running')}</span> : null}
      {!value.running && value.interrupted
        ? <span className={css.stateWarn}>{t('state.interrupted')}</span>
        : null}
      {!value.running && !value.interrupted && value.aborted
        ? (
          <span className={css.stateMuted} title={t('state.aborted.title')}>
            {t('state.aborted')}
          </span>
        )
        : null}
      {value.retries > 0
        ? <span className={css.stateWarn}>{t('did.retry', { count: value.retries })}</span>
        : null}
      {isNumber(value.cacheHit) && value.cacheHit < 0.5
        ? (
          <span className={css.stateWarn} title={t('state.cacheMiss.title')}>
            {t('state.cacheMiss')}
          </span>
        )
        : null}
    </Fragment>
  )
}

/** Tool pill with its tone dot and call count. */
function ToolPill({ item, t }: { readonly item: PerfToolCount; readonly t: PerfTranslate }): ReactElement {
  return (
    <span className={css.pill} title={t('did.title', { calls: item.count, tools: item.name })}>
      <span className={cx(css.dot, toneClass(item.name))} />
      {`${item.name} ×${item.count}`}
    </span>
  )
}

/** Turn tool composition bar: one growing segment per tool, ordered by count. */
function MixBar({ tools }: { readonly tools: readonly PerfToolCount[] }): ReactElement {
  return (
    <div className={css.mix}>
      {tools.map(item => (
        <span
          key={item.name}
          className={cx(css.mixSegment, toneClass(item.name))}
          style={{ flexGrow: item.count }}
        />
      ))}
    </div>
  )
}

/** Tool output summary shown after a call group in the did column. */
function toolStat(name: string, calls: readonly PerfCall[], t: PerfTranslate): ReactNode {
  if (name === 'read') {
    const lines = calls.reduce((sum, call) => sum + (isNumber(call.lines) ? call.lines : 0), 0)
    if (lines <= 0) return null
    return <span className={css.didStat}>{` ${t('did.lines', { lines: formatTokens(lines) })}`}</span>
  }
  if (name === 'edit' || name === 'write' || name === 'apply_patch') {
    const added = calls.reduce((sum, call) => sum + (isNumber(call.added) ? call.added : 0), 0)
    const removed = calls.reduce((sum, call) => sum + (isNumber(call.removed) ? call.removed : 0), 0)
    if (added === 0 && removed === 0) return null
    return (
      <span className={css.didStat}>
        {' '}
        {added > 0 ? (
          <span className={css.added}>
            {`+${formatTokens(added)}${removed > 0 ? '' : ` ${t('did.lines.unit')}`}`}
          </span>
        ) : null}
        {added > 0 && removed > 0 ? ' ' : null}
        {removed > 0 ? (
          <span className={css.removed}>
            {`−${formatTokens(removed)}${added > 0 ? '' : ` ${t('did.lines.unit')}`}`}
          </span>
        ) : null}
      </span>
    )
  }
  const chars = calls.reduce((sum, call) => sum + (isNumber(call.chars) ? call.chars : 0), 0)
  return chars > 0
    ? <span className={css.didStat}>{` ${t('did.chars', { chars: formatChars(chars) })}`}</span>
    : null
}

/** Group calls by tool name and target so `×2` means one target twice. */
function callGroups(calls: readonly PerfCall[]): readonly CallGroup[] {
  const groups = new Map<string, { key: string; name: string | null; hint: string | null; calls: PerfCall[] }>()
  for (const call of calls) {
    const key = `${call.name ?? ''}\u0000${call.hint ?? ''}`
    const group = groups.get(key)
    if (group === undefined) {
      groups.set(key, { key, name: call.name, hint: call.hint, calls: [call] })
    } else {
      group.calls.push(call)
    }
  }
  return [...groups.values()]
}

/** Context delta of each step against the previous measured step in its turn. */
function contextDeltas(turn: PerfTurnMetrics): ReadonlyMap<number, ContextDelta> {
  const deltas = new Map<number, ContextDelta>()
  let previous: number | null = null
  let previousChars = 0
  let previousTokens: number | null = null
  for (const step of turn.steps) {
    const context = step.context
    if (isNumber(previous) && isNumber(context) && context !== previous) {
      deltas.set(step.step, {
        from: previous,
        to: context,
        diff: context - previous,
        chars: previousChars,
        tokens: previousTokens,
      })
    }
    if (isNumber(context)) previous = context
    previousChars = isNumber(step.toolOutput) ? step.toolOutput : 0
    previousTokens = isNumber(step.output) ? step.output : null
  }
  return deltas
}

/** Gap between one step's start and the previous step's end. */
function stepGaps(turn: PerfTurnMetrics): ReadonlyMap<number, number> {
  const gaps = new Map<number, number>()
  let previousEnd: number | null = null
  for (const step of turn.steps) {
    const startTime = step.startTime
    if (isNumber(previousEnd) && isNumber(startTime) && startTime > previousEnd) {
      gaps.set(step.step, startTime - previousEnd)
    }
    if (isNumber(step.endTime)) previousEnd = step.endTime
  }
  return gaps
}

/** Step slice shown for one turn: filtered pool, then the newest STEP_LIMIT. */
function stepsOf(
  turn: PerfTurnMetrics,
  state: StepViewState,
): { readonly pool: readonly PerfStepMetrics[]; readonly shown: readonly PerfStepMetrics[] } {
  const filter = state.filter ?? null
  const pool = filter === null
    ? turn.steps
    : turn.steps.filter(step => step.tools.some(item => item.name === filter))
  const shown = state.mode === 'all' ? pool : pool.slice(-STEP_LIMIT)
  return { pool, shown }
}

/** One table cell holding a formatted number plus the tooltip for its source. */
function metricCell(
  value: number | null,
  format: (input: number | null) => string,
  t: PerfTranslate,
  pending: number | undefined,
): CellText {
  if (!isNumber(value)) return { text: DASH, title: t('unknown') }
  const text = format(value)
  if (pending === undefined || pending <= 0) return { text, title: '' }
  return { text: `≥ ${text}`, title: t('partial', { count: pending }) }
}

/** Reading of one numeric column; turn and step rows share it. */
const COLUMN_READ: Readonly<Record<NumericColumn, (value: MetricsValues) => number | null>> = {
  context: value => value.context,
  output: value => value.output,
  cache: value => value.cacheHit,
  ttft: value => value.ttft,
  model: value => value.model,
  tps: value => value.tps,
  tool: value => value.tool,
}

/** Formatting of one numeric column. */
const COLUMN_FORMAT: Readonly<Record<NumericColumn, (value: number | null) => string>> = {
  context: formatTokensShort,
  output: formatTokensShort,
  cache: formatPercent,
  ttft: formatMs,
  model: formatMs,
  tps: formatTps,
  tool: formatMs,
}

/** Unsettled calls that make a measured duration a lower bound. */
const COLUMN_PARTIAL: Readonly<
  Partial<Record<NumericColumn, (value: MetricsValues) => number | undefined>>
> = {
  ttft: value => value.ttftPending,
  model: value => value.modelPending,
  tool: value => value.toolPending,
}

/** Source breakdown of a cell that has one, replacing the formula tooltip. */
const COLUMN_DETAIL: Readonly<
  Partial<Record<NumericColumn, (value: MetricsValues, t: PerfTranslate) => string>>
> = {
  cache: (value, t) => {
    if (!isNumber(value.cacheHit)) return ''
    const read = isNumber(value.cacheRead) ? value.cacheRead : 0
    const write = isNumber(value.cacheWrite) ? value.cacheWrite : 0
    const context = isNumber(value.context) ? value.context : read + write
    const input = Math.max(0, context - read - write)
    return t('cache.detail', {
      read: formatTokens(read),
      input: formatTokens(input),
      write: formatTokens(write),
    })
  },
}

/** All numeric cells of one row, in table order. */
function metricsCells(value: MetricsValues, t: PerfTranslate): readonly MetricCell[] {
  return COLUMNS.map((name) => {
    const partial = COLUMN_PARTIAL[name]
    const cell = metricCell(
      COLUMN_READ[name](value),
      COLUMN_FORMAT[name],
      t,
      partial === undefined ? undefined : partial(value),
    )
    const detail = COLUMN_DETAIL[name]
    if (detail === undefined) return { name, ...cell }
    const title = detail(value, t)
    return { name, text: cell.text, title: title === '' ? cell.title : title }
  })
}

/** Numeric cells after the context column, which renders its own delta. */
function MetricCells({ cells, className }: MetricCellsProps): ReactElement {
  return (
    <Fragment>
      {cells.slice(1).map(cell => (
        <td key={cell.name} className={className} title={cell.title === '' ? undefined : cell.title}>
          {cell.text}
        </td>
      ))}
    </Fragment>
  )
}

/** Context column: value plus the signed change from the previous step. */
function ContextCell({ value, delta, title, className }: ContextCellProps): ReactElement {
  return (
    <td className={className} title={title === '' ? undefined : title}>
      <span className={css.num}>{formatTokensShort(value)}</span>
      {isNumber(delta) && delta !== 0
        ? (
          <span className={cx(css.numDelta, delta > 0 ? css.deltaUp : css.deltaDown)}>
            {formatTokensDelta(delta)}
          </span>
        )
        : <span className={css.numDelta} />}
    </td>
  )
}

/** Time-composition cell: four stacked segments plus the measured total. */
function TimeCell({ value, scale, gap, className, trackClass, now, t }: TimeCellProps): ReactElement {
  const total = totalSpan(value, now)
  if (total === null || total <= 0) {
    return (
      <td className={className} title={t('unknown')}>
        <span className={css.timeValue}>{DASH}</span>
      </td>
    )
  }
  const running = isTimeRunning(value)
  const ttft = isNumber(value.ttft) ? Math.min(value.ttft, total) : 0
  const model = isNumber(value.model) ? Math.min(value.model, total) : ttft
  const tool = isNumber(value.tool) ? Math.min(value.tool, total) : 0
  const decode = Math.max(0, model - ttft)
  const rest = Math.max(0, total - model - tool)
  const share = barShare(total, scale)
  const segments: ReactNode[] = []
  if (ttft > 0) {
    segments.push(<span key="ttft" className={cx(css.barSegment, css.barTtft)} style={{ flexGrow: ttft }} />)
  }
  if (decode > 0) {
    segments.push(<span key="decode" className={cx(css.barSegment, css.barDecode)} style={{ flexGrow: decode }} />)
  }
  if (tool > 0) {
    segments.push(<span key="tool" className={cx(css.barSegment, css.barTool)} style={{ flexGrow: tool }} />)
  }
  if (rest > 0) {
    segments.push(<span key="rest" className={cx(css.barSegment, css.barRest)} style={{ flexGrow: rest }} />)
  }
  const parts = [
    t('bar.ttft', { value: formatMs(ttft) }),
    t('bar.gen', { value: formatMs(decode) }),
    t('bar.tool', { value: formatMs(tool) }),
    t('bar.rest', { value: formatMs(rest) }),
    t('bar.wall', { value: formatMs(total) }),
  ]
  if (isNumber(value.startTime)) {
    parts.unshift(t('bar.start', { clock: formatClock(value.startTime) }))
  }
  if (gap !== undefined && gap > 0) parts.push(t('bar.gap', { value: formatMs(gap) }))
  if (running) parts.push(t('bar.running'))
  return (
    <td className={className} title={parts.join(' · ')}>
      <div className={css.timeWrap}>
        <div className={trackClass}>
          <div className={css.barFill} style={{ width: `${Math.round(share * 100)}%` }}>
            {segments}
          </div>
        </div>
        <span className={running ? css.timeRunning : css.timeValue}>
          {running ? `≥ ${formatMs(total)}` : formatMs(total)}
        </span>
      </div>
    </td>
  )
}

/** Prompt column: the turn's user question, clipped with the full text in the title. */
function PromptCell({ turn, t, className }: PromptCellProps): ReactElement {
  if (turn.prompt === null || turn.prompt === '') return <td className={className} />
  const images = turn.promptImages > 0 ? ` · ${t('turn.images', { count: turn.promptImages })}` : ''
  const text = turn.prompt + images
  return (
    <td className={className} title={text}>
      <span className={css.promptText}>{text}</span>
    </td>
  )
}

/** Step did column: tool calls grouped by name and target, with output sizes. */
function stepDidCell(step: PerfStepMetrics, t: PerfTranslate): ReactElement {
  const nodes: ReactNode[] = []
  if (step.toolErrors > 0) {
    nodes.push(
      <span key="failed" className={css.failPill} title={t('tool.failed.title', { count: step.toolErrors })}>
        {t('tool.failed', { count: step.toolErrors })}
      </span>,
    )
  }
  if (step.tools.length === 0) {
    const label = step.running ? t('did.working') : step.aborted ? t('did.aborted') : t('did.answer')
    nodes.push(<span key="text">{label}</span>)
    return (
      <td className={css.stepDid}>
        <span className={css.didClip}>{nodes}</span>
      </td>
    )
  }
  const groups = callGroups(step.calls)
  const shown = groups.slice(0, 3)
  let shownCalls = 0
  shown.forEach((group, index) => {
    shownCalls += group.calls.length
    if (index > 0) nodes.push(<span key={`sep:${group.key}`} className={css.didSep}>·</span>)
    nodes.push(
      <span key={`name:${group.key}`} className={cx(css.toolName, toneClass(group.name))}>
        {group.name ?? '?'}
      </span>,
    )
    if (group.calls.length > 1) {
      nodes.push(<span key={`count:${group.key}`} className={css.countBadge}>{`×${group.calls.length}`}</span>)
    }
    if (group.hint !== null) {
      nodes.push(<span key={`hint:${group.key}`} className={css.didHint}>{` ${group.hint}`}</span>)
    }
    if (group.name !== null) {
      nodes.push(<Fragment key={`stat:${group.key}`}>{toolStat(group.name, group.calls, t)}</Fragment>)
    }
  })
  const totalCalls = step.tools.reduce((sum, item) => sum + item.count, 0)
  if (totalCalls > shownCalls) {
    nodes.push(
      <span key="more" className={css.didHint}>
        {` ${t('did.rest', { count: totalCalls - shownCalls })}`}
      </span>,
    )
  }
  return (
    <td className={css.stepDid}>
      <span className={css.didClip}>{nodes}</span>
    </td>
  )
}

/** Turn did column: tool pills, composition bar, and total tool output. */
function turnDidCell(turn: PerfTurnMetrics, t: PerfTranslate): ReactElement {
  if (turn.tools.length === 0) {
    const label = turn.running ? t('did.working') : turn.aborted ? t('did.aborted') : t('did.answer')
    return (
      <td className={css.turnDid}>
        <span className={css.didClip}>{label}</span>
      </td>
    )
  }
  const totalCalls = turn.tools.reduce((sum, item) => sum + item.count, 0)
  const shown = turn.tools.slice(0, 3)
  const title = t('did.title', {
    calls: totalCalls,
    tools: turn.tools.map(item => `${item.name} ×${item.count}`).join(' · '),
  })
  return (
    <td className={css.turnDid} title={title}>
      <div className={css.pills}>
        {turn.toolErrors > 0 ? (
          <span className={css.failPill} title={t('tool.failed.title', { count: turn.toolErrors })}>
            {t('tool.failed', { count: turn.toolErrors })}
          </span>
        ) : null}
        {shown.map(item => <ToolPill key={item.name} item={item} t={t} />)}
        {turn.tools.length > shown.length ? (
          <span className={cx(css.pill, css.pillMuted)}>
            {t('did.more', { count: turn.tools.length - shown.length })}
          </span>
        ) : null}
        {turn.toolOutput > 0 ? (
          <span className={cx(css.pill, css.pillMuted)} title={t('did.total', { chars: formatTokens(turn.toolOutput) })}>
            {t('did.output', { chars: formatChars(turn.toolOutput) })}
          </span>
        ) : null}
      </div>
      <MixBar tools={turn.tools} />
    </td>
  )
}

/** One step's detail row: every listed call as an accordion block. */
function stepDetailRow(
  step: PerfStepMetrics,
  t: PerfTranslate,
  state: StepViewState,
  onControl: (patch: Partial<StepViewState>) => void,
): ReactElement {
  const calls = step.calls
  const total = calls.reduce((sum, call) => sum + (isNumber(call.chars) ? call.chars : 0), 0)
  const wrap = state.wrap ?? false
  const raw = state.raw ?? {}
  const allCalls = step.tools.length > 0
    ? step.tools.reduce((sum, item) => sum + item.count, 0)
    : calls.length
  const hidden = Math.max(0, allCalls - calls.length)
  return (
    <tr key={`detail:${step.turn}:${step.step}`}>
      <td colSpan={TOTAL_COLUMNS} className={css.detailCell}>
        <div className={css.detailHead}>
          <span className={css.detailTitle}>{t('detail.calls', { count: allCalls })}</span>
          {total > 0
            ? <span className={css.blockMeta}>{` · ${t('detail.chars', { chars: formatTokens(total) })}`}</span>
            : null}
          <span className={css.detailActions}>
            <button
              type="button"
              className={wrap ? css.chipOn : css.chip}
              title={t('detail.wrap.title')}
              aria-pressed={wrap}
              onClick={() => { onControl({ wrap: !wrap }) }}
            >
              {t('detail.wrap')}
            </button>
          </span>
        </div>
        {calls.map(call => (
          <CallBlock
            key={call.callId}
            call={call}
            t={t}
            wrap={wrap}
            raw={raw[call.callId] === true}
            onToggleRaw={() => { onControl({ raw: { ...raw, [call.callId]: raw[call.callId] !== true } }) }}
          />
        ))}
        {hidden > 0
          ? <div className={css.blockEmpty}>{t('detail.hidden', { count: hidden, limit: CALL_LIMIT })}</div>
          : null}
      </td>
    </tr>
  )
}

/** Step-list controls of a long turn: tool filters and tail/all switching. */
function moreRows(
  turn: PerfTurnMetrics,
  t: PerfTranslate,
  state: StepViewState,
  onControl: (patch: Partial<StepViewState>) => void,
): ReactNode {
  const total = turn.steps.length
  const filter = state.filter ?? null
  if (total <= STEP_LIMIT && filter === null) return null
  const { pool, shown } = stepsOf(turn, state)
  const parts: ReactNode[] = [
    <span key="total" className={css.moreText}>{t('steps.total', { total })}</span>,
  ]
  turn.tools.forEach((item) => {
    parts.push(
      <button
        key={`tool:${item.name}`}
        type="button"
        className={filter === item.name ? css.chipOn : css.chip}
        title={t('steps.filter', { tool: item.name })}
        aria-pressed={filter === item.name}
        onClick={() => { onControl({ filter: filter === item.name ? null : item.name }) }}
      >
        <span className={cx(css.dot, toneClass(item.name))} />
        {`${item.name} ×${item.count}`}
      </button>,
    )
  })
  if (filter !== null) {
    parts.push(
      <span key="matched" className={css.moreText}>
        {t('steps.matched', { count: pool.length, tool: filter })}
      </span>,
    )
    parts.push(
      <button key="clear" type="button" className={css.button} onClick={() => { onControl({ filter: null }) }}>
        {t('steps.clear')}
      </button>,
    )
  }
  if (state.mode === 'all' && pool.length > STEP_LIMIT) {
    parts.push(
      <button key="tail" type="button" className={css.button} onClick={() => { onControl({ mode: 'tail' }) }}>
        {t('steps.tail', { limit: STEP_LIMIT })}
      </button>,
    )
  } else if (shown.length < pool.length) {
    parts.push(
      <button key="all" type="button" className={css.button} onClick={() => { onControl({ mode: 'all' }) }}>
        {t('steps.all', { total: pool.length })}
      </button>,
    )
  }
  return (
    <tr key={`more:${turn.turn}`}>
      <td colSpan={TOTAL_COLUMNS} className={css.moreCell}>{parts}</td>
    </tr>
  )
}

/** Rendered rows of one turn: header, step-list controls, and step rows. */
function stepRows(options: StepRowsOptions): ReactNode[] {
  const { turn, t, now, state, onToggleDetail, onControl } = options
  const deltas = contextDeltas(turn)
  const gaps = stepGaps(turn)
  const open = state.open ?? {}
  // Steps compare only with steps of the same turn.
  const stepScale = turn.steps.reduce((max, step) => {
    const span = totalSpan(step, now)
    return span !== null && span > max ? span : max
  }, 0)
  const { shown } = stepsOf(turn, state)
  const rows: ReactNode[] = []
  for (const step of shown) {
    const cells = metricsCells(step, t)
    const delta = deltas.get(step.step)
    const expanded = open[step.step] === true
    const hasDetail = step.calls.length > 0
    let contextTitle = ''
    if (delta !== undefined) {
      const lines = [
        t('context.delta', {
          from: formatTokensShort(delta.from),
          to: formatTokensShort(delta.to),
          delta: formatTokensDelta(delta.diff),
        }),
      ]
      if (delta.chars > 0) lines.push(t('context.delta.chars', { chars: formatTokens(delta.chars) }))
      if (delta.tokens !== null && delta.tokens > 0) {
        lines.push(t('context.delta.output', { tokens: formatTokens(delta.tokens) }))
      }
      contextTitle = lines.join('\n')
    }
    const rowClass: (string | undefined)[] = []
    if (hasDetail) rowClass.push(css.stepRowClickable)
    if (step.toolErrors > 0) rowClass.push(css.stepRowError)
    rows.push(
      <tr
        key={`step:${turn.turn}:${step.step}`}
        className={cx(...rowClass)}
        onClick={hasDetail ? () => { onToggleDetail(step.step) } : undefined}
        title={hasDetail ? t('detail.title') : undefined}
      >
        <td className={css.stepCell}>
          {t('step.label', { step: step.step })}
          {scopeMarkers(step, t)}
          {isNumber(step.startTime)
            ? null
            : (
              <span className={css.partialHint} title={t('step.partial.title')}>
                {` · ${t('step.partial')}`}
              </span>
            )}
          {hasDetail ? (
            <span className={css.detailHint}>
              {` · ${expanded ? t('detail.hide') : t('detail.show')}`}
            </span>
          ) : null}
        </td>
        <td className={css.promptCell} />
        {stepDidCell(step, t)}
        <ContextCell
          value={step.context}
          delta={delta === undefined ? null : delta.diff}
          title={contextTitle}
          className={css.stepMetric}
        />
        <MetricCells cells={cells} className={css.stepMetric} />
        <TimeCell
          value={step}
          scale={stepScale}
          gap={gaps.get(step.step)}
          className={css.stepMetric}
          trackClass={css.barStep}
          now={now}
          t={t}
        />
      </tr>,
    )
    if (expanded) rows.push(stepDetailRow(step, t, state, onControl))
  }
  return rows
}

/** All rows of one turn: the clickable header, then the expanded body. */
function turnRows(options: TurnRowsOptions): ReactNode[] {
  const { turn, t, now, open, state, turnScale, onToggle, onToggleDetail, onControl } = options
  const cells = metricsCells(turn, t)
  const toggleLabel = open ? t('turn.collapse') : t('turn.expand')
  const rows: ReactNode[] = [
    <tr
      key={`turn:${turn.turn}`}
      className={css.turnRow}
      onClick={onToggle}
      title={t('turn.toggle.title')}
    >
      <td className={css.turnCell}>
        {t('turn.label', { turn: turn.turn })}
        <span className={css.stepCount}>{` · ${t('turn.stepCount', { count: turn.steps.length })}`}</span>
        <span className={css.toggle}>{` · ${toggleLabel}`}</span>
        {isNumber(turn.startTime) ? (
          <span
            className={css.turnClock}
            title={t('turn.started', { time: formatDateTime(turn.startTime) })}
          >
            {` · ${formatClock(turn.startTime)}`}
          </span>
        ) : null}
        {scopeMarkers(turn, t)}
      </td>
      <PromptCell turn={turn} t={t} className={css.promptCellTurn} />
      {turnDidCell(turn, t)}
      <ContextCell value={turn.context} delta={null} title="" className={css.turnMetric} />
      <MetricCells cells={cells} className={css.turnMetric} />
      <TimeCell
        value={turn}
        scale={turnScale}
        gap={undefined}
        className={css.turnMetric}
        trackClass={css.barTurn}
        now={now}
        t={t}
      />
    </tr>,
  ]
  if (!open) return rows
  const controls = moreRows(turn, t, state, onControl)
  if (controls !== null) rows.push(controls)
  rows.push(...stepRows({ turn, t, now, state, onToggleDetail, onControl }))
  return rows
}

/** Footer button that switches between enabled and disabled styling. */
function TableButton({ caption, enabled, onClick }: TableButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={enabled ? css.button : css.buttonOff}
      disabled={!enabled}
      onClick={enabled ? onClick : undefined}
    >
      {caption}
    </button>
  )
}

/**
 * Render the performance table of the current conversation view target.
 * @param props - composed conversation View props: the perf snapshot hook and the locale seat.
 * @returns the table, its empty state, and the pagination footer.
 */
export function PerfView(props: PerfViewProps): ReactElement {
  const { usePerf, t } = props
  const snapshot = usePerf(value => value)
  const [view, setView] = useState<ViewState>(createViewState)
  const [now, setNow] = useState(() => Date.now())
  const turns = snapshot.turns
  const pages = Math.max(1, Math.ceil(turns.length / PAGE_SIZE))
  let end = turns.length
  if (view.anchor !== null) {
    const at = turns.findIndex(turn => turn.turn === view.anchor)
    if (at >= 0) end = at + 1
  }
  const start = Math.max(0, end - PAGE_SIZE)
  const visible = turns.slice(start, end)
  const page = Math.max(1, Math.min(pages, Math.ceil(end / PAGE_SIZE)))
  const newest = visible.at(-1)
  const latestTurn = newest === undefined ? null : newest.turn
  const isTurnOpen = (turnNumber: number): boolean =>
    view.openTurns[turnNumber] ?? defaultTurnOpen(view.mode, turnNumber, latestTurn)
  const allOpen = visible.length > 0 && visible.every(turn => isTurnOpen(turn.turn))
  const hasRunning = visible.some(turn =>
    isTimeRunning(turn) || turn.steps.some(step => isTimeRunning(step)))
  useEffect(() => {
    if (!hasRunning) return undefined
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [hasRunning])
  // Turns compare only with turns on this page.
  const turnScale = visible.reduce((max, turn) => {
    const span = totalSpan(turn, now)
    return span !== null && span > max ? span : max
  }, 0)
  const toggleTurn = (turnNumber: number): void => {
    setView((current) => {
      const open = current.openTurns[turnNumber]
        ?? defaultTurnOpen(current.mode, turnNumber, latestTurn)
      return { ...current, openTurns: { ...current.openTurns, [turnNumber]: !open } }
    })
  }
  const toggleAllTurns = (): void => {
    setView(current => ({ ...current, openTurns: {}, mode: allOpen ? 'none' : 'all' }))
  }
  const toggleStepDetail = (turnNumber: number, stepNumber: number): void => {
    setView((current) => {
      const state = current.stepViews[turnNumber] ?? EMPTY_STEP_VIEW
      const open = { ...(state.open ?? {}) }
      open[stepNumber] = open[stepNumber] !== true
      return {
        ...current,
        stepViews: { ...current.stepViews, [turnNumber]: { ...state, open } },
      }
    })
  }
  const patchStepView = (turnNumber: number, patch: Partial<StepViewState>): void => {
    setView((current) => {
      const state = current.stepViews[turnNumber] ?? EMPTY_STEP_VIEW
      return {
        ...current,
        stepViews: { ...current.stepViews, [turnNumber]: { ...state, ...patch } },
      }
    })
  }
  const goOlder = (): void => {
    const target = turns[start - 1]
    /* v8 ignore next -- the older button is disabled while start is 0, so this guard only satisfies the index type. */
    if (target === undefined) return
    setView(current => ({ ...current, anchor: target.turn }))
  }
  const goNewer = (): void => {
    const next = Math.min(turns.length, end + PAGE_SIZE)
    const target = next >= turns.length ? undefined : turns[next - 1]
    setView(current => ({ ...current, anchor: target === undefined ? null : target.turn }))
  }
  return (
    <div className={css.root}>
      {turns.length === 0 ? (
        <div className={css.empty}>{t('empty')}</div>
      ) : (
        <table className={css.table} aria-label={t('view.perf')}>
          <thead>
            <tr>
              <th className={css.thLeft} title={t('column.scope.title')}>{t('column.scope')}</th>
              <th className={css.thLeft} title={t('column.prompt.title')}>{t('column.prompt')}</th>
              <th className={css.thLeft} title={t('column.did.title')}>{t('column.did')}</th>
              {COLUMNS.map(name => (
                <th key={name} className={css.th} title={t(`column.${name}.title`)}>
                  {t(`column.${name}`)}
                </th>
              ))}
              <th className={css.th} title={t('column.time.title')}>{t('column.time')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.flatMap(turn => turnRows({
              turn,
              t,
              now,
              open: isTurnOpen(turn.turn),
              state: view.stepViews[turn.turn] ?? EMPTY_STEP_VIEW,
              turnScale,
              onToggle: () => { toggleTurn(turn.turn) },
              onToggleDetail: (stepNumber) => { toggleStepDetail(turn.turn, stepNumber) },
              onControl: (patch) => { patchStepView(turn.turn, patch) },
            }))}
          </tbody>
        </table>
      )}
      <div className={css.toolbar}>
        <span className={css.pageInfo}>
          {t('page.info', { turns: turns.length, steps: snapshot.stepCount, page, pages })}
        </span>
        <TableButton
          caption={allOpen ? t('collapse.all') : t('expand.all')}
          enabled={turns.length > 0}
          onClick={toggleAllTurns}
        />
        {pages > 1 ? (
          <TableButton caption={t('page.older')} enabled={start > 0} onClick={goOlder} />
        ) : null}
        {pages > 1 ? (
          <TableButton caption={t('page.newer')} enabled={end < turns.length} onClick={goNewer} />
        ) : null}
      </div>
    </div>
  )
}

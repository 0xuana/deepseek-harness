/**
 * Browser controller for the Session Header's "Copy as Markdown" action. One
 * plugin instance owns one pending copy: the clipboard is a browser-wide
 * destination, so a second request joins the pending operation instead of
 * racing it. The Header disables its copy row from this state; the toast lives
 * in a separate `shell.overlay` entry so it survives the menu closing or the
 * Session changing.
 * @module
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { SESSION_MARKDOWN_EXPORT_ROUTE } from '../routes.ts'

/** Whether the latest copy attempt succeeded or failed. */
export type SessionMarkdownCopyNoticeKind = 'success' | 'failed'

/** One settled copy notice; `seq` keys the toast so a repeat copy restarts it. */
export interface SessionMarkdownCopyNotice {
  readonly kind: SessionMarkdownCopyNoticeKind
  readonly seq: number
}

/** Copy state shared by every Header row and the root overlay toast. */
export interface SessionMarkdownCopyState {
  /** Whether this plugin instance has a copy operation still pending. */
  copying: boolean
  /** Latest settled copy notice, or null while none shows. */
  notice: SessionMarkdownCopyNotice | null
}

/** HTTP carrier for the Markdown route. */
type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>
/** Host clipboard write; false means the browser rejected it. */
type Write = (text: string) => Promise<boolean>

const INITIAL: SessionMarkdownCopyState = { copying: false, notice: null }

/** Owns the one pending Markdown copy for this plugin instance. */
export class SessionMarkdownCopyController {
  /** uSES-safe state source shared by every Header row and the overlay toast. */
  readonly store: SnapshotStore<SessionMarkdownCopyState> = createSnapshotStore(INITIAL)

  private pending: { readonly abort: AbortController; readonly done: Promise<void> } | undefined
  private disposed = false
  private noticeSeq = 0

  constructor(
    private readonly fetcher: Fetch = (input, init) => fetch(input, init),
    private readonly write: Write = writeClipboard,
  ) {}

  /**
   * Copy one Session's complete transcript. A request received while a copy is
   * pending joins that operation and keeps its originally captured Session.
   * @param sessionId - Session captured by the click.
   * @returns after the clipboard write settles, a failure notice is published, or a late post-disposal request is ignored.
   */
  copy(sessionId: SessionId): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.pending !== undefined) return this.pending.done
    const abort = new AbortController()
    const done = this.run(sessionId, abort.signal).finally(() => {
      this.pending = undefined
    })
    this.pending = { abort, done }
    return done
  }

  /** Clear the shown toast without affecting a pending copy. */
  dismiss(): void {
    if (this.store.getSnapshot().notice === null) return
    this.store.update((state) => { state.notice = null })
  }

  /**
   * Abort a pending fetch, suppress a late clipboard write or notice, and
   * reach quiescence.
   * @returns after the pending operation settles.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    const pending = this.pending
    pending?.abort.abort()
    await pending?.done
    this.store.set(INITIAL)
  }

  private async run(sessionId: SessionId, signal: AbortSignal): Promise<void> {
    this.store.update((state) => { state.copying = true })
    try {
      const query = new URLSearchParams({ sessionId })
      const route = `${SESSION_MARKDOWN_EXPORT_ROUTE}?${query.toString()}`
      const response = await this.fetcher(route, { signal })
      if (!response.ok) throw new Error(`Session Markdown request failed: HTTP ${String(response.status)}`)
      const markdown = await response.text()
      // The plugin may unload while the fetch or a clipboard call is pending;
      // never write or report after disposal.
      if (this.isCancelled()) return
      if (!await this.write(markdown)) throw new Error('the browser rejected the clipboard write')
      if (this.isCancelled()) return
      this.publishNotice('success')
    } catch {
      if (this.isCancelled()) return
      this.publishNotice('failed')
    } finally {
      this.store.update((state) => { state.copying = false })
    }
  }

  private isCancelled(): boolean {
    return this.disposed
  }

  private publishNotice(kind: SessionMarkdownCopyNoticeKind): void {
    this.store.update((state) => {
      state.notice = { kind, seq: ++this.noticeSeq }
    })
  }
}

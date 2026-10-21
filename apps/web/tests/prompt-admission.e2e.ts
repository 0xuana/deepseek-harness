// Keyless browser coverage for Agent admission through the shipped Web
// composition and the real wire: a Host `agent-controller/admission` listener holds a
// sent message, so the composer stays read-only behind the sending control
// until the listener admits it, and a refusal leaves the message in the
// composer, announced by a toast unless the refusing plugin presents it.
import { fileURLToPath } from 'node:url'
import type { Browser } from 'playwright'
import { chromium } from 'playwright'
import { afterEach, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
const MODE = webSnapshotMode()

const HELD = 'Message held by admission'
const FOLLOW_UP = 'Typed once the message was accepted'
const REFUSED = 'Message refused by admission'
const TOAST_REFUSAL = 'The workspace is not ready yet'
const PRESENTED_REFUSAL = 'The refusing plugin explains this itself'

describe('web e2e: prompt admission', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined

  afterEach(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    browser = undefined
    const closing = scaffold
    scaffold = undefined
    await closing?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'prompt-admission teardown failed')
  })

  it.skipIf(MODE === 'record')('holds a message in the composer until admitted and keeps a refused one there', async () => {
    const sessionEvents: SessionEvent[] = []
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, compareReplaySession: false })
    const host = scaffold
    host.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    const userMessages = (): number => sessionEvents
      .filter(event => event.type === 'user/message' && event.data.source.kind === 'user').length
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(host.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, host.workspaceCwd)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-prompt-admission'))
    const input = page.locator('[data-composer-input]').first()

    const gate = Promise.withResolvers<undefined>()
    const held = Promise.withResolvers<undefined>()
    const disposeHold = host.ctx.on('agent-controller/admission', async (_admission, next) => {
      held.resolve(undefined)
      await gate.promise
      return await next()
    })
    await input.fill(HELD)
    await input.press('Enter')
    await held.promise
    const sending = page.getByRole('button', { name: 'Sending message', exact: true })
    await expect.poll(() => sending.getAttribute('aria-busy')).toBe('true')
    expect(await input.getAttribute('contenteditable')).toBe('false')
    expect(await input.textContent()).toBe(HELD)
    expect(await page.locator('[data-submission-echo]').count()).toBe(0)
    expect(userMessages()).toBe(0)

    const settled = host.whenTurnSettled()
    gate.resolve(undefined)
    await settled
    await expect.poll(() => input.textContent()).toBe('')
    expect(await input.getAttribute('contenteditable')).toBe('true')
    // The keyboard returns to the composer, so the next message can be typed at once.
    await page.keyboard.type(FOLLOW_UP)
    await expect.poll(() => input.textContent()).toBe(FOLLOW_UP)
    await page.locator('[data-chat-flow-kind="user"]', { hasText: HELD }).waitFor()
    expect(userMessages()).toBe(1)
    disposeHold()

    let presented = false
    host.ctx.on('agent-controller/admission', () => Promise.resolve({
      kind: 'reject' as const, reason: 'e2e/workspace-not-ready', message: presented ? PRESENTED_REFUSAL : TOAST_REFUSAL, presented,
    }))
    await input.fill(REFUSED)
    await input.press('Enter')
    await page.getByRole('alert').filter({ hasText: TOAST_REFUSAL }).waitFor()
    await expect.poll(() => input.getAttribute('contenteditable')).toBe('true')
    expect(await input.textContent()).toBe(REFUSED)

    presented = true
    const response = page.waitForResponse('**/api/session/prompt')
    await input.press('Enter')
    // The rejection reaches the wire with its reason and the plugin's own presentation.
    const envelope = await (await response).json() as { readonly result: unknown }
    expect(envelope.result).toMatchObject({
      ok: false,
      error: { code: 'session/prompt-rejected', details: { reason: 'e2e/workspace-not-ready', presented: true } },
    })
    await expect.poll(() => input.getAttribute('contenteditable')).toBe('true')
    expect(await input.textContent()).toBe(REFUSED)
    expect(await page.getByRole('alert').filter({ hasText: PRESENTED_REFUSAL }).count()).toBe(0)
    expect(userMessages()).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
  })
})

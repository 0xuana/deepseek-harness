/** The completed answer offers creation; choosing a location does not start it. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  fixtureUserPrompts, launchWebScaffold, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const directory = fileURLToPath(new URL('../../../snapshots/web/creation-recommendations', import.meta.url))
const fixture = join(directory, 'session.v4.jsonl')

describe('creation recommendation after an explicit wish', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: fixture, compareReplaySession: true,
      profile: { packages: [{ dir: fileURLToPath(new URL('../../../packages/experimental/creation-recommendations', import.meta.url)), enabled: true }] },
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
  })
  afterAll(async () => { await browser?.close(); await scaffold?.close() })

  it('shows one card below the answer, lets the user change location, and restores a dismissal', async () => {
    const tripwire = watchConsole(page)
    await page.setViewportSize({ width: 620, height: 900 })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill(fixtureUserPrompts(await readFile(fixture, 'utf8'))[0]!)
    await input.press('Enter')
    await settled
    const card = page.locator('[data-creation-recommendation]')
    await card.waitFor({ state: 'visible' })
    expect(await card.count()).toBe(1)
    expect(await page.locator('[data-turn-tail] [data-creation-recommendation]').count()).toBe(1)
    const answer = page.getByText('I can create a persistent counter with increment and reset controls. Choose its location below.', { exact: true })
    const answerBox = await answer.boundingBox()
    const cardBox = await card.boundingBox()
    expect(answerBox).not.toBeNull()
    expect(cardBox!.y).toBeGreaterThanOrEqual(answerBox!.y + answerBox!.height)
    expect(await card.getByRole('button', { name: 'Create', exact: true }).isEnabled()).toBe(true)
    await compareOrRefreshGolden(join(directory, 'offered.expected.md'), await captureStableAria(page, '[data-creation-recommendation]', scaffold.workspaceCwd), scaffold.mode)
    const expand = card.getByRole('button', { name: 'View full plan', exact: true })
    const plan = page.locator(`[id="${await expand.getAttribute('aria-controls')}"]`)
    const compactHeight = await plan.evaluate(element => element.clientHeight)
    expect(await plan.evaluate(element => element.clientHeight <= parseFloat(getComputedStyle(element).lineHeight) * 3 + 1)).toBe(true)
    await expand.click()
    expect(await plan.evaluate(element => element.clientHeight)).toBeGreaterThan(compactHeight)
    expect(await card.getByRole('button', { name: 'Create', exact: true }).isEnabled()).toBe(true)
    await compareOrRefreshGolden(join(directory, 'expanded.expected.md'), await captureStableAria(page, '[data-creation-recommendation]', scaffold.workspaceCwd), scaffold.mode)
    await card.getByRole('button', { name: 'Collapse plan', exact: true }).click()
    await card.getByRole('button', { name: 'Options', exact: true }).click()
    await card.getByRole('radio', { name: 'Session tab', exact: true }).check()
    expect(await card.getByRole('radio', { name: 'Session tab', exact: true }).isChecked()).toBe(true)
    await compareOrRefreshGolden(join(directory, 'options.expected.md'), await captureStableAria(page, '[data-creation-recommendation]', scaffold.workspaceCwd), scaffold.mode)
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await card.getByRole('button', { name: 'Not now', exact: true }).click()
    await card.getByRole('status').getByText('Dismissed', { exact: true }).waitFor()
    const warnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await card.getByRole('status').getByText('Dismissed', { exact: true }).waitFor()
    acknowledgeReloadConnectionLoss(tripwire, warnings)
    expect(await card.getByRole('button', { name: 'Create', exact: true }).count()).toBe(0)
    expect(await card.getByRole('button', { name: 'View full plan', exact: true }).isVisible()).toBe(true)
    expect((await scaffold.ctx.pluginManager.listBundles()).some(bundle => bundle.name.startsWith('@dsh-local/view-'))).toBe(false)
    await compareOrRefreshGolden(join(directory, 'dismissed.expected.md'), await captureStableAria(page, '[data-creation-recommendation]', scaffold.workspaceCwd), scaffold.mode)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    if (scaffold.mode === 'replay') await assertFixtureInventory(directory, [
      'session.v4.jsonl', 'offered.expected.md', 'expanded.expected.md', 'options.expected.md', 'dismissed.expected.md', 'system-prompt.expected.md', 'tool-schemas.expected.json',
    ])
  })
})

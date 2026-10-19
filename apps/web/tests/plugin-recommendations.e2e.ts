/** Replay model output through the shipped Web profile and decide its real card. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  fixtureUserPrompts, launchWebScaffold, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const directory = fileURLToPath(new URL('../../../snapshots/web/plugin-recommendations', import.meta.url))
const fixture = join(directory, 'session.v4.jsonl')

describe('official plugin recommendation in a conversation', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: fixture, compareReplaySession: true,
      profile: { packages: [{ dir: fileURLToPath(new URL('../../../packages/experimental/plugin-recommendations', import.meta.url)), enabled: true }] },
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
  })

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('requires a user choice, keeps the card in the transcript, and restores dismissal', async () => {
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill(fixtureUserPrompts(await readFile(fixture, 'utf8'))[0]!)
    await input.press('Enter')
    await settled
    const card = page.locator('[data-plugin-recommendation]')
    await card.waitFor({ state: 'visible' })
    expect(await card.count()).toBe(1)
    expect(await page.locator('[data-turn-tail] [data-plugin-recommendation]').count()).toBe(1)
    const answer = page.getByText('You can enable conversation search below.', { exact: true })
    const answerBox = await answer.boundingBox()
    const cardBox = await card.boundingBox()
    expect(answerBox).not.toBeNull()
    expect(cardBox!.y).toBeGreaterThanOrEqual(answerBox!.y + answerBox!.height)
    expect(await card.getByRole('button', { name: 'Enable', exact: true }).isEnabled()).toBe(true)
    expect((await scaffold.ctx.pluginManager.listBundles()).find(bundle => bundle.name === '@deepseek-ai/dsh-experimental-session-search')?.enabled).toBe(false)
    await compareOrRefreshGolden(join(directory, 'offered.expected.md'), await captureStableAria(page, '[data-plugin-recommendation]', scaffold.workspaceCwd), scaffold.mode)
    await page.screenshot({ path: '/tmp/dsh-plugin-recommendation-offered.png', fullPage: true })
    await page.setViewportSize({ width: 620, height: 900 })
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await card.getByRole('button', { name: 'Not now', exact: true }).click()
    await card.getByRole('status').getByText('Dismissed', { exact: true }).waitFor()
    const warnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await card.getByRole('status').getByText('Dismissed', { exact: true }).waitFor()
    acknowledgeReloadConnectionLoss(tripwire, warnings)
    expect(await card.count()).toBe(1)
    expect(await card.getByRole('button').count()).toBe(0)
    expect((await scaffold.ctx.pluginManager.listBundles()).find(bundle => bundle.name === '@deepseek-ai/dsh-experimental-session-search')?.enabled).toBe(false)
    await compareOrRefreshGolden(join(directory, 'dismissed.expected.md'), await captureStableAria(page, '[data-plugin-recommendation]', scaffold.workspaceCwd), scaffold.mode)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    if (scaffold.mode === 'replay') await assertFixtureInventory(directory, [
      'session.v4.jsonl', 'offered.expected.md', 'dismissed.expected.md', 'system-prompt.expected.md', 'tool-schemas.expected.json',
    ])
  })
})

/** Pointer, keyboard, and resize behavior in the assembled client. @author feiyu.xia */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { connectFreshWorkspace, saveFailureShot } from './support.ts'

it.each([false, true])('keeps actions and focus usable with touch=%s across layout widths', async (hasTouch) => {
  const scaffold = await launchWebScaffold()
  onTestFinished(() => scaffold.close())
  const fixture = createChatScrollFixture({ markerPrefix: 'HOVER', title: 'Hover input', turns: 1 })
  const id = await seedSession(scaffold, fixture.log, 'hover-input')
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }, hasTouch, locale: 'en-US', timezoneId: 'Asia/Shanghai',
  })
  const page = await context.newPage()
  const consoleWatch = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, `hover-input-${String(hasTouch)}`))
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(!hasTouch)

  await page.getByRole('button', { name: 'Search sessions' }).click()
  await page.getByRole('textbox', { name: 'Search session names', exact: true }).fill(fixture.markers.user(1))
  const result = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  await expect.poll(() => result.count()).toBe(1)
  await result.click()
  await page.getByText(fixture.markers.assistant(1), { exact: false }).last().waitFor()
  const row = page.locator(`[data-row-key="session:${id}"]`)
  await row.waitFor({ state: 'visible' })
  expect(await row.getAttribute('aria-selected')).toBe('true')
  const copy = page.locator('[data-clock="end"] > button').first()
  const background = () => copy.evaluate(element => getComputedStyle(element).backgroundColor)
  await page.mouse.move(0, 0)
  const resting = await background()
  if (hasTouch) {
    await copy.tap()
    expect(await background()).toBe(resting)
    expect(await row.getAttribute('aria-selected')).toBe('true')
    expect(await page.getByRole('tooltip').count()).toBe(0)
  } else {
    await copy.hover()
    await expect.poll(background).not.toBe(resting)
    await page.mouse.move(0, 0)
    await expect.poll(background).toBe(resting)
  }

  await page.keyboard.press('Tab')
  await copy.focus()
  expect(await copy.evaluate(element => element.matches(':focus-visible'))).toBe(true)
  await row.focus()
  expect(await row.evaluate(element => document.activeElement === element)).toBe(true)
  await page.keyboard.press('Enter')
  expect(await row.getAttribute('aria-selected')).toBe('true')

  const image = fileURLToPath(new URL('../../../snapshots/session/read-image/workspace/red.png', import.meta.url))
  await page.locator('input[type="file"]').setInputFiles(image)
  const remove = page.getByRole('button', { name: 'Remove image red.png', exact: true })
  await remove.waitFor({ state: 'visible' })
  if (hasTouch) {
    expect(await remove.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
    await remove.tap()
  } else {
    await remove.focus()
    await expect.poll(() => remove.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
    await page.keyboard.press('Enter')
  }
  await remove.waitFor({ state: 'detached' })

  const input = page.locator('[data-composer-input]')
  await input.fill('keep this draft')
  await input.press('Home')
  await input.press('Shift+End')
  const element = await input.elementHandle()
  const selection = () => input.evaluate(node => ({
    focused: document.activeElement === node,
    text: node.textContent,
    selected: window.getSelection()?.toString(),
  }))
  const before = await selection()
  expect(before.focused).toBe(true)
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await element!.evaluate(node => node.isConnected)).toBe(true)
    expect(await selection()).toEqual(before)
  }
  expect(consoleWatch.pageErrors).toEqual([])
})

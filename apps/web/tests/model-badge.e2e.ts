/** Catalog badges reach every selector placement through the Host catalog without changing catalog identity. */
import { fileURLToPath } from 'node:url'
import { LlmAdapter, type LlmModelBadge, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspaceZh, ZH_BROWSER_LOCALE } from './support.ts'

const NAME = 'DeepSeek-V4.1-Flash'
const FIXTURE = fileURLToPath(new URL('./fixtures/model-badge/session.v4.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/model-badge/models.expected.md', import.meta.url))
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e: catalog model badges', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('./fixtures/model-badge/account.overlay.yml', import.meta.url)),
      replayFixture: FIXTURE,
      replayProvidersOnly: true,
      replayProviders: [
        { id: 'deepseek-account', name: 'DeepSeek Account', models: [
          { id: 'deepseek-flash', name: NAME, badge: { text: '1017', tone: 'info' } },
        ] },
        { id: 'deepseek-official', name: 'DeepSeek', models: [
          { id: 'deepseek-flash', name: NAME, badge: { text: { en: 'New', zh: '新' }, tone: 'success' } },
          { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
        ] },
        { id: 'external', name: 'External', models: [{ id: 'deepseek-flash', name: NAME }] },
      ],
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  })

  afterAll(async () => {
    try { await browser?.close() }
    finally { await scaffold?.close() }
  })

  it('shows each catalog badge in all placements while preserving the chosen provider and model id', async () => {
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    await trigger.getByText('新', { exact: true }).waitFor()
    expect(await trigger.textContent()).toContain(`新 ${NAME}`)
    expect(await trigger.getAttribute('aria-label')).toBe(`选择模型，当前 ${NAME}`)
    expect(await trigger.getByText('新', { exact: true }).getAttribute('data-tone')).toBe('success')
    try {
      await trigger.click()
      const current = page.getByRole('menuitem', { name: /^模型/ })
      expect(await current.getByText('新', { exact: true }).count()).toBe(1)
      await current.click()
      const menu = page.getByRole('menu', { name: '模型', exact: true })
      await compareOrRefreshGolden(EXPECTED, await captureStableAria(page, '[role="menu"][aria-label="模型"]', scaffold.workspaceCwd), MODE)
      expect(await menu.getByRole('group', { name: 'External', exact: true }).locator('[data-tone]').count()).toBe(0)
      const account = menu.getByRole('group', { name: 'DeepSeek 账号', exact: true })
      expect(await account.getByText('1017', { exact: true }).getAttribute('data-tone')).toBe('info')
      await account.getByRole('menuitemradio', { name: `${NAME} 1017`, exact: true }).click()
      await expect.poll(() => scaffold.ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'deepseek-account', model: 'deepseek-flash' })
      await expect.poll(() => trigger.textContent()).toContain(`1017 ${NAME}`)
      const catalog = await scaffold.ctx.llm.listModels('deepseek-account')
      expect(catalog.map(model => ({ id: model.id, name: model.name }))).toEqual([{ id: 'deepseek-flash', name: NAME }])
    } finally {
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
    }
  })

  it('updates and clears badges in an already-open page and model menu', async () => {
    const provider = 'live-badge'
    class CatalogAdapter extends LlmAdapter {
      badge: LlmModelBadge | undefined = { text: 'New', tone: 'info' }
      override async listModels(route: string) {
        return [{ provider: route, id: 'live', name: 'Live model', ...(this.badge === undefined ? {} : { badge: this.badge }) }]
      }
      override async *stream(): AsyncIterable<StreamChunk> { throw new Error('catalog-only scenario') }
    }
    const adapter = new CatalogAdapter()
    const unregister = scaffold.ctx.llm.registerAdapter([provider], adapter)
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    try {
      await trigger.click()
      await page.getByRole('menuitem', { name: /^模型/ }).click()
      await page.getByRole('menuitemradio', { name: 'Live model New', exact: true }).click()
      await expect.poll(() => trigger.textContent()).toContain('New Live model')
      await trigger.click()
      await page.getByRole('menuitem', { name: /^模型/ }).click()
      adapter.badge = { text: 'Updated', tone: 'success' }
      scaffold.ctx.emit('llm/models-updated', provider)
      await expect.poll(() => trigger.textContent()).toContain('Updated Live model')
      const updated = page.getByRole('menuitemradio', { name: 'Live model Updated', exact: true })
      await updated.waitFor()
      expect(await updated.locator('[data-tone]').getAttribute('data-tone')).toBe('success')
      adapter.badge = undefined
      scaffold.ctx.emit('llm/models-updated', provider)
      await expect.poll(() => trigger.textContent()).toBe('Live model')
      const cleared = page.getByRole('menuitemradio', { name: 'Live model', exact: true })
      await cleared.waitFor()
      expect(await cleared.locator('[data-tone]').count()).toBe(0)
    } finally {
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await trigger.click()
      await page.getByRole('menuitem', { name: /^模型/ }).click()
      await page.getByRole('menuitemradio', { name: `${NAME} 1017`, exact: true }).click()
      unregister()
    }
  })

  it('keeps a badge inside a 390px model menu and uses both theme palettes', async () => {
    try {
      await page.setViewportSize({ width: 390, height: 844 })
      const trigger = page.getByRole('button', { name: /^选择模型/ })
      await trigger.click()
      await page.getByRole('menuitem', { name: /^模型/ }).click()
      const menu = page.getByRole('menu', { name: '模型', exact: true })
      const badge = menu.getByRole('group', { name: 'DeepSeek 账号', exact: true }).getByText('1017', { exact: true })
      const box = await badge.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(12)
      expect(box!.x + box!.width).toBeLessThanOrEqual(378)
      const colors = await badge.evaluate((node) => {
        const body = node.ownerDocument.body
        const previous = body.getAttribute('data-ds-dark-theme')
        try {
          return [false, true].map((dark) => {
            body.toggleAttribute('data-ds-dark-theme', dark)
            const style = getComputedStyle(node)
            return { color: style.color, background: style.backgroundColor }
          })
        } finally {
          if (previous === null) body.removeAttribute('data-ds-dark-theme')
          else body.setAttribute('data-ds-dark-theme', previous)
        }
      })
      expect(colors[0]).not.toEqual(colors[1])
      for (const color of colors) expect(color.color).not.toBe(color.background)
    } finally {
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.setViewportSize({ width: 1440, height: 900 })
    }
    expect(tripwire.pageErrors).toEqual([])
  })
})

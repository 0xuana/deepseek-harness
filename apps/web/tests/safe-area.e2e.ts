/** Layout consumes the Web shell's vertical safe insets without resizing the viewport. */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold } from './scaffold.ts'

it('keeps sidebar and conversation content inside top and bottom safe areas', async () => {
  const scaffold = await launchWebScaffold({
    profile: { packages: [] },
    extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
  })
  try {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      await page.goto(scaffold.authenticatedUrl)
      const center = page.locator('[class*="centerCol"]')
      await center.waitFor()
      // Desktop Chromium has no hardware cutout; supply the shell variables at their real owner.
      await page.locator('#root').evaluate((root) => {
        root.style.setProperty('--dsh-safe-area-top', '47px')
        root.style.setProperty('--dsh-safe-area-bottom', '34px')
      })
      await expect.poll(async () => (await center.boundingBox())?.y).toBe(47)
      expect((await center.boundingBox())?.height).toBe(763)
      expect((await page.locator('[class*="sidebarCol"]').boundingBox())?.y).toBe(47)
      const input = page.getByRole('textbox').first()
      await input.focus()
      const box = await input.boundingBox()
      expect(box!.y + box!.height).toBeLessThanOrEqual(810)
      await page.locator('#root').evaluate((root) => {
        root.style.removeProperty('--dsh-safe-area-top')
        root.style.removeProperty('--dsh-safe-area-bottom')
      })
      await expect.poll(async () => (await center.boundingBox())?.y).toBe(0)
      expect((await center.boundingBox())?.height).toBe(844)
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})

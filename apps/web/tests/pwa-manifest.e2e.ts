import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { chromium } from 'playwright'
import { pngSize } from './png-size.ts'
import { TILE_SOURCE, tileDocument } from '../scripts/render-app-icons.ts'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

/** One install icon the manifest declares. */
interface ManifestIcon {
  readonly src: string
  readonly sizes: string
  readonly type: string
  readonly purpose: string
}

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />')
  expect(index).toContain('<link rel="manifest" href="./manifest.webmanifest" />')
  expect(index).toContain('<link rel="apple-touch-icon" href="./apple-touch-icon.png" />')
  expect(index).toContain('<meta name="mobile-web-app-capable" content="yes" />')
  expect(index).toContain('<meta name="apple-mobile-web-app-title" content="DSH" />')
  // No `theme-color` here: `ThemePresenter` owns the single metadata node and
  // follows the resolved in-application theme, which a static media query
  // cannot. The manifest's `theme_color` covers the surrounding chrome before
  // the presenter runs, and `settings-chrome.e2e.ts` pins the live contract.

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  // No `id`: a browser resolves an explicit `id` against the start URL's origin,
  // so only an absent `id`, which defaults to the resolved `start_url`, gives
  // each mount its own identity. `public-mount.e2e.ts` reads the resolved form.
  expect(manifest).toEqual({
    name: 'DeepSeek Harness',
    short_name: 'DSH',
    start_url: './',
    scope: './',
    // `standalone` keeps the phone's status bar; `fullscreen` hides it and the
    // navigation bar, which strands a chat surface with no clock or battery.
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  })
})

it('ships every declared install icon as a raster of its declared size', async () => {
  // A launcher has no fallback: an icon the manifest names but the build does
  // not carry is an install that silently shows nothing.
  const manifest = JSON.parse(
    await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'),
  ) as { icons: ManifestIcon[] }
  expect(manifest.icons).not.toHaveLength(0)
  for (const icon of manifest.icons) {
    const [edge] = icon.sizes.split('x')
    expect(pngSize(await readFile(join(DIST_ROOT, icon.src))))
      .toEqual([Number(edge), Number(edge)])
  }
  expect(pngSize(await readFile(join(DIST_ROOT, 'apple-touch-icon.png')))).toEqual([180, 180])
})

it('ships fixed-color favicons selected by document media queries', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="icon" type="image/svg+xml" href="./favicon-dark.svg" media="(prefers-color-scheme: dark)" />')
  expect(index).toContain('<link rel="icon" type="image/svg+xml" href="./favicon.svg" media="(prefers-color-scheme: light)" />')
  const light = await readFile(join(DIST_ROOT, 'favicon.svg'), 'utf8')
  const dark = await readFile(join(DIST_ROOT, 'favicon-dark.svg'), 'utf8')
  expect(light).not.toContain('<style>')
  expect(light).toContain('fill="#000"')
  expect(dark).toContain('fill="#fff"')
  expect(dark.replace('fill="#fff"', 'fill="#000"')).toBe(light)
})

it('keeps the shipped maskable artwork inside its opaque platform safe zone', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const maskable = await readFile(join(DIST_ROOT, 'icon-maskable-512.png'))
    const tile = tileDocument(await readFile(TILE_SOURCE, 'utf8'))
    const [scaled, unscaled] = await page.evaluate(async (sources) => {
      return Promise.all(sources.map(async (source) => {
        const image = new Image()
        image.src = source
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 512
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0, 512, 512)
        const { data } = context.getImageData(0, 0, 512, 512)
        let radius = 0
        for (let y = 0; y < 512; y += 1) {
          for (let x = 0; x < 512; x += 1) {
            const at = (y * 512 + x) * 4
            if (data[at + 3] === 0 || data[at]! + data[at + 1]! + data[at + 2]! >= 384) continue
            radius = Math.max(radius, Math.hypot(x - 255.5, y - 255.5))
          }
        }
        return { radius, corners: [0, 511, 511 * 512, 512 * 512 - 1].map(index => data[index * 4 + 3]) }
      }))
    }, [`data:image/png;base64,${maskable.toString('base64')}`, `data:image/svg+xml;base64,${Buffer.from(tile).toString('base64')}`])
    expect(scaled!.radius).toBeLessThanOrEqual(0.4 * 512)
    expect(scaled!.corners).toEqual([255, 255, 255, 255])
    expect(unscaled!.radius).toBeGreaterThan(0.4 * 512)
  } finally {
    await browser.close()
  }
})

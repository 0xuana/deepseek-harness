/**
 * The install icons are committed binaries, so this suite renders them from the
 * tile source and asserts the two properties a launcher depends on: every
 * declared edge is really produced, and the maskable variant's artwork stays
 * inside the circle a platform mask is guaranteed to show. Without the second
 * the whale's tail is cropped on a round-masked home screen, which is the
 * defect the dedicated icon set exists to remove.
 */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  APP_ICON_VARIANTS, MASKABLE_ARTWORK_SCALE, MASKABLE_SAFE_RADIUS_RATIO, TILE_SOURCE,
  maskableDocument, renderAppIcons, tileDocument,
} from '../scripts/render-app-icons.ts'

/** Channel sum above which a pixel is tile background rather than whale ink. */
const LIGHT_PIXEL_SUM = 384

/** Center-to-corner distance of the darkest pixel, in pixels, from the icon centre. */
async function inkRadius(png: Buffer): Promise<number> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const centre = (info.width - 1) / 2
  let radius = 0
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const at = (y * info.width + x) * 4
      const alpha = data[at + 3] ?? 0
      const sum = (data[at] ?? 0) + (data[at + 1] ?? 0) + (data[at + 2] ?? 0)
      if (alpha === 0 || sum >= LIGHT_PIXEL_SUM) continue
      radius = Math.max(radius, Math.hypot(x - centre, y - centre))
    }
  }
  return radius
}

/** The four corner pixels, where a maskable icon must be opaque. */
async function cornerAlphas(png: Buffer): Promise<number[]> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const last = info.width - 1
  return [[0, 0], [last, 0], [0, last], [last, last]].map(([x, y]) => data[((y ?? 0) * info.width + (x ?? 0)) * 4 + 3] ?? 0)
}

describe('web install icons', () => {
  it('renders every declared variant at its declared edge', async () => {
    const icons = await renderAppIcons(await readFile(TILE_SOURCE, 'utf8'))
    expect(icons.map(icon => icon.variant)).toEqual(APP_ICON_VARIANTS)
    for (const { variant, png } of icons) {
      const metadata = await sharp(png).metadata()
      expect([variant.file, metadata.format, metadata.width, metadata.height])
        .toEqual([variant.file, 'png', variant.size, variant.size])
    }
  })

  it('keeps the maskable artwork inside the circle a platform mask shows', async () => {
    const source = await readFile(TILE_SOURCE, 'utf8')
    const edge = 512
    const maskable = (await renderAppIcons(source))
      .find(icon => icon.variant.kind === 'maskable')
    expect(maskable).toBeDefined()
    const safeRadius = MASKABLE_SAFE_RADIUS_RATIO * edge
    expect(await inkRadius(maskable!.png)).toBeLessThanOrEqual(safeRadius)

    // Negative control: the same artwork without the maskable scale overflows
    // the circle, so the assertion above is not vacuous.
    const unscaled = await sharp(Buffer.from(tileDocument(source)), { density: 72 })
      .resize(edge, edge).png().toBuffer()
    expect(await inkRadius(unscaled)).toBeGreaterThan(safeRadius)
  })

  it('fills a maskable icon to its edges so no mask meets transparency', async () => {
    const maskable = maskableDocument(await readFile(TILE_SOURCE, 'utf8'))
    const png = await sharp(Buffer.from(maskable), { density: 72 }).resize(512, 512).png().toBuffer()
    expect(await cornerAlphas(png)).toEqual([255, 255, 255, 255])
  })

  it('fails loudly on a source without the tile it transforms', () => {
    expect(() => tileDocument('<svg viewBox="0 0 10 10"></svg>')).toThrow(/tile source/)
    expect(MASKABLE_ARTWORK_SCALE).toBeLessThan(1)
  })
})

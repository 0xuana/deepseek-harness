// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { packPackageAssets, packageAssetResolver } from '../src/package-assets.ts'
import { MemoryVfs } from '../src/storage/memory.ts'
import { parseTar } from '../src/storage/tar.ts'

const ROOT = '/dsh'

afterEach(() => { vi.unstubAllGlobals() })

/** Seed one installed package into the image filesystem. */
function seedPackage(vfs: MemoryVfs, name: string, exports: Record<string, string> | undefined, files: Record<string, string>): void {
  const directory = `${ROOT}/node_modules/${name}`
  vfs.seed(`${directory}/package.json`, JSON.stringify({ name, ...exports === undefined ? {} : { exports } }))
  for (const [path, body] of Object.entries(files)) vfs.seed(`${directory}/${path}`, body)
}

it('archives every file of the packages that publish ./assets/* under its document-relative reference', () => {
  const vfs = new MemoryVfs()
  seedPackage(vfs, '@fixture/ui', { './client': './lib/client.js', './assets/*': './lib/assets/*' }, {
    'lib/client.js': '',
    'lib/assets/mark-0123456789ab.svg': '<svg/>',
    'lib/assets/icons/whale@2x-0123456789ab.png': 'png',
  })
  seedPackage(vfs, 'unexported', { '.': './lib/index.js' }, { 'lib/assets/own.svg': '<svg/>' })
  seedPackage(vfs, 'plain', undefined, { 'lib/index.js': '' })
  vfs.seed(`${ROOT}/node_modules/@fixture/stray.txt`, 'not a package')

  const entries = parseTar(packPackageAssets(vfs, ROOT))

  expect(Object.fromEntries(entries.map(entry => [entry.name, new TextDecoder().decode(entry.bytes)]))).toEqual({
    'plugins/@fixture/ui/assets/mark-0123456789ab.svg': '<svg/>',
    'plugins/@fixture/ui/assets/icons/whale%402x-0123456789ab.png': 'png',
  })
  expect(parseTar(packPackageAssets(new MemoryVfs(), ROOT))).toEqual([])
})

it('maps each archived reference to a typed Blob URL and leaves other references unchanged', async () => {
  const vfs = new MemoryVfs()
  seedPackage(vfs, '@fixture/ui', { './assets/*': './lib/assets/*' }, {
    'lib/assets/mark-0123456789ab.svg': '<svg/>',
    'lib/assets/data-0123456789ab.bin': 'raw',
  })
  const blobs: Blob[] = []
  const NativeURL = URL
  class StubURL extends NativeURL {
    static override createObjectURL(blob: Blob): string {
      blobs.push(blob)
      return `blob:fixture-${String(blobs.length)}`
    }
  }
  vi.stubGlobal('URL', StubURL)

  const resolve = packageAssetResolver(packPackageAssets(vfs, ROOT))

  const svg = resolve('plugins/@fixture/ui/assets/mark-0123456789ab.svg')
  const svgBlob = blobs[Number(svg.slice('blob:fixture-'.length)) - 1]
  expect(svgBlob?.type).toBe('image/svg+xml')
  expect(await svgBlob?.text()).toBe('<svg/>')
  const raw = resolve('plugins/@fixture/ui/assets/data-0123456789ab.bin')
  expect(blobs[Number(raw.slice('blob:fixture-'.length)) - 1]?.type).toBe('')
  expect(resolve('plugins/@fixture/ui/assets/missing.svg')).toBe('plugins/@fixture/ui/assets/missing.svg')
})

/**
 * Package assets published through `./assets/*` leave the base image for the
 * page tree: Client bundles reference them as document-relative
 * `plugins/<package>/assets/<path>` URLs, which the static deployment answers
 * beside the preview page while the Worker never sees them.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { expect, it, type TestContext } from 'vitest'
import { parseTar } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/storage/tar.ts'
import { packVfsImage, type PackOptions } from '../src/pack.ts'

const PUBLISHER = '@fixture/asset-publisher'
const UNEXPORTED = 'asset-unexported'

/** Write one workspace package and return its directory. */
function writePackage(test: TestContext, name: string, exports: Record<string, string>, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-image-assets-'))
  test.onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name, type: 'module', files: ['lib'], exports }))
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  return root
}

function fixture(test: TestContext): PackOptions {
  const publisher = writePackage(test, PUBLISHER, {
    '.': './lib/index.js',
    './client': './lib/client.js',
    './assets/*': './lib/assets/*',
  }, {
    'lib/index.js': 'export const value = 1',
    'lib/client.js': 'module.exports = "plugins/@fixture/asset-publisher/assets/icons/mark-0123456789ab.svg"',
    'lib/assets/icons/mark-0123456789ab.svg': '<svg/>',
    'lib/assets/whale@2x-0123456789ab.png': 'png',
  })
  const unexported = writePackage(test, UNEXPORTED, { '.': './lib/index.js' }, {
    'lib/index.js': 'export const value = 2',
    'lib/assets/kept.svg': '<svg/>',
  })
  return {
    profile: 'asset-check',
    roster: [PUBLISHER, UNEXPORTED],
    workspaces: new Map([[PUBLISHER, publisher], [UNEXPORTED, unexported]]),
    resolveFrom: publisher,
    entries: [],
  }
}

it('moves exported package assets to their page paths and keeps them out of the base image', (test) => {
  const result = packVfsImage(fixture(test))

  expect(Object.fromEntries(Object.entries(result.pageFiles).map(([path, bytes]) => [path, new TextDecoder().decode(bytes)])))
    .toEqual({
      'plugins/@fixture/asset-publisher/assets/icons/mark-0123456789ab.svg': '<svg/>',
      'plugins/@fixture/asset-publisher/assets/whale@2x-0123456789ab.png': 'png',
    })
  const imaged = parseTar(gunzipSync(result.image)).map(entry => entry.name)
  expect(imaged.filter(name => name.includes('/lib/assets/'))).toEqual([`node_modules/${UNEXPORTED}/lib/assets/kept.svg`])
  expect(imaged).toContain(`node_modules/${PUBLISHER}/lib/client.js`)
})

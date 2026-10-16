import type { UserConfig } from 'tsdown'
import { defineConfig } from 'tsdown'

/** Dependency-free Host code shared by the owner bundle and the Relay: no browser face. */
export default defineConfig(({ env }) => {
  if (env?.DSH_BUILD_FACE === 'client') return { entry: '' } satisfies UserConfig
  return {
    entry: [
      'lib/types/index.js',
      'lib/types/identity/index.js',
      'lib/types/tunnel-protocol.js',
    ],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  } satisfies UserConfig
})

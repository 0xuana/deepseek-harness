/** Qualification-only hook: hold a real collector at its first asynchronous file open. */
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'node:fs/promises' && context.parentURL?.endsWith('/operation-history.js')) {
      return { url: 'qualification:stalled-read', shortCircuit: true }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url !== 'qualification:stalled-read') return next(url, context)
    return { format: 'module', shortCircuit: true, source: `
      import { writeFile } from 'node:fs/promises'
      import { join } from 'node:path'
      import { workerData } from 'node:worker_threads'
      export async function open() {
        await writeFile(join(workerData.directory, 'read-entered'), 'ready')
        setInterval(() => {}, 1000)
        return new Promise(() => {})
      }
    ` }
  },
})

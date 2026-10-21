/** Real CUA prompt registration without native operations in the Script replay. */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CuaConfig } from '@deepseek-ai/dsh-cua'

export const name = 'cua-script-guidance'
export const inject = ['computerUse', 'tools', 'systemPrompt', 'subprocess', 'agents']
export const Config = CuaConfig

export async function apply(ctx, config) {
  const root = join(process.cwd(), 'cua-runtime')
  const { installCua } = await import(pathToFileURL(join(root, 'src/index.ts')).href)
  const { GUIDANCE } = await import(pathToFileURL(join(root, 'guidance.ts')).href)
  installCua(ctx, config, {
    helperPath: process.execPath,
    createChannel() { throw new Error('This prompt fixture does not perform native operations') },
    guidance: GUIDANCE,
    description: 'Inspect applications through the CUA object runtime.',
  })
}

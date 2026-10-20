/** On-demand page planning with current plugins for duplicate checks. */
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { BUNDLED_SKILL_RANK, type SkillCandidate } from '@deepseek-ai/dsh-skill'

/** Register the experiment's skill without adding a model tool or a system-prompt section.
 * @param ctx - Owning plugin context with skill and plugin registries.
 */
export function registerCreationSkill(ctx: Context): void {
  const candidate: SkillCandidate = {
    name: 'personalized-pages',
    description: 'Plan optional new pages or tools for explicit UI wishes (even one-off use), clear viewing/editing needs, or results worth revisiting. Load before suggest_action; use known context and the catalog, not source/API research. Existing-page changes stay on the original: explain-only requests need no source search or creation card. Requested files/code, ordinary answers, static tables alone, existing-feature questions, quoted wishes and declined recommendations do not qualify.',
    provider: 'dsh-personalized-pages', source: 'bundled', rank: BUNDLED_SKILL_RANK, locator: null,
    invocation: { modelInvocable: true, userInvocable: false },
  }
  ctx.skills.registerProvider(() => ({
    name: candidate.provider,
    list: () => Promise.resolve([candidate]),
    async get(_candidate, options) {
      const instructions = await readFile(new URL('../skills/personalized-pages.md', import.meta.url), {
        encoding: 'utf8', signal: options.signal,
      })
      const bundles = await ctx.pluginManager.listBundles()
      options.signal?.throwIfAborted()
      const { rank: _rank, locator: _locator, ...summary } = candidate
      return {
        ...summary,
        content: instructions + '\n## Existing capabilities to check against this page plan\n\n'
          + JSON.stringify(bundles.filter(bundle => bundle.official).map(bundle => ({
            name: bundle.name, title: bundle.meta?.title ?? bundle.name,
            description: bundle.meta?.description ?? bundle.description ?? '', enabled: bundle.enabled,
          }))),
      }
    },
  }))
}

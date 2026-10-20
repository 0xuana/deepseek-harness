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
    description: 'Plan an optional reusable page or small interactive tool from conversation context; no workspace inspection for a proposal. Use for explicit interface wishes, clear recurring viewing/editing difficulties, and task results the user intends to revisit, update or interact with—even without saying page. Check existing capabilities before proposing a new page. Existing-feature questions alone, ordinary coding, one-off answers, quoted wishes, discussion-only requests and declined recommendations do not qualify.',
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

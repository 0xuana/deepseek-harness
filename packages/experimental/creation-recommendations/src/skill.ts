/** On-demand recommendation policy with the current shipped-plugin catalog. */
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { BUNDLED_SKILL_RANK, type SkillCandidate } from '@deepseek-ai/dsh-skill'

/** Register the experiment's skill without adding a model tool or a system-prompt section.
 * @param ctx - Owning plugin context with skill and plugin registries.
 */
export function registerCreationSkill(ctx: Context): void {
  const candidate: SkillCandidate = {
    name: 'personalized-pages',
    description: 'Skip declined recommendations, quotes and ordinary tasks. Plan an unmet persistent DSH page need. For other app-capability wishes, use list_official_plugins first when available; skip this skill if an existing plugin matches. Without that tool, load this skill FIRST to discover existing capabilities, including readable/Chinese thinking, input methods and past conversations, before inspecting source or configuration. Includes the current catalog; never query it twice in one turn without a state change',
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
        content: instructions + '\n## Current official plugins\n\n'
          + JSON.stringify(bundles.filter(bundle => bundle.official).map(bundle => ({
            name: bundle.name, title: bundle.meta?.title ?? bundle.name,
            description: bundle.meta?.description ?? bundle.description ?? '', enabled: bundle.enabled,
          }))),
      }
    },
  }))
}

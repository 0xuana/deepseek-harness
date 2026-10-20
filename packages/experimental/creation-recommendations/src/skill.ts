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
    description: 'Find existing DSH features for product-use questions before inspecting source or config; also plan persistent pages. Covers viewers/editors (including Session Context), readable thinking, input methods, PR badges and history. Supplies live plugin names, descriptions and enabled state. Reuse a catalog already loaded this turn. Answer quoted, one-off, discussion-only or declined requests directly, without discovery, code investigation or cards.',
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

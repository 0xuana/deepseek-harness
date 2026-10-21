/** On-demand official-plugin catalog for explicit product-use needs. */
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { BUNDLED_SKILL_RANK, type SkillCandidate } from '@deepseek-ai/dsh-skill'
import type { BundleInfo } from '@deepseek-ai/dsh-plugin-manager/types'

/** Shipped optional plugins only; no arbitrary install target is accepted.
 * @param bundle - a profile bundle as the plugin manager reports it.
 * @returns whether a card may offer and enable it.
 */
export function eligible(bundle: BundleInfo): boolean {
  return bundle.official && bundle.optional && bundle.availability !== 'missing'
    && bundle.readOnlyReason === undefined && bundle.error === undefined
}

/** Register the experiment's skill without adding a model tool or a system-prompt section.
 * @param ctx - Owning plugin context with skill and plugin registries.
 */
export function registerOfficialPluginsSkill(ctx: Context): void {
  const candidate: SkillCandidate = {
    name: 'official-plugins',
    description: 'Check DSH’s built-in optional plugins when the user wants this app itself to work differently or gain an ability, including adding plugins or plugin sources: input methods, how thinking or titles are shown, searching past sessions, persistent terminals, worktrees, agent teams, desktop control, output badges or fewer approval prompts. Such a wish is not a request to develop DSH, even when its source is in the workspace: load this before reading any files or source. Not for ordinary tasks, quoted wishes or declined recommendations.',
    provider: 'dsh-official-plugins', source: 'bundled', rank: BUNDLED_SKILL_RANK, locator: null,
    invocation: { modelInvocable: true, userInvocable: false },
  }
  // Same as personalized pages until the shared action-card layer owns catalog skills.
  /* jscpd:ignore-start */
  ctx.skills.registerProvider(() => ({
    name: candidate.provider,
    list: () => Promise.resolve([candidate]),
    async get(_candidate, options) {
      const instructions = await readFile(new URL('../skills/official-plugins.md', import.meta.url), {
        encoding: 'utf8', signal: options.signal,
      })
      const bundles = await ctx.pluginManager.listBundles()
      options.signal?.throwIfAborted()
      const { rank: _rank, locator: _locator, ...summary } = candidate
      return {
        ...summary,
        content: instructions + '\n## Official plugins\n\n'
          + JSON.stringify(bundles.filter(eligible).map(bundle => ({
            name: bundle.name, title: bundle.meta?.title ?? bundle.name,
            description: bundle.meta?.description ?? bundle.description ?? '', enabled: bundle.enabled,
          }))),
      }
    },
  }))
  /* jscpd:ignore-end */
}

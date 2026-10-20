/** Session header label of the branch the Session works on, and of the worktree it started in. */

import type { ReactNode } from 'react'
import { IconBranchOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ForgePanelState } from '../types.ts'
import type { NS } from './locales.ts'
import type { PanelSnapshot } from './source.ts'
import css from './BranchChip.module.css'

/** Business face of the header label. */
export interface BranchChipInjected {
  /** Panel snapshot of the Session; the renderer binds it as `usePanel`. */
  readonly hooks: { readonly panel: HostObservable<PanelSnapshot> }
}

/** Full props of the header label. */
export type BranchChipProps = InjectFace<BranchChipInjected> & PropsLocale<typeof NS>

type Translate = BranchChipProps['t']

/** What the label shows: the branch, its explanation, and whether its worktree is gone. */
interface BranchLabel {
  readonly branch: string
  readonly detail: string
  readonly missing: boolean
}

/** The label, or undefined outside a checkout with a known branch. */
function labelOf(state: ForgePanelState | null, t: Translate): BranchLabel | undefined {
  const created = state?.worktree.created ?? null
  if (state !== null && state.worktree.missing !== null && created !== null) {
    return { branch: created.branch, detail: t('branch.missing', { path: created.path }), missing: true }
  }
  if (state?.checkout.state !== 'ready') return undefined
  const { root, branch } = state.checkout.checkout
  if (created !== null && created.path === root) {
    const detail = t('branch.worktree', { path: created.path, base: created.from ?? created.baseCommit.slice(0, 7) })
    return { branch: created.branch, detail, missing: false }
  }
  return branch === null ? undefined : { branch, detail: t('branch.current', { root }), missing: false }
}

/**
 * Render the branch label beside the Session title, in the warning tone while its worktree is gone.
 * @param props - panel snapshot hook and copy.
 * @returns the label, or nothing outside a checkout with a known branch.
 */
export function BranchChip({ usePanel, t }: BranchChipProps): ReactNode {
  const state = usePanel(snapshot => snapshot.state)
  const label = labelOf(state, t)
  if (label === undefined) return null
  return (
    <Tooltip label={label.detail} side="bottom">
      <span className={css.chip} data-forge-branch="" data-missing={label.missing ? '' : undefined}>
        <IconBranchOutlineRegular size={13} className={css.glyph} />
        <span className={css.text}>{label.branch}</span>
      </span>
    </Tooltip>
  )
}

/** Session header label of the branch the Session works on, and of the worktree it works in. */

import type { ReactNode } from 'react'
import { IconBranchOutlineRegular, IconWarningTriangleOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { checkoutLabel } from './checkout.ts'
import type { NS } from './locales.ts'
import type { PanelSnapshot } from './source.ts'
import css from './BranchChip.module.css'

/** Business face of the header label. */
export interface BranchChipInjected {
  /** Panel snapshot of the Session and the Host facts; the renderer binds them as `usePanel` and `useHost`. */
  readonly hooks: { readonly panel: HostObservable<PanelSnapshot>; readonly host: HostObservable<RemoteHostFacts> }
}

/** Full props of the header label. */
export type BranchChipProps = InjectFace<BranchChipInjected> & PropsLocale<typeof NS>

/**
 * Render the branch label beside the Session title, in the warning tone while its worktree is gone.
 * @param props - panel snapshot and Host facts hooks, and copy.
 * @returns the label, or nothing before an inspection names a branch or commit.
 */
export function BranchChip({ usePanel, useHost, t }: BranchChipProps): ReactNode {
  const state = usePanel(snapshot => snapshot.state)
  const home = useHost(facts => facts.home)
  const label = checkoutLabel(state, home, t)
  if (label?.name == null) return null
  return (
    <Tooltip label={label.tooltip} side="bottom">
      <span className={css.chip} data-forge-branch="" data-missing={label.missing ? '' : undefined}>
        {label.missing
          ? <IconWarningTriangleOutlineRegular size={13} className={css.glyph} />
          : <IconBranchOutlineRegular size={13} className={css.glyph} />}
        <span className={css.text}>{label.name}</span>
      </span>
    </Tooltip>
  )
}

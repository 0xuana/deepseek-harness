/** Chip title of the forge tab: the branch glyph and the localized tab name. */

import type { ReactNode } from 'react'
import { IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './ForgeTab.module.css'

/**
 * Render the tab chip title in the current UI language.
 * @param props - forge panel copy.
 * @returns the glyph followed by the tab name.
 */
export function ForgeTabTitle({ t }: PropsLocale<typeof NS>): ReactNode {
  return (
    <>
      <IconBranchOutlineRegular size={16} className={css.titleIcon} />
      <span className={css.titleText}>{t('tab.title')}</span>
    </>
  )
}

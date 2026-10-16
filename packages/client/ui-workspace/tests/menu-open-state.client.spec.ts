// @vitest-environment jsdom
import { createElement, useState } from 'react'
import { fireEvent, within } from '@testing-library/react'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { menuOpenStateFactory, type MenuOpenState } from '../src/client/contract/slots.ts'

const menuSlot = 'sidebar.workspaces.session.menu.item'

describe('Session row menu open state', () => {
  it('hands each entry its owner’s exact state pair and closes only that menu', async () => {
    const runtime = await SlotTestRuntime.create()
    onTestFinished(() => runtime.dispose())
    const ownerStates = new Map<string, MenuOpenState>()
    const entryStates = new Map<string, MenuOpenState>()

    function MenuOwner({ renderSlot }: PropsRenderSlots<typeof menuSlot>) {
      const first = useState(true)
      const second = useState(true)
      ownerStates.set('first', first)
      ownerStates.set('second', second)
      return createElement('div', null, ...([['first', first], ['second', second]] as const).map(([id, state]) =>
        createElement('section', { key: id, 'aria-label': id },
          createElement('button', { onClick: () => { state[1](true) } }, 'Open'),
          state[0] ? renderSlot(menuSlot, { sessionId: id as SessionId, displayTitle: id }, { hookContext: state }) : null,
        ),
      ))
    }

    await runtime.root.declare({
      [menuSlot]: {
        kind: 'list', scope: 'root',
        inject: { hooks: { menuOpenState: menuOpenStateFactory, shortcuts: createSnapshotStore<readonly ShortcutCatalogEntry[]>([]) } },
      },
    }, MenuOwner)
    await runtime.mount({
      inject: ['slots'],
      apply(ctx) {
        return ctx.slots.register({ name: menuSlot, id: 'test.close' },
          ({ displayTitle, useMenuOpenState }: PropsRuntime<typeof menuSlot>) => {
            const state = useMenuOpenState()
            entryStates.set(displayTitle, state)
            return createElement('button', { role: 'menuitem', onClick: () => { state[1](false) } }, 'Close')
          })
      },
    })
    const view = runtime.renderRoot()
    const first = within(view.getByRole('region', { name: 'first' }))
    const second = within(view.getByRole('region', { name: 'second' }))
    expect(entryStates.get('first')).toBe(ownerStates.get('first'))
    expect(entryStates.get('second')).toBe(ownerStates.get('second'))
    expect(entryStates.get('first')).not.toBe(entryStates.get('second'))

    fireEvent.click(first.getByRole('menuitem', { name: 'Close' }))
    expect(first.queryByRole('menuitem')).toBeNull()
    expect(second.getByRole('menuitem', { name: 'Close' })).toBeTruthy()
    fireEvent.click(first.getByRole('button', { name: 'Open' }))
    expect(first.getByRole('menuitem', { name: 'Close' })).toBeTruthy()
    expect(entryStates.get('first')).toBe(ownerStates.get('first'))
    fireEvent.click(second.getByRole('menuitem', { name: 'Close' }))
    expect(second.queryByRole('menuitem')).toBeNull()
    expect(first.getByRole('menuitem', { name: 'Close' })).toBeTruthy()
  })
})

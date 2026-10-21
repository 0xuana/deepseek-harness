// @vitest-environment jsdom
/** Provider-local ordering preserves row instances and unfinished model edits. */
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekModelsEditor } from '../src/client/DeepSeekModelsEditor.tsx'
import type { DeepSeekModelDraft } from '../src/client/DeepSeekModelsEditor.tsx'
import { ModelListEditor } from '../src/client/ModelListEditor.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function Editor(props: {
  family: 'deepseek' | 'pi-ai'
  initial: DeepSeekModelDraft[]
  changed: (models: DeepSeekModelDraft[]) => void
  disabled?: boolean
}) {
  const [models, setModels] = useState(props.initial)
  const shared = {
    models, disabled: props.disabled === true, overridden: true,
    t: (key: keyof typeof en) => en[key],
    onChange: (next: DeepSeekModelDraft[]): void => { props.changed(next); setModels(next) },
    onReset: (): void => { setModels(props.initial) },
  }
  return props.family === 'deepseek'
    ? <DeepSeekModelsEditor {...shared} defaultContextWindow={undefined} defaultMaxTokens={undefined} />
    : <ModelListEditor
      {...shared} probe={{ settingsNs: 'llm-pi-ai' }} onBusyChange={() => {}}
      operations={{ discoverModels: vi.fn(), storeCredential: vi.fn(), removeCredential: vi.fn(), writeSettings: vi.fn() }}
    />
}

function handle(position: number): HTMLButtonElement {
  return screen.getByRole('button', { name: `${en.reorderModel} ${String(position)}` })
}

function row(button: HTMLButtonElement): HTMLElement {
  const entry = button.closest('[data-model-row]')
  if (!(entry instanceof HTMLElement)) throw new Error('Model row is missing')
  return entry
}

function transfer() {
  return { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '', dropEffect: '' }
}

describe.each(['deepseek', 'pi-ai'] as const)('%s model ordering', (family) => {
  it('moves a complete model and its expanded capacity draft to the drop position', () => {
    const first = { id: 'first', name: 'First', contextWindow: 4096, input: ['image'], hidden: { preserved: true } }
    const second = { id: 'second', maxTokens: 1024 }
    const third = { id: 'third' }
    const changed = vi.fn()
    render(<Editor family={family} initial={[first, second, third]} changed={changed} />)
    const identity = screen.getByLabelText<HTMLInputElement>(`${en.modelId} 1`)
    const source = handle(1)
    const destination = row(handle(3))
    fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
    fireEvent.change(screen.getByLabelText(`${en.contextWindow} 1`), { target: { value: 'unfinished' } })
    fireEvent.change(screen.getByLabelText(`${en.maxTokens} 1`), { target: { value: '2000' } })
    changed.mockClear()

    const dataTransfer = transfer()
    fireEvent.dragStart(source, { dataTransfer })
    fireEvent.dragOver(destination, { dataTransfer })
    expect(changed).not.toHaveBeenCalled()
    fireEvent.drop(destination, { dataTransfer })
    fireEvent.dragEnd(source)

    expect(changed).toHaveBeenCalledExactlyOnceWith([
      second, third, { ...first, contextWindow: Number.NaN, maxTokens: 2000 },
    ])
    expect(screen.getByLabelText(`${en.modelId} 3`)).toBe(identity)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.contextWindow} 3`).value).toBe('unfinished')
    expect(screen.getByLabelText<HTMLInputElement>(`${en.maxTokens} 3`).value).toBe('2000')
    expect(screen.queryByLabelText(`${en.contextWindow} 1`)).toBeNull()
    expect(first.contextWindow).toBe(4096)
  })

  it('moves with arrow keys, retains focus, and ignores moves past either end', () => {
    const changed = vi.fn()
    render(<Editor family={family} initial={[{ id: 'first' }, { id: 'second' }]} changed={changed} />)
    const source = handle(1)
    source.focus()
    fireEvent.keyDown(source, { key: 'ArrowUp' })
    fireEvent.keyDown(source, { key: 'Enter' })
    expect(changed).not.toHaveBeenCalled()
    fireEvent.keyDown(source, { key: 'ArrowDown' })
    expect(handle(2)).toBe(source)
    expect(document.activeElement).toBe(source)
    fireEvent.keyDown(source, { key: 'ArrowDown' })
    expect(changed).toHaveBeenCalledExactlyOnceWith([{ id: 'second' }, { id: 'first' }])
    fireEvent.keyDown(source, { key: 'ArrowUp' })
    expect(changed).toHaveBeenLastCalledWith([{ id: 'first' }, { id: 'second' }])
  })

  it('keeps canceled, same-row, foreign, and disabled drops from changing the draft', () => {
    const changed = vi.fn()
    const initial = [{ id: 'first' }, { id: 'second' }]
    const view = render(<Editor family={family} initial={initial} changed={changed} />)
    const source = handle(1)
    const destination = row(handle(2))
    const dataTransfer = transfer()
    fireEvent.drop(destination, { dataTransfer })
    fireEvent.dragStart(source, { dataTransfer })
    fireEvent.drop(row(source), { dataTransfer })
    fireEvent.dragStart(source, { dataTransfer })
    fireEvent.dragOver(destination, { dataTransfer })
    fireEvent.dragEnd(source)
    fireEvent.drop(destination, { dataTransfer })
    expect(changed).not.toHaveBeenCalled()

    view.rerender(<Editor family={family} initial={initial} changed={changed} disabled />)
    expect(source.disabled).toBe(true)
    expect(source.draggable).toBe(false)
    fireEvent.keyDown(source, { key: 'ArrowDown' })
    fireEvent.drop(destination, { dataTransfer })
    expect(changed).not.toHaveBeenCalled()
  })

  it('keeps blank rows distinct through editing, moves, removal, and addition', () => {
    render(<Editor family={family} initial={[{ id: '' }, { id: '' }]} changed={vi.fn()} />)
    const first = screen.getByLabelText<HTMLInputElement>(`${en.modelId} 1`)
    const second = screen.getByLabelText<HTMLInputElement>(`${en.modelId} 2`)
    first.focus()
    fireEvent.change(first, { target: { value: 'renamed' } })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(handle(1), { key: 'ArrowDown' })
    expect(screen.getByLabelText(`${en.modelId} 2`)).toBe(first)
    expect(screen.getByLabelText(`${en.modelId} 1`)).toBe(second)
    fireEvent.click(screen.getByRole('button', { name: `${en.removeModel} 1` }))
    expect(screen.getByLabelText(`${en.modelId} 1`)).toBe(first)
    fireEvent.click(screen.getByRole('button', { name: en.addModel }))
    expect(screen.getByLabelText(`${en.modelId} 2`)).not.toBe(second)
    fireEvent.keyDown(handle(2), { key: 'ArrowUp' })
    expect(screen.getByLabelText(`${en.modelId} 2`)).toBe(first)
  })

  it('restores inherited order and clears row drafts when defaults are restored', () => {
    render(<Editor family={family} initial={[{ id: 'first' }, { id: 'second' }]} changed={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
    fireEvent.change(screen.getByLabelText(`${en.contextWindow} 1`), { target: { value: 'bad' } })
    fireEvent.keyDown(handle(1), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('button', { name: en.resetModels }))
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelId} 1`).value).toBe('first')
    expect(screen.queryByLabelText(`${en.contextWindow} 1`)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
    expect(screen.getByLabelText<HTMLInputElement>(`${en.contextWindow} 1`).value).toBe('')
  })
})

it('does not accept another provider editor\'s dragged model', () => {
  const firstChanged = vi.fn()
  const secondChanged = vi.fn()
  const first = render(<Editor family="pi-ai" initial={[{ id: 'a' }, { id: 'b' }]} changed={firstChanged} />)
  const second = render(<Editor family="deepseek" initial={[{ id: 'c' }, { id: 'd' }]} changed={secondChanged} />)
  const source = within(first.container).getByRole<HTMLButtonElement>('button', { name: `${en.reorderModel} 1` })
  const destination = within(second.container).getByRole<HTMLButtonElement>('button', { name: `${en.reorderModel} 2` })
  const dataTransfer = transfer()
  fireEvent.dragStart(source, { dataTransfer })
  fireEvent.dragOver(row(destination), { dataTransfer })
  fireEvent.drop(row(destination), { dataTransfer })
  fireEvent.dragEnd(source)
  expect(firstChanged).not.toHaveBeenCalled()
  expect(secondChanged).not.toHaveBeenCalled()
})

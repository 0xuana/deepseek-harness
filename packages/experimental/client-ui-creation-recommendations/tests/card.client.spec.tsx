// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { CreationDecision } from '@deepseek-ai/dsh-experimental-creation-recommendations/types'
import { RecommendationCard, RecommendationTail } from '../src/client/Card.tsx'
import { en, zh, type RecommendationKey } from '../src/client/locales.ts'

class PlanResizeObserver implements ResizeObserver {
  static made: PlanResizeObserver[] = []
  readonly observe = vi.fn()
  readonly unobserve = vi.fn()
  readonly disconnect = vi.fn()
  constructor(private readonly callback: ResizeObserverCallback) { PlanResizeObserver.made.push(this) }
  fire(): void { this.callback([], this) }
}
beforeEach(() => { PlanResizeObserver.made = []; vi.stubGlobal('ResizeObserver', PlanResizeObserver) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
type Props = ComponentProps<typeof RecommendationCard>
const callId = ToolCallId('creation-1')
function props(decision?: CreationDecision, chinese = true): Props {
  return { recommendation: { callId, title: 'Counter', brief: 'Keep my task count visible.', slot: 'sidebar-right' },
    useProjection: () => ({ decisions: decision === undefined ? {} : { [callId]: decision } }),
    act: vi.fn(async () => ({ status: 'accepted' })),
    t: (key: RecommendationKey) => (chinese ? zh : en)[key],
  } as Props
}

it('places only the first proposal at its turn tail and leaves unrelated turns empty', () => {
  type Tail = ComponentProps<typeof RecommendationTail>
  const value = props()
  const useRecommendations = vi.fn<(turn: string) => readonly Props['recommendation'][] | undefined>(() => undefined)
  const tail: Tail = { ...value, useRecommendations,
    turn: { turn: 3, start: undefined,
      end: { type: 'turn/end', seq: SessionSeq(1), time: 0, data: { turn: 3, reason: { kind: 'completed' } } },
      status: 'closed', steps: [],
      data: { get: vi.fn().mockReturnValue({ closing: {} }),
        source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) } } }
  const { rerender } = render(<RecommendationTail {...tail} />)
  expect(screen.queryByRole('region')).toBeNull()
  useRecommendations.mockReturnValue([value.recommendation, { ...value.recommendation, callId: ToolCallId('second') }])
  rerender(<RecommendationTail {...tail} />)
  expect(screen.getAllByRole('region')).toHaveLength(1)
  expect(useRecommendations).toHaveBeenCalledWith('3')
})

it('starts with a recommendation, lets the user change the location, and starts only on Create', async () => {
  const value = props()
  render(<RecommendationCard {...value} />)
  expect(screen.getByText('添加位置 · 右侧栏')).toBeTruthy()
  expect(screen.queryByRole('radio')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '选项' }))
  expect(screen.getAllByRole('radio')).toHaveLength(3)
  fireEvent.click(screen.getByRole('radio', { name: '会话顶部 Tab' }))
  expect(value.act).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '创建' }))
  await waitFor(() => { expect(value.act).toHaveBeenCalledExactlyOnceWith(callId, 'create', 'page') })
})

it('disables pending decisions and supports dismissal without starting a child', async () => {
  const value = props()
  const pending = Promise.withResolvers<Awaited<ReturnType<Props['act']>>>()
  value.act = vi.fn(() => pending.promise)
  render(<RecommendationCard {...value} />)
  fireEvent.click(screen.getByRole('button', { name: '暂不需要' }))
  expect(screen.getByRole('button', { name: '选项' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: '暂不需要' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: '开始创建…' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: zh.creationInfo }))
  expect(screen.getByRole('note').textContent).toContain(zh.creationCost)
  expect(value.act).toHaveBeenCalledWith(callId, 'dismiss', 'sidebar-right')
  await act(async () => { pending.resolve({ status: 'settled', decision: { callId, phase: 'dismissed', slot: 'sidebar-right' } }) })
})

it.each(['installing', 'dismissed', 'removed'] as const)('restores %s without repeat actions', (phase) => {
  render(<RecommendationCard {...props({ callId, phase, slot: 'sidebar-left' }, false)} />)
  expect(screen.getByRole('status').textContent).toBe(en[phase])
  expect(screen.getAllByRole('button')).toEqual([screen.getByRole('button', { name: en.creationInfo })])
  expect(screen.getByText('Location · Global page · Left sidebar entry')).toBeTruthy()
})

it.each([true, false])('explains cost and background creation without starting work (Chinese: %s)', (chinese) => {
  const value = props(undefined, chinese)
  const copy = chinese ? zh : en
  render(<RecommendationCard {...value} />)
  const button = screen.getByRole('button', { name: copy.creationInfo })
  expect(screen.queryByRole('note')).toBeNull()
  expect(button.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(button)
  const note = screen.getByRole('note')
  expect(note.id).toBe(button.getAttribute('aria-controls'))
  expect(button.getAttribute('aria-expanded')).toBe('true')
  expect(note.textContent).toContain(copy.creationMethod)
  expect(note.textContent).toContain(copy.creationCost)
  expect(note.textContent).toContain(copy.creationBackground)
  expect(screen.getByRole('button', { name: copy.create }).hasAttribute('disabled')).toBe(false)
  fireEvent.click(button)
  expect(screen.queryByRole('note')).toBeNull()
  expect(value.act).not.toHaveBeenCalled()
})

it('offers cancellation during generation, then waits for cleanup before retrying', async () => {
  const value = props({ callId, phase: 'creating', slot: 'page', bundleName: '@dsh-local/view-fixture' })
  const pending = Promise.withResolvers<Awaited<ReturnType<Props['act']>>>()
  value.act = vi.fn(() => pending.promise)
  const { rerender } = render(<RecommendationCard {...value} />)
  expect(screen.getByText(zh.sourceRetained)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '取消创建' }))
  expect(value.act).toHaveBeenCalledWith(callId, 'cancel', 'page')
  expect(screen.getByRole('button', { name: '正在取消…' }).hasAttribute('disabled')).toBe(true)
  expect(screen.queryByRole('button', { name: '重新创建' })).toBeNull()
  await act(async () => { pending.resolve({ status: 'accepted' }) })
  rerender(<RecommendationCard {...props({ callId, phase: 'cancelled', slot: 'page' })} />)
  expect(screen.getByRole('button', { name: '重新创建' })).toBeTruthy()
  rerender(<RecommendationCard {...props({ callId, phase: 'installing', slot: 'page' })} />)
  expect(screen.getByRole('status').textContent).toBe(zh.installing)
  expect(screen.queryByRole('button', { name: '取消创建' })).toBeNull()
})

it.each(['failed', 'interrupted', 'cancelled', 'unconfirmed'] as const)('offers an explicit retry after %s', async (phase) => {
  const value = props({ callId, phase, slot: 'page' })
  render(<RecommendationCard {...value} />)
  fireEvent.click(screen.getByRole('button', { name: '重新创建' }))
  await waitFor(() => { expect(value.act).toHaveBeenCalledWith(callId, 'create', 'page') })
})

it('retains installed and kept plugins with an Undo action and the actual application outcome', async () => {
  const value = props({ callId, phase: 'installed', slot: 'page', application: 'applied' })
  const { rerender } = render(<RecommendationCard {...value} />)
  expect(screen.getAllByRole('status')).toHaveLength(1)
  expect(screen.getByText(zh.scope)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '保留' }))
  await waitFor(() => { expect(value.act).toHaveBeenCalledWith(callId, 'keep', 'page') })
  const kept = props({ callId, phase: 'kept', slot: 'page', application: 'restart-required' })
  rerender(<RecommendationCard {...kept} />)
  expect(screen.queryByRole('button', { name: '保留' })).toBeNull()
  expect(screen.getByText(zh['restart-required'])).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '撤销' }))
  await waitFor(() => { expect(kept.act).toHaveBeenCalledWith(callId, 'undo', 'page') })
})

it('keeps uncertain actions recoverable on refusal and connection loss', async () => {
  const value = props()
  value.act = vi.fn().mockResolvedValueOnce({ status: 'refused', reason: 'unavailable' })
    .mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disconnected'))
  render(<RecommendationCard {...value} />)
  for (const text of [zh.unavailable, zh.transport, zh.transport]) {
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(text) })
  }
})

it('waits for its projection before exposing writable actions', () => {
  const value = props()
  value.useProjection = () => undefined
  render(<RecommendationCard {...value} />)
  expect(screen.getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true)
})

it('expands the full plan only when it overflows, without starting creation, and remeasures on resize', () => {
  let lines = 3
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(60)
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(() => lines * 20)
  const value = props()
  value.recommendation = { ...value.recommendation, brief: 'Keep my task count visible.\n\nPersist across conversations.\nVerify removal.' }
  const view = render(<RecommendationCard {...value} />)
  expect(screen.queryByRole('button', { name: '展开方案' })).toBeNull()
  const observer = PlanResizeObserver.made.at(-1)!
  lines = 5
  act(() => { observer.fire() })
  const expand = screen.getByRole('button', { name: '展开方案' })
  const paragraph = document.getElementById(expand.getAttribute('aria-controls')!)!
  expect(paragraph.textContent).toBe('Keep my task count visible. Persist across conversations. Verify removal.')
  expect(expand.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(expand)
  expect(screen.getByRole('button', { name: '收起方案' }).getAttribute('aria-expanded')).toBe('true')
  expect(paragraph.dataset.expanded).toBe('true')
  expect(paragraph.textContent).toBe(value.recommendation.brief)
  expect(observer.disconnect).toHaveBeenCalledOnce()
  expect(value.act).not.toHaveBeenCalled()
  lines = 2
  fireEvent.click(screen.getByRole('button', { name: '收起方案' }))
  expect(screen.queryByRole('button', { name: '展开方案' })).toBeNull()
  expect(paragraph.dataset.expanded).toBeUndefined()
  const remeasured = PlanResizeObserver.made.at(-1)!
  expect(remeasured).not.toBe(observer)
  view.unmount()
  expect(remeasured.disconnect).toHaveBeenCalledOnce()
})

// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { CreationCardState } from '@deepseek-ai/dsh-experimental-creation-recommendations/types'
import { RecommendationCard, RecommendationTail } from '../src/client/Card.tsx'
import { en, zh, type RecommendationKey } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
type Props = ComponentProps<typeof RecommendationCard>
const callId = ToolCallId('creation-1')
function props(decision?: CreationCardState, chinese = true): Props {
  return { recommendation: { callId, title: 'Counter', brief: 'Keep my task count visible.', slot: 'sidebar-right' },
    useProjection: () => ({ decisions: decision === undefined ? {} : { [callId]: decision } }),
    act: vi.fn(async () => ({ status: 'accepted' })),
    useInfoDismissed: selector => selector(true), dismissInfo: vi.fn(),
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
  const location = screen.getByRole('button', { name: '添加到: 右侧栏' })
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.click(location)
  expect(screen.getAllByRole('menuitem')).toHaveLength(4)
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.click(location)
  fireEvent.click(screen.getByRole('menuitem', { name: /会话 Tab/ }))
  expect(screen.queryByRole('menu')).toBeNull()
  expect(value.act).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '创建' }))
  await waitFor(() => { expect(value.act).toHaveBeenCalledExactlyOnceWith(callId, 'create', 'page', undefined) })
})

it('requires a written location, preserves its draft, and passes only the chosen location on Create', async () => {
  const value = props()
  const { rerender } = render(<RecommendationCard {...value} />)
  fireEvent.click(screen.getByRole('button', { name: '添加到: 右侧栏' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /自行撰写/ }))
  const input = screen.getByRole('textbox', { name: zh.customLabel })
  expect(screen.getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true)
  fireEvent.change(input, { target: { value: '  左侧入口打开全屏日历  ' } })
  expect(value.act).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '创建' }))
  await waitFor(() => { expect(value.act).toHaveBeenCalledWith(callId, 'create', 'sidebar-right', '左侧入口打开全屏日历') })
  rerender(<RecommendationCard {...value} />)
  fireEvent.click(screen.getByRole('button', { name: '添加到: 自行撰写' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /全局页面/ }))
  expect(screen.queryByRole('textbox')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '创建' }))
  await waitFor(() => { expect(value.act).toHaveBeenLastCalledWith(callId, 'create', 'sidebar-left', undefined) })
  fireEvent.click(screen.getByRole('button', { name: '添加到: 全局页面' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /自行撰写/ }))
  expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('  左侧入口打开全屏日历  ')
})

it('restores a written location after cancellation and preserves it on retry', async () => {
  const value = props({ callId, phase: 'cancelled', slot: 'page', customLocation: '右侧查看当前会话的 Context' })
  const { rerender } = render(<RecommendationCard {...value} />)
  expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('右侧查看当前会话的 Context')
  fireEvent.click(screen.getByRole('button', { name: '重新创建' }))
  await waitFor(() => { expect(value.act).toHaveBeenCalledWith(callId, 'create', 'page', '右侧查看当前会话的 Context') })
  rerender(<RecommendationCard {...props({ callId, phase: 'installed', slot: 'page', customLocation: '右侧查看当前会话的 Context' })} />)
  expect(screen.getByText('添加到 · 右侧查看当前会话的 Context')).toBeTruthy()
})

it('opens the cost notice until dismissed, remembers dismissal, and allows reopening', () => {
  const value = props()
  let dismissed = false
  value.useInfoDismissed = selector => selector(dismissed)
  value.dismissInfo = vi.fn(() => { dismissed = true })
  const first = render(<RecommendationCard {...value} />)
  expect(screen.getByRole('note').textContent).toContain(zh.creationCost)
  fireEvent.click(screen.getByRole('button', { name: zh.creationInfo }))
  expect(value.dismissInfo).toHaveBeenCalledOnce()
  expect(screen.queryByRole('note')).toBeNull()
  first.unmount()
  render(<RecommendationCard {...value} />)
  expect(screen.queryByRole('note')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.creationInfo }))
  expect(screen.getByRole('note').textContent).toContain(zh.creationBackground)
  expect(value.act).not.toHaveBeenCalled()
})

it('disables pending decisions and supports dismissal without starting a child', async () => {
  const value = props()
  const pending = Promise.withResolvers<Awaited<ReturnType<Props['act']>>>()
  value.act = vi.fn(() => pending.promise)
  render(<RecommendationCard {...value} />)
  fireEvent.click(screen.getByRole('button', { name: '暂不需要' }))
  expect(screen.getByRole('button', { name: '添加到: 右侧栏' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: '暂不需要' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: '开始创建…' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: zh.creationInfo }))
  expect(screen.getByRole('note').textContent).toContain(zh.creationCost)
  expect(value.act).toHaveBeenCalledWith(callId, 'dismiss', 'sidebar-right', undefined)
  await act(async () => { pending.resolve({ status: 'settled', decision: { callId, phase: 'dismissed', slot: 'sidebar-right' } }) })
})

it.each(['installing', 'dismissed', 'removed', 'expired'] as const)('restores %s without repeat actions', (phase) => {
  render(<RecommendationCard {...props({ callId, phase, slot: 'sidebar-left' }, false)} />)
  expect(screen.getByRole('status').textContent).toBe(en[phase])
  expect(screen.getAllByRole('button')).toEqual([screen.getByRole('button', { name: en.creationInfo })])
  expect(screen.getByText('Add to · Global page')).toBeTruthy()
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
  expect(screen.queryByText(zh.sourceRetained)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.creationInfo }))
  expect(screen.getByText(zh.sourceRetained)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '取消创建' }))
  expect(value.act).toHaveBeenCalledWith(callId, 'cancel', 'page', undefined)
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
  await waitFor(() => { expect(value.act).toHaveBeenCalledWith(callId, 'create', 'page', undefined) })
})

it('retains installed and kept plugins with an Undo action and the actual application outcome', async () => {
  const value = props({ callId, phase: 'installed', slot: 'page', application: 'applied' })
  const { rerender } = render(<RecommendationCard {...value} />)
  expect(screen.getAllByRole('status')).toHaveLength(1)
  expect(screen.getByText(zh.scope)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '保留' }))
  await waitFor(() => { expect(value.act).toHaveBeenCalledWith(callId, 'keep', 'page', undefined) })
  const kept = props({ callId, phase: 'kept', slot: 'page', application: 'restart-required' })
  rerender(<RecommendationCard {...kept} />)
  expect(screen.queryByRole('button', { name: '保留' })).toBeNull()
  expect(screen.getByText(zh['restart-required'])).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '撤销' }))
  await waitFor(() => { expect(kept.act).toHaveBeenCalledWith(callId, 'undo', 'page', undefined) })
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

it('only offers expansion for omitted content and preserves the full plan without layout measurement', () => {
  vi.stubGlobal('ResizeObserver', undefined)
  const value = props()
  const short = 'Keep my task count visible.\n\nPersist across conversations.\nVerify removal.'
  value.recommendation = { ...value.recommendation, brief: short }
  const view = render(<RecommendationCard {...value} />)
  expect(screen.queryByRole('button', { name: '展开方案' })).toBeNull()
  expect(screen.getByText(/Keep my task count visible/).textContent).toBe(short)
  const prefix = '计'.repeat(79) + '👩🏽‍💻'
  value.recommendation = { ...value.recommendation, brief: prefix + '\n\n保留完整方案，点击创建后交给 Creator。' }
  view.rerender(<RecommendationCard {...value} />)
  const expand = screen.getByRole('button', { name: '展开方案' })
  const paragraph = document.getElementById(expand.getAttribute('aria-controls')!)!
  expect(paragraph.textContent).toBe(prefix + '…')
  expect(expand.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(expand)
  expect(screen.getByRole('button', { name: '收起方案' }).getAttribute('aria-expanded')).toBe('true')
  expect(paragraph.textContent).toBe(value.recommendation.brief)
  expect(value.act).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '收起方案' }))
  expect(paragraph.textContent).toBe(prefix + '…')
  value.recommendation = { ...value.recommendation, brief: prefix }
  view.rerender(<RecommendationCard {...value} />)
  expect(screen.queryByRole('button', { name: '展开方案' })).toBeNull()
  expect(paragraph.textContent).toBe(prefix)
})

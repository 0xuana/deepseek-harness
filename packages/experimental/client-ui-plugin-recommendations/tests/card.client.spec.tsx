// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RecommendationOutcome } from '@deepseek-ai/dsh-experimental-plugin-recommendations/types'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { RecommendationCard, RecommendationTail } from '../src/client/Card.tsx'
import { en, zh, type RecommendationKey } from '../src/client/locales.ts'

afterEach(cleanup)
type Props = ComponentProps<typeof RecommendationCard>

function props(outcome?: RecommendationOutcome, chinese = true): Props {
  return {
    recommendation: {
      callId: ToolCallId('rec-1'), name: 'official-search', titleEn: 'Session search', titleZh: '会话搜索',
      descriptionEn: 'Search past conversations', descriptionZh: '检索过去的会话',
      request: '找上周的会话', reason: '帮你找到上周讨论的方案',
    },
    useProjection: () => ({ decisions: outcome === undefined ? {} : { 'rec-1': outcome } }),
    useChinese: <Value,>(selector: (value: boolean) => Value) => selector(chinese),
    act: vi.fn(async () => ({ status: 'settled', outcome: 'applied' })),
    openDetails: vi.fn(),
    t: (key: RecommendationKey) => (chinese ? zh : en)[key],
  } as Props
}

it('shows at most one card at the completed turn tail and none when no proposal exists', () => {
  type Tail = ComponentProps<typeof RecommendationTail>
  const value = props()
  const useRecommendations = vi.fn<(turn: string) => readonly Props['recommendation'][] | undefined>(() => undefined)
  const getTurnData = vi.fn().mockReturnValue({ closing: {} })
  const tail: Tail = {
    ...value, useRecommendations,
    turn: {
      turn: 1, start: undefined, end: { type: 'turn/end', seq: SessionSeq(1), time: 0, data: { turn: 1, reason: { kind: 'completed' } } }, status: 'closed', steps: [],
      data: { get: getTurnData, source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) },
    },
  }
  const { rerender } = render(<RecommendationTail {...tail} />)
  expect(screen.queryByRole('region')).toBeNull()
  useRecommendations.mockReturnValue([])
  rerender(<RecommendationTail {...tail} />)
  expect(screen.queryByRole('region')).toBeNull()
  useRecommendations.mockReturnValue([value.recommendation, { ...value.recommendation, callId: ToolCallId('rec-2') }])
  rerender(<RecommendationTail {...tail} />)
  expect(screen.getAllByRole('region')).toHaveLength(1)
  expect(useRecommendations).toHaveBeenCalledWith('1')
  for (const reason of [{ kind: 'aborted', reason: { kind: 'user' } }, { kind: 'interrupted' }, { kind: 'error', error: { code: 'UNKNOWN', message: 'fixture' } }] as const) {
    rerender(<RecommendationTail {...tail} turn={{ ...tail.turn, end: { type: 'turn/end', seq: SessionSeq(1), time: 0, data: { turn: 1, reason } } }} />)
    expect(screen.queryByRole('region')).toBeNull()
  }
  getTurnData.mockReturnValue(undefined)
  rerender(<RecommendationTail {...tail} />)
  expect(screen.queryByRole('region')).toBeNull()
})

it('shows host metadata, rationale and scope with explicit enable and dismiss actions', async () => {
  const value = props()
  render(<RecommendationCard {...value} />)
  expect(screen.getByRole('region', { name: '推荐插件' })).toBeTruthy()
  expect(screen.getByText('会话搜索')).toBeTruthy()
  expect(screen.getByText('启用后可在所有会话中使用')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '启用' }))
  await waitFor(() =>{  expect(value.act).toHaveBeenCalledWith('rec-1', 'enable') })
})

it('allows dismissal and disables both actions until the request settles', async () => {
  const value = props()
  const pending = Promise.withResolvers<Awaited<ReturnType<Props['act']>>>()
  value.act = vi.fn(() => pending.promise)
  render(<RecommendationCard {...value} />)
  fireEvent.click(screen.getByRole('button', { name: '暂不需要' }))
  expect(screen.getByRole('button', { name: '正在处理…' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: '暂不需要' }).hasAttribute('disabled')).toBe(true)
  expect(value.act).toHaveBeenCalledWith('rec-1', 'dismiss')
  await act(async () => { pending.resolve({ status: 'settled', outcome: 'dismissed' }) })
})

it.each(['applied', 'already-enabled', 'dismissed', 'restart-required', 'overridden'] as const)('restores %s and keeps details available without repeating the decision', (outcome) => {
  const value = props(outcome)
  render(<RecommendationCard {...value} />)
  expect(screen.getByRole('status').textContent).toBe(zh[outcome])
  expect(screen.getAllByRole('button')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '查看详情：会话搜索' }))
  expect(value.openDetails).toHaveBeenCalledWith('official-search')
  expect(value.act).not.toHaveBeenCalled()
})

it.each(['failed', 'cancelled'] as const)('keeps a retry available after %s', async (outcome) => {
  const value = props(outcome, false)
  render(<RecommendationCard {...value} />)
  expect(screen.getByText('Session search')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Retry enabling' }))
  await waitFor(() =>{  expect(value.act).toHaveBeenCalledWith('rec-1', 'enable') })
})

it('keeps the card on remote refusal, lost response, and thrown connection error', async () => {
  const value = props()
  value.act = vi.fn()
    .mockResolvedValueOnce({ status: 'refused', reason: 'unavailable' })
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('disconnected'))
  render(<RecommendationCard {...value} />)
  for (const text of [zh.unavailable, zh.transport, zh.transport]) {
    fireEvent.click(screen.getByRole('button', { name: '启用' }))
    await waitFor(() =>{  expect(screen.getByRole('alert').textContent).toBe(text) })
  }
  expect(screen.getByText('会话搜索')).toBeTruthy()
})

it('does not offer a writable card before its projection arrives', () => {
  const value = props()
  value.useProjection = (() => undefined)
  render(<RecommendationCard {...value} />)
  expect(screen.getByRole('button', { name: '启用' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: '暂不需要' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '查看详情：会话搜索' }))
  expect(value.openDetails).toHaveBeenCalledWith('official-search')
})

it('removes an uncertain transport warning when the persisted success arrives', async () => {
  const value = props()
  value.act = vi.fn().mockRejectedValue(new Error('disconnected'))
  const { rerender } = render(<RecommendationCard {...value} />)
  fireEvent.click(screen.getByRole('button', { name: '启用' }))
  await screen.findByRole('alert')
  rerender(<RecommendationCard {...props('applied')} />)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('status').textContent).toBe('已启用')
})

it('shows an actionable version failure and contains an invalid history without enabling', async () => {
  const value = props()
  value.act = vi.fn().mockResolvedValue({ status: 'settled', outcome: 'failed', errorCode: 'incompatible-version' })
  const { rerender } = render(<RecommendationCard {...value} />)
  fireEvent.click(screen.getByRole('button', { name: '启用' }))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(zh['version-error']) })
  value.act = vi.fn().mockResolvedValue({ status: 'settled', outcome: 'failed', errorCode: 'operation-error' })
  rerender(<RecommendationCard {...value} />)
  fireEvent.click(screen.getByRole('button', { name: '启用' }))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(zh['management-error']) })
  rerender(<RecommendationCard {...value} useProjection={vi.fn().mockReturnValue({ decisions: {}, invalid: true })} />)
  expect(screen.getByRole('alert').textContent).toBe(zh['invalid-history'])
  expect(screen.getByRole('button', { name: '启用' }).hasAttribute('disabled')).toBe(true)
})

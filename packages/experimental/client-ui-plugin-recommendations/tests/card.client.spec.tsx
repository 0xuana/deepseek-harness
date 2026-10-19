// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RecommendationOutcome } from '@deepseek-ai/dsh-experimental-plugin-recommendations/types'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
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
    t: (key: RecommendationKey) => (chinese ? zh : en)[key],
  } as Props
}

it('shows at most one card at the completed turn tail and none when no proposal exists', () => {
  type Tail = ComponentProps<typeof RecommendationTail>
  const value = props()
  const useRecommendations = vi.fn<(turn: string) => readonly Props['recommendation'][] | undefined>(() => undefined)
  const tail: Tail = {
    ...value, useRecommendations: useRecommendations as Tail['useRecommendations'],
    turn: {
      turn: 1, start: undefined, end: undefined, status: 'closed', steps: [],
      data: { get: () => undefined, source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) },
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
  expect(screen.getAllByRole('button').every(button => (button as HTMLButtonElement).disabled)).toBe(true)
  expect(value.act).toHaveBeenCalledWith('rec-1', 'dismiss')
  await act(async () => { pending.resolve({ status: 'settled', outcome: 'dismissed' }) })
})

it.each(['applied', 'dismissed', 'restart-required', 'overridden'] as const)('restores %s from the session without action buttons', (outcome) => {
  render(<RecommendationCard {...props(outcome)} />)
  expect(screen.getByRole('status').textContent).toBe(zh[outcome])
  expect(screen.queryByRole('button')).toBeNull()
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
  expect(screen.getAllByRole('button').every(button => (button as HTMLButtonElement).disabled)).toBe(true)
})

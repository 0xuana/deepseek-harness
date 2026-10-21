// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RecommendationCardState, RecommendationDetails, RecommendationView } from '@deepseek-ai/dsh-experimental-plugin-recommendations/types'
import type { LocalizedText } from '@deepseek-ai/dsh-package-manifest'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { RecommendationCard, RecommendationTail } from '../src/client/Card.tsx'
import { en, ja, zh, type RecommendationKey } from '../src/client/locales.ts'

afterEach(cleanup)
type Props = ComponentProps<typeof RecommendationCard>
const available: RecommendationDetails = {
  status: 'available', title: { en: 'Session search', zh: '会话搜索' }, description: { en: 'Search past conversations', zh: '检索过去的会话' }, enabled: false,
}

function props(state?: RecommendationCardState, details: RecommendationDetails = available, view?: Partial<RecommendationView>): Props {
  return {
    recommendation: { callId: ToolCallId('block:m1'), name: 'official-search', reason: '帮你找到上周讨论的方案' },
    useProjection: () => ({ decisions: state === undefined ? {} : { 'block:m1': state }, ...view }),
    useLocale: <Value,>(selector: (value: string) => Value) => selector('zh-CN'),
    act: vi.fn(async () => ({ status: 'settled', outcome: 'applied' })),
    describe: vi.fn(async () => details),
    openDetails: vi.fn(),
    resolveText: (text: LocalizedText) => typeof text === 'string' ? text : text.zh ?? text.en,
    t: (key: RecommendationKey) => zh[key],
  } as Props
}

async function shown(value: Props) {
  render(<RecommendationCard {...value} />)
  await waitFor(() => { expect(value.describe).toHaveBeenCalledWith('block:m1') })
  await act(async () => {})
}

it('keeps every dictionary aligned', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  expect(Object.keys(ja).sort()).toEqual(Object.keys(zh).sort())
})

it('shows at most one card at the completed turn tail, hides never-offered cards, and none without a proposal', async () => {
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
  useRecommendations.mockReturnValue([value.recommendation, { ...value.recommendation, callId: ToolCallId('block:m2') }])
  rerender(<RecommendationTail {...tail} />)
  expect(screen.getAllByRole('region')).toHaveLength(1)
  expect(useRecommendations).toHaveBeenCalledWith('1')
  rerender(<RecommendationTail {...tail} useProjection={props('suppressed').useProjection} />)
  expect(screen.queryByRole('region')).toBeNull()
  for (const reason of [{ kind: 'aborted', reason: { kind: 'user' } }, { kind: 'interrupted' }, { kind: 'error', error: { code: 'UNKNOWN', message: 'fixture' } }] as const) {
    rerender(<RecommendationTail {...tail} turn={{ ...tail.turn, end: { type: 'turn/end', seq: SessionSeq(1), time: 0, data: { turn: 1, reason } } }} />)
    expect(screen.queryByRole('region')).toBeNull()
  }
  getTurnData.mockReturnValue(undefined)
  rerender(<RecommendationTail {...tail} />)
  expect(screen.queryByRole('region')).toBeNull()
  await act(async () => {})
})

it('shows the Host catalog text, the reason and scope, opens details, and enables only on click', async () => {
  const value = props()
  await shown(value)
  expect(screen.getByRole('region', { name: '推荐插件' })).toBeTruthy()
  expect(screen.getByText('会话搜索')).toBeTruthy()
  expect(screen.getByText('检索过去的会话')).toBeTruthy()
  expect(screen.getByText('帮你找到上周讨论的方案')).toBeTruthy()
  expect(screen.getByText('启用后可在所有会话中使用')).toBeTruthy()
  expect(value.act).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '查看详情：会话搜索' }))
  expect(value.openDetails).toHaveBeenCalledWith('official-search')
  fireEvent.click(screen.getByRole('button', { name: '启用' }))
  await waitFor(() => { expect(value.act).toHaveBeenCalledWith('block:m1', 'enable') })
})

it('allows dismissal and disables both actions until the request settles', async () => {
  const value = props()
  const pending = Promise.withResolvers<Awaited<ReturnType<Props['act']>>>()
  value.act = vi.fn(() => pending.promise)
  await shown(value)
  fireEvent.click(screen.getByRole('button', { name: '暂不需要' }))
  expect(screen.getByRole('button', { name: '正在处理…' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: '暂不需要' }).hasAttribute('disabled')).toBe(true)
  expect(value.act).toHaveBeenCalledWith('block:m1', 'dismiss')
  await act(async () => { pending.resolve({ status: 'settled', outcome: 'dismissed' }) })
})

it.each(['applied', 'dismissed', 'replaced', 'restart-required', 'overridden'] as const)('shows the settled %s state without actions', async (state) => {
  await shown(props(state))
  expect(screen.getByRole('status').textContent).toBe(zh[state])
  expect(screen.queryByRole('button', { name: '启用' })).toBeNull()
  expect(screen.queryByRole('button', { name: '重试启用' })).toBeNull()
})

it.each(['failed', 'cancelled'] as const)('offers a retry after %s', async (state) => {
  await shown(props(state))
  expect(screen.getByRole('status').textContent).toBe(zh[state])
  expect(screen.getByRole('button', { name: '重试启用' })).toBeTruthy()
})

it('shows an enabled plugin as already enabled and a name outside the catalog without actions', async () => {
  await shown(props(undefined, { ...available, enabled: true }))
  expect(screen.getByRole('status').textContent).toBe(zh['already-enabled'])
  expect(screen.queryByRole('button', { name: '启用' })).toBeNull()
  cleanup()
  await shown(props(undefined, { status: 'refused', reason: 'unavailable' }))
  expect(screen.getByRole('alert').textContent).toBe(zh.unavailable)
  expect(screen.getByText('official-search')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '启用' })).toBeNull()
})

it('reports an unreachable Host and an unreadable history without actions', async () => {
  const lost = props()
  lost.describe = vi.fn(async () => undefined)
  await shown(lost)
  expect(screen.getByRole('alert').textContent).toBe(zh.transport)
  cleanup()
  const rejected = props()
  rejected.describe = vi.fn(async () => { throw new Error('offline') })
  await shown(rejected)
  expect(screen.getByRole('alert').textContent).toBe(zh.transport)
  cleanup()
  await shown(props(undefined, available, { invalid: true }))
  expect(screen.getByRole('alert').textContent).toBe(zh['invalid-history'])
  expect(screen.queryByRole('button', { name: '启用' })).toBeNull()
})

it('keeps actions disabled until the card state loads and shows the name while catalog text loads', async () => {
  const value = props()
  value.useProjection = () => undefined
  await shown(value)
  expect(screen.getByRole('button', { name: '启用' }).hasAttribute('disabled')).toBe(true)
  cleanup()
  const loading = props()
  const describe = Promise.withResolvers<RecommendationDetails | undefined>()
  loading.describe = vi.fn(() => describe.promise)
  const { unmount } = render(<RecommendationCard {...loading} />)
  expect(screen.getByText('official-search')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '启用' })).toBeNull()
  unmount()
  await act(async () => { describe.resolve(available) })
  const failing = props()
  const rejected = Promise.withResolvers<RecommendationDetails | undefined>()
  failing.describe = vi.fn(() => rejected.promise)
  render(<RecommendationCard {...failing} />).unmount()
  await act(async () => { rejected.reject(new Error('late')) })
})

it.each([
  [undefined, zh.transport],
  [{ status: 'refused', reason: 'access-denied' }, zh['access-denied']],
  [{ status: 'unconfirmed', reason: 'closing' }, zh.closing],
  [{ status: 'settled', outcome: 'failed', errorCode: 'incompatible-version' }, zh['version-error']],
  [{ status: 'settled', outcome: 'failed', errorCode: 'operation-error' }, zh['management-error']],
] as const)('explains an unsuccessful click: %j', async (result, message) => {
  const value = props()
  value.act = vi.fn(async () => result)
  await shown(value)
  fireEvent.click(screen.getByRole('button', { name: '启用' }))
  expect((await screen.findByRole('alert')).textContent).toBe(message)
})

it('treats a lost reply as unconfirmed rather than failed', async () => {
  const value = props()
  value.act = vi.fn(async () => { throw new Error('connection reset') })
  await shown(value)
  fireEvent.click(screen.getByRole('button', { name: '启用' }))
  expect((await screen.findByRole('alert')).textContent).toBe(zh.transport)
})

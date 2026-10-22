// @vitest-environment jsdom
import { useSyncExternalStore, type ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RecommendationCardState, RecommendationDetails, RecommendationView } from '@deepseek-ai/dsh-experimental-plugin-recommendations/types'
import type { LocalizedText } from '@deepseek-ai/dsh-package-manifest'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore, type SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import { RecommendationCard, RecommendationTail, type CatalogDetails } from '../src/client/Card.tsx'
import { en, ja, zh, type RecommendationKey } from '../src/client/locales.ts'

afterEach(cleanup)
type Props = ComponentProps<typeof RecommendationCard>
const available: RecommendationDetails = {
  status: 'available', title: { en: 'Session search', zh: '会话搜索' }, description: { en: 'Search past conversations', zh: '检索过去的会话' }, enabled: false,
}

const recommendation = { callId: ToolCallId('block:m1'), name: 'official-search', reason: '帮你找到上周讨论的方案' }

/** The plugin-lifetime catalog mount.ts creates, with the selector hook the slot binds to it. */
function catalog() {
  const store = createSnapshotStore<Readonly<Record<string, CatalogDetails>>>({})
  const useCatalog: SnapshotSelectorHook<Readonly<Record<string, CatalogDetails>>> = selector =>
    useSyncExternalStore(listener => store.subscribe(listener), () => selector(store.getSnapshot()))
  const remember = vi.fn((name: string, details: CatalogDetails) => { store.set({ ...store.getSnapshot(), [name]: details }) })
  return { store, useCatalog, remember }
}

function props(state?: RecommendationCardState, details: RecommendationDetails = available, view?: Partial<RecommendationView>,
  { useCatalog, remember } = catalog()): Props {
  return {
    recommendation,
    useProjection: () => ({ decisions: state === undefined ? {} : { 'block:m1': state }, proposals: { 'block:m1': { ...recommendation, turn: 1 } }, ...view }),
    useLocale: <Value,>(selector: (value: string) => Value) => selector('zh-CN'),
    useCatalog, remember,
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

it('shows the proposal admitted in a turn once that turn has ended for any reason, and none for other turns', async () => {
  type Tail = ComponentProps<typeof RecommendationTail>
  const value = props()
  const getTurnData = vi.fn().mockReturnValue({ closing: {} })
  const end = (reason: NonNullable<Tail['turn']['end']>['data']['reason']): Tail['turn']['end'] => ({ type: 'turn/end', seq: SessionSeq(1), time: 0, data: { turn: 1, reason } })
  const tail: Tail = {
    ...value,
    turn: {
      turn: 1, start: undefined, end: end({ kind: 'completed' }), status: 'closed', steps: [],
      data: { get: getTurnData, source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) },
    },
  }
  const view = (proposals: RecommendationView['proposals'], decisions: RecommendationView['decisions'] = {}): Tail['useProjection'] =>
    () => ({ decisions, proposals })
  const { rerender } = render(<RecommendationTail {...tail} useProjection={() => undefined} />)
  expect(screen.queryByRole('region')).toBeNull()
  rerender(<RecommendationTail {...tail} useProjection={view({ 'block:m3': { ...recommendation, callId: ToolCallId('block:m3'), turn: 2 } })} />)
  expect(screen.queryByRole('region')).toBeNull()
  const second = { ...recommendation, callId: ToolCallId('block:m2'), name: 'second', turn: 1 }
  rerender(<RecommendationTail {...tail} useProjection={view({ 'block:m2': second, 'block:m1': { ...recommendation, turn: 1 } })} />)
  expect(screen.getAllByRole('region')).toHaveLength(1)
  expect(screen.getByRole('region').getAttribute('data-plugin-recommendation')).toBe('block:m1')
  rerender(<RecommendationTail {...tail} useProjection={view({ 'block:m1': { ...recommendation, turn: 1 }, 'block:m2': second })} />)
  expect(screen.getByRole('region').getAttribute('data-plugin-recommendation')).toBe('block:m1')
  rerender(<RecommendationTail {...tail} useProjection={props('suppressed').useProjection} />)
  expect(screen.queryByRole('region')).toBeNull()
  for (const reason of [{ kind: 'aborted', reason: { kind: 'user' } }, { kind: 'interrupted' }, { kind: 'error', error: { code: 'UNKNOWN', message: 'fixture' } }] as const) {
    rerender(<RecommendationTail {...tail} turn={{ ...tail.turn, end: end(reason) }} />)
    expect(screen.getAllByRole('region')).toHaveLength(1)
  }
  rerender(<RecommendationTail {...tail} turn={{ ...tail.turn, end: undefined }} />)
  expect(screen.queryByRole('region')).toBeNull()
  getTurnData.mockReturnValue(undefined)
  rerender(<RecommendationTail {...tail} />)
  expect(screen.queryByRole('region')).toBeNull()
  await act(async () => {})
})

it('shows the Host catalog text and reason as one details target, the scope, and enables only on click', async () => {
  const value = props()
  await shown(value)
  expect(screen.getByRole('region', { name: '推荐插件' })).toBeTruthy()
  const details = screen.getByRole('button', { name: '查看详情：会话搜索' })
  for (const text of ['会话搜索', '帮你找到上周讨论的方案', '检索过去的会话']) expect(within(details).getByText(text)).toBeTruthy()
  expect(details.textContent).toBe('会话搜索帮你找到上周讨论的方案检索过去的会话')
  expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual([details.textContent, '暂不需要', '启用'])
  expect(screen.getByText('启用后可在所有会话中使用')).toBeTruthy()
  expect(value.act).not.toHaveBeenCalled()
  fireEvent.click(details)
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

it('keeps actions disabled until the card state loads', async () => {
  const value = props()
  value.useProjection = () => undefined
  await shown(value)
  expect(screen.getByRole('button', { name: '启用' }).hasAttribute('disabled')).toBe(true)
})

it('holds the title, description and action lines while the first catalog lookup is pending', async () => {
  const loading = props()
  const describe = Promise.withResolvers<RecommendationDetails | undefined>()
  loading.describe = vi.fn(() => describe.promise)
  const { container } = render(<RecommendationCard {...loading} />)
  const region = screen.getByRole('region', { name: '推荐插件' })
  expect(region.getAttribute('aria-busy')).toBe('true')
  expect(screen.queryByText('official-search')).toBeNull()
  expect(container.querySelectorAll('strong > span, button span > span')).toHaveLength(2)
  expect(screen.getByText('帮你找到上周讨论的方案')).toBeTruthy()
  expect(screen.getByText('启用后可在所有会话中使用')).toBeTruthy()
  for (const name of ['暂不需要', '启用']) expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(true)
  await act(async () => { describe.resolve(available) })
  expect(region.hasAttribute('aria-busy')).toBe(false)
  expect(within(screen.getByRole('button', { name: '查看详情：会话搜索' })).getByText('检索过去的会话')).toBeTruthy()
  expect(screen.getByRole('button', { name: '启用' }).hasAttribute('disabled')).toBe(false)
  expect(loading.remember).toHaveBeenCalledExactlyOnceWith('official-search', available)
  cleanup()
  const pending = props()
  const late = Promise.withResolvers<RecommendationDetails | undefined>()
  pending.describe = vi.fn(() => late.promise)
  render(<RecommendationCard {...pending} />).unmount()
  await act(async () => { late.resolve(available) })
  expect(pending.remember).not.toHaveBeenCalled()
  const failing = props()
  const rejected = Promise.withResolvers<RecommendationDetails | undefined>()
  failing.describe = vi.fn(() => rejected.promise)
  render(<RecommendationCard {...failing} />).unmount()
  await act(async () => { rejected.reject(new Error('late')) })
})

it('renders a remembered plugin at once on a later card while refusals and lost replies still decide its actions', async () => {
  const shared = catalog()
  await shown(props(undefined, available, undefined, shared))
  expect(shared.store.getSnapshot()).toEqual({ 'official-search': available })
  cleanup()
  const revisit = props(undefined, available, undefined, shared)
  const lookup = Promise.withResolvers<RecommendationDetails | undefined>()
  revisit.describe = vi.fn(() => lookup.promise)
  render(<RecommendationCard {...revisit} />)
  expect(screen.getByRole('region').hasAttribute('aria-busy')).toBe(false)
  expect(within(screen.getByRole('button', { name: '查看详情：会话搜索' })).getByText('检索过去的会话')).toBeTruthy()
  expect(screen.getByRole('button', { name: '启用' }).hasAttribute('disabled')).toBe(false)
  await act(async () => { lookup.resolve({ ...available, enabled: true }) })
  expect(screen.getByRole('status').textContent).toBe(zh['already-enabled'])
  cleanup()
  await shown(props(undefined, { status: 'refused', reason: 'unavailable' }, undefined, shared))
  expect(screen.getByRole('alert').textContent).toBe(zh.unavailable)
  expect(screen.queryByRole('button', { name: '启用' })).toBeNull()
  cleanup()
  const lost = props(undefined, available, undefined, shared)
  lost.describe = vi.fn(async () => undefined)
  await shown(lost)
  expect(screen.getByRole('alert').textContent).toBe(zh.transport)
  expect(screen.queryByRole('button', { name: '启用' })).toBeNull()
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

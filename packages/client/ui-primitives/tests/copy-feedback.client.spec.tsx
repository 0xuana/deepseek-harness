// @vitest-environment jsdom
/** Clipboard feedback stays within its mounted component's lifetime. */
import { StrictMode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useCopyFeedback } from '../src/use-copy-feedback.ts'
import { writeClipboard } from '../src/clipboard.ts'

vi.mock('../src/clipboard.ts', () => ({ writeClipboard: vi.fn() }))

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.resetAllMocks() })

it('expires successful feedback after one second and permits another copy', async () => {
  vi.mocked(writeClipboard).mockResolvedValue(true)
  const { result } = renderHook(() => useCopyFeedback('command'), { wrapper: StrictMode })
  await act(async () => { result.current.onCopy() })
  expect(result.current.copied).toBe(true)
  act(() => { result.current.onCopy() })
  expect(writeClipboard).toHaveBeenCalledTimes(1)
  expect(writeClipboard).toHaveBeenCalledWith('command')
  act(() => { vi.advanceTimersByTime(999) })
  expect(result.current.copied).toBe(true)
  act(() => { vi.advanceTimersByTime(1) })
  expect(result.current.copied).toBe(false)
  await act(async () => { result.current.onCopy() })
  expect(writeClipboard).toHaveBeenCalledTimes(2)
})

it('does not start feedback for a refused clipboard write', async () => {
  vi.mocked(writeClipboard).mockResolvedValue(false)
  const { result } = renderHook(() => useCopyFeedback('command'))
  await act(async () => { result.current.onCopy() })
  expect(result.current.copied).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})

it('cancels a successful copy reset timer on unmount', async () => {
  vi.mocked(writeClipboard).mockResolvedValue(true)
  const { result, unmount } = renderHook(() => useCopyFeedback('command'))
  await act(async () => { result.current.onCopy() })
  expect(vi.getTimerCount()).toBe(1)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('ignores a clipboard completion after unmount without scheduling feedback', async () => {
  const pending = Promise.withResolvers<boolean>()
  vi.mocked(writeClipboard).mockReturnValue(pending.promise)
  const { result, unmount } = renderHook(() => useCopyFeedback('command'))
  act(() => { result.current.onCopy() })
  unmount()
  await act(async () => { pending.resolve(true); await pending.promise })
  expect(vi.getTimerCount()).toBe(0)
  expect(result.current.copied).toBe(false)
})

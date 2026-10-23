// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createTrajectoryResultModeStore } from '../src/client/result-mode-store.ts'

const key = 'dsh.trajectory.jsonResultMode'
let original: string | null

beforeEach(() => {
  original = localStorage.getItem(key)
  localStorage.removeItem(key)
})

afterEach(() => {
  if (original === null) localStorage.removeItem(key)
  else localStorage.setItem(key, original)
})

it('restores the last result mode when the view is recreated', () => {
  const first = createTrajectoryResultModeStore()
  expect(first.getSnapshot()).toBe(false)
  first.set(true)
  const second = createTrajectoryResultModeStore()
  expect(second.getSnapshot()).toBe(true)
  second.set(false)
  expect(createTrajectoryResultModeStore().getSnapshot()).toBe(false)
})

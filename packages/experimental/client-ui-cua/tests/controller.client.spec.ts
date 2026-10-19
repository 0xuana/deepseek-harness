/** Permission refreshes preserve observations and join user actions before withdrawal. */
import { setImmediate } from 'node:timers/promises'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { CuaApplicationId, CuaApplicationState, CuaSystemPermissionState } from '@deepseek-ai/dsh-cua/types'
import { PermissionController } from '../src/client/controller.ts'

const value: CuaSystemPermissionState = { accessibility: true, screenRecording: false, helper: { pid: 9 }, parent: { pid: 8 } }
const applications: CuaApplicationState = {
  allowedApps: [], blockedApps: [], settingsNamespace: 'cua', persistentAvailable: true }
function fixture() {
  const actions = { readSystem: vi.fn(async () => value), readApplications: vi.fn(async () => applications),
    readIcons: vi.fn(async (): Promise<Record<string, string>> => ({})), request: vi.fn(async () => {}),
    openSettings: vi.fn(async () => {}), revoke: vi.fn(async () => {}), retryApproval: vi.fn(async () => {}) }
  const controller = new PermissionController(actions)
  return { actions, controller, face: controller.face() }
}

it('refreshes after a user request without treating the request itself as a grant', async () => {
  const f = fixture()
  f.face.request('screenRecording')
  await vi.waitFor(() => { expect(f.controller.state.getSnapshot().busy).toBe(false) })
  expect(f.actions.request).toHaveBeenCalledWith('screenRecording')
  expect(f.controller.state.getSnapshot().system.value?.screenRecording).toBe(false)
  expect(f.controller.state.getSnapshot().toast?.kind).toBe('requested')
  f.face.dismissToast()
  expect(f.controller.state.getSnapshot().toast).toBeNull()
  await f.controller.dispose()
})

it('retains the last observation while marking a failed refresh', async () => {
  const f = fixture()
  f.face.refresh()
  await vi.waitFor(() => { expect(f.controller.state.getSnapshot().system.value).toEqual(value) })
  f.actions.readSystem.mockRejectedValueOnce(new Error('connection closed'))
  f.face.refresh()
  await vi.waitFor(() => { expect(f.controller.state.getSnapshot().system.error).toBe('connection closed') })
  expect(f.controller.state.getSnapshot().system.value).toEqual(value)
  await f.controller.dispose()
})

it.each([new Error('write refused'), 'write refused'])('reports settings and revocation outcomes through the shared toast state', async (error) => {
  const f = fixture()
  f.face.openSettings('accessibility')
  await vi.waitFor(() => { expect(f.controller.state.getSnapshot().toast?.kind).toBe('opened') })
  f.face.revoke('a'.repeat(64) as CuaApplicationId)
  await vi.waitFor(() => { expect(f.controller.state.getSnapshot().toast?.kind).toBe('revoked') })
  f.face.retryApproval('a'.repeat(64) as CuaApplicationId)
  await vi.waitFor(() => { expect(f.controller.state.getSnapshot().toast?.kind).toBe('retryAllowed') })
  f.actions.revoke.mockRejectedValueOnce(error)
  f.face.revoke('a'.repeat(64) as CuaApplicationId)
  await vi.waitFor(() => { expect(f.controller.state.getSnapshot().toast).toMatchObject({ kind: 'failed', message: 'write refused' }) })
  await f.controller.dispose()
})

it('joins a pending read without publishing after disposal or starting queued actions', async () => {
  const f = fixture()
  const pending = Promise.withResolvers<CuaSystemPermissionState>()
  const entered = Promise.withResolvers<undefined>()
  f.actions.readSystem.mockImplementationOnce(() => { entered.resolve(undefined); return pending.promise })
  f.face.refresh()
  await entered.promise
  f.face.request('accessibility')
  const before = f.controller.state.getSnapshot()
  const closed = f.controller.dispose()
  pending.resolve(value)
  await closed
  expect(f.controller.state.getSnapshot()).toBe(before)
  expect(f.actions.request).not.toHaveBeenCalled()
  f.face.refresh()
  expect(f.actions.readSystem).toHaveBeenCalledOnce()
})

it('revokes access while icons are pending, serializes writes, and joins reads on disposal', async () => {
  const f = fixture(), icons = Promise.withResolvers<Record<string, string>>()
  const action = Promise.withResolvers<undefined>(), entered = Promise.withResolvers<undefined>()
  onTestFinished(async () => { icons.resolve({}); action.resolve(undefined); await f.controller.dispose() })
  f.actions.readIcons.mockReturnValueOnce(icons.promise)
  f.actions.revoke.mockImplementationOnce(() => { entered.resolve(undefined); return action.promise })
  f.face.refresh()
  await vi.waitFor(() => { expect(f.controller.state.getSnapshot().applications.busy).toBe(false) })
  expect(f.controller.state.getSnapshot().icons.busy).toBe(true)
  f.face.revoke('a'.repeat(64) as CuaApplicationId)
  await entered.promise
  f.face.retryApproval('a'.repeat(64) as CuaApplicationId)
  await setImmediate()
  expect(f.actions.retryApproval).not.toHaveBeenCalled()
  action.resolve(undefined)
  await vi.waitFor(() => { expect(f.controller.state.getSnapshot().busy).toBe(false) })
  expect(f.actions.retryApproval).toHaveBeenCalledOnce()
  expect(f.controller.state.getSnapshot().toast?.kind).toBe('retryAllowed')
  const before = f.controller.state.getSnapshot()
  let disposed = false
  const closed = f.controller.dispose().then(() => { disposed = true })
  await setImmediate()
  expect(disposed).toBe(false)
  icons.resolve({ '/old/app': 'old-icon' })
  await closed
  expect(f.controller.state.getSnapshot()).toBe(before)
})

it('ignores stale toast completion after the permission UI is disposed', async () => {
  const f = fixture()
  f.face.request('accessibility')
  await vi.waitFor(() => { expect(f.controller.state.getSnapshot().toast?.kind).toBe('requested') })
  await f.controller.dispose()
  const before = f.controller.state.getSnapshot()
  f.face.dismissToast()
  f.face.refresh()
  expect(f.controller.state.getSnapshot()).toBe(before)
})

it('contains a late read rejection and supports errors without an Error instance', async () => {
  const f = fixture()
  f.actions.readSystem.mockRejectedValueOnce('offline')
  f.face.refresh()
  await vi.waitFor(() => { expect(f.controller.state.getSnapshot().system.error).toBe('offline') })
  const pending = Promise.withResolvers<CuaSystemPermissionState>(), entered = Promise.withResolvers<undefined>()
  f.actions.readSystem.mockImplementationOnce(() => { entered.resolve(undefined); return pending.promise })
  f.face.refresh()
  await entered.promise
  const before = f.controller.state.getSnapshot(), closed = f.controller.dispose()
  pending.reject(new Error('late disconnect'))
  await closed
  expect(f.controller.state.getSnapshot()).toBe(before)
})


it.each(['success', 'failure'])('does not publish an older refresh %s while the activation refresh is queued', async (outcome) => {
  const f = fixture()
  const first = Promise.withResolvers<CuaSystemPermissionState>(), firstEntered = Promise.withResolvers<undefined>()
  const latest = Promise.withResolvers<CuaSystemPermissionState>(), latestEntered = Promise.withResolvers<undefined>()
  onTestFinished(async () => { first.resolve(value); latest.resolve(value); await f.controller.dispose() })
  f.actions.readSystem.mockImplementationOnce(() => { firstEntered.resolve(undefined); return first.promise })
  f.actions.readSystem.mockImplementationOnce(() => { latestEntered.resolve(undefined); return latest.promise })
  const observations: Array<ReturnType<typeof f.controller.state.getSnapshot>> = []
  const unsubscribe = f.controller.state.subscribe(() => { observations.push(f.controller.state.getSnapshot()) })
  onTestFinished(unsubscribe)
  f.face.refresh()
  await firstEntered.promise
  f.face.refresh()
  if (outcome === 'failure') first.reject(new Error('provider is reloading'))
  else first.resolve({ ...value, screenRecording: true })
  await latestEntered.promise
  expect(observations.every(state => state.system.error === null && state.system.value === null && state.busy)).toBe(true)
  latest.resolve(value)
  await vi.waitFor(() => { expect(f.controller.state.getSnapshot()).toMatchObject({ busy: false, system: { error: null, value } }) })
  expect(observations.every(state => state.system.error === null)).toBe(true)
})

it('keeps a user-action failure visible when a refresh is queued behind it', async () => {
  const f = fixture(), action = Promise.withResolvers<undefined>(), entered = Promise.withResolvers<undefined>()
  onTestFinished(async () => { action.resolve(undefined); await f.controller.dispose() })
  f.actions.request.mockImplementationOnce(() => { entered.resolve(undefined); return action.promise })
  f.face.request('accessibility')
  await entered.promise
  f.face.refresh()
  action.reject(new Error('permission request failed'))
  await vi.waitFor(() => { expect(f.controller.state.getSnapshot().busy).toBe(false) })
  expect(f.controller.state.getSnapshot()).toMatchObject({ system: { value, error: null },
    toast: { kind: 'failed', message: 'permission request failed' } })
})


it('publishes each observation before the other queries finish', async () => {
  const f = fixture()
  const system = Promise.withResolvers<CuaSystemPermissionState>()
  const apps = Promise.withResolvers<CuaApplicationState>()
  const icons = Promise.withResolvers<Record<string, string>>()
  onTestFinished(async () => { system.resolve(value); apps.resolve(applications); icons.resolve({}); await f.controller.dispose() })
  f.actions.readSystem.mockReturnValueOnce(system.promise)
  f.actions.readApplications.mockReturnValueOnce(apps.promise)
  f.actions.readIcons.mockReturnValueOnce(icons.promise)
  f.face.refresh()
  apps.resolve(applications)
  await vi.waitFor(() => {
    expect(f.controller.state.getSnapshot().applications).toEqual({ value: applications, error: null, busy: false })
  })
  expect(f.controller.state.getSnapshot().system).toMatchObject({ value: null, busy: true })
  system.resolve(value)
  await vi.waitFor(() => { expect(f.controller.state.getSnapshot().system).toEqual({ value, error: null, busy: false }) })
  expect(f.controller.state.getSnapshot().icons).toMatchObject({ value: null, busy: true })
  icons.reject(new Error('icon unavailable'))
  await vi.waitFor(() => { expect(f.controller.state.getSnapshot().busy).toBe(false) })
  expect(f.controller.state.getSnapshot()).toMatchObject({
    system: { value, error: null }, applications: { value: applications, error: null },
    icons: { value: null, error: 'icon unavailable', busy: false },
  })
})

it('keeps application decisions available when system inspection fails', async () => {
  const f = fixture()
  f.actions.readSystem.mockRejectedValueOnce(new Error('helper offline'))
  f.face.refresh()
  await vi.waitFor(() => { expect(f.controller.state.getSnapshot().busy).toBe(false) })
  expect(f.controller.state.getSnapshot()).toMatchObject({
    system: { value: null, error: 'helper offline' },
    applications: { value: applications, error: null, busy: false },
  })
  await f.controller.dispose()
})

/** One query projection for the permission page and activation guidance. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CuaApplicationId, CuaApplicationState, CuaSystemPermission, CuaSystemPermissionState } from '../access-types.ts'

/** Host operations available to the permission UI. */
export interface PermissionActions {
  readRuntime: () => Promise<{ persistent: boolean; writable: boolean }>
  readSystem: () => Promise<CuaSystemPermissionState>
  readApplications: () => Promise<CuaApplicationState>
  readIcons: () => Promise<Record<string, string>>
  request: (permission: CuaSystemPermission) => Promise<void>
  openSettings: (permission: CuaSystemPermission) => Promise<void>
  revoke: (id: CuaApplicationId) => Promise<void>
  retryApproval: (id: CuaApplicationId) => Promise<void>
}
interface PermissionData {
  runtime: { persistent: boolean; writable: boolean }
  system: CuaSystemPermissionState
  applications: CuaApplicationState
  icons: Record<string, string>
}
/** Query failures retain the last observation without presenting it as current. */
interface Query<T> {
  value: T | null
  busy: boolean
  error: string | null
}
/** Independently settled observations; the overall busy flag follows the latest refresh. */
export type PermissionView = { [K in keyof PermissionData]: Query<PermissionData[K]> } & {
  busy: boolean
  toast: { id: number; kind: 'requested' | 'opened' | 'revoked' | 'retryAllowed' } | { id: number; kind: 'failed'; message: string } | null
}
/** Slot actions and the renderer-bound permission projection. */
export interface PermissionFace {
  hooks: { cuaPermissions: SnapshotStore<PermissionView> }
  /** Pause observation during bundle changes, or resume with a fresh read. */
  setActive: (active: boolean) => void
  refresh: () => void
  request: (permission: CuaSystemPermission) => void
  openSettings: (permission: CuaSystemPermission) => void
  revoke: (id: CuaApplicationId) => void
  retryApproval: (id: CuaApplicationId) => void
  dismissToast: () => void
}

/** Serializes user actions and drops superseded refresh results or results arriving after disposal. */
export class PermissionController {
  /** Last observed permissions and the lifetime of the current refresh/action. */
  readonly state = createSnapshotStore<PermissionView>({
    runtime: { value: null, busy: false, error: null },
    system: { value: null, busy: false, error: null },
    applications: { value: null, busy: false, error: null },
    icons: { value: null, busy: false, error: null },
    busy: false, toast: null,
  })
  private tail: Promise<void> = Promise.resolve()
  private reads: Promise<void> = Promise.resolve()
  private closed = false
  private active = true
  private epoch = 0
  private sequence = 0
  /** @param actions Browser-owned Remote calls that reject on failed responses. */
  constructor(private readonly actions: PermissionActions) {}
  /**
   * Bind the permission projection to its user actions.
   * @returns Reactive state and controls shared by the page, prompt, and toast host.
   */
  face(): PermissionFace {
    return {
      hooks: { cuaPermissions: this.state },
      setActive: (active) => {
        if (this.closed) return
        if (active !== this.active) { this.active = active; this.epoch++ }
        if (active) this.enqueue()
        else this.state.update((state) => {
          state.busy = true
          for (const key of ['system', 'applications', 'icons'] as const) {
            state[key].busy = true; state[key].error = null
          }
        })
      },
      refresh: () => { this.enqueue() },
      request: (permission) => { this.enqueue(() => this.actions.request(permission), 'requested') },
      openSettings: (permission) => { this.enqueue(() => this.actions.openSettings(permission), 'opened') },
      revoke: (id) => { this.enqueue(() => this.actions.revoke(id), 'revoked') },
      retryApproval: (id) => { this.enqueue(() => this.actions.retryApproval(id), 'retryAllowed') },
      dismissToast: () => { if (!this.closed) this.state.update((state) => { state.toast = null }) },
    }
  }
  /** Prevent publication after UI withdrawal and join the accepted Remote work. */
  async dispose(): Promise<void> { this.closed = true; await this.tail; await this.reads }
  private enqueue(action?: () => Promise<void>, kind?: 'requested' | 'opened' | 'revoked' | 'retryAllowed'): void {
    if (this.closed || !this.active) return
    const epoch = this.epoch
    const current = () => !this.closed && this.active && epoch === this.epoch
    const sequence = ++this.sequence
    this.state.update((state) => {
      state.busy = true
      for (const key of ['runtime', 'system', 'applications', 'icons'] as const) state[key].busy = true
    })
    this.tail = this.tail.then(async () => {
      if (!current()) return
      try {
        await action?.()
        if (!current()) return
        if (kind) this.state.update((state) => { state.toast = { id: sequence, kind } })
      } catch (error) {
        if (!current()) return
        const message = error instanceof Error ? error.message : String(error)
        this.state.update((state) => { state.toast = { id: sequence, kind: 'failed', message } })
      }
      const latest = () => current() && this.sequence === sequence
      const refresh = Promise.all([
        this.read('runtime', this.actions.readRuntime, latest),
        this.read('system', this.actions.readSystem, latest),
        this.read('applications', this.actions.readApplications, latest),
        this.read('icons', this.actions.readIcons, latest),
      ]).then(() => {
        if (latest()) this.state.update((state) => { state.busy = false })
      })
      this.reads = Promise.all([this.reads, refresh]).then(() => {})
    })
  }

  private async read<K extends keyof PermissionData>(
    key: K, read: () => Promise<PermissionData[K]>, current: () => boolean,
  ): Promise<void> {
    if (!current()) return
    try {
      const value = await read()
      if (!current()) return
      this.state.update((state) => { state[key].value = value; state[key].error = null; state[key].busy = false })
    } catch (error) {
      if (!current()) return
      this.state.update((state) => {
        state[key].error = error instanceof Error ? error.message : String(error); state[key].busy = false
      })
    }
  }
}

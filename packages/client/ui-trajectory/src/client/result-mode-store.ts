/** Browser-wide preference for canonical tool result inspection. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/**
 * Create the persisted result mode shared by trajectory views.
 * @returns True for canonical values, false for rendered content (the default).
 */
export function createTrajectoryResultModeStore(): SnapshotStore<boolean> {
  return createSnapshotStore(false, { persist: { name: 'dsh.trajectory.rawResult' } })
}

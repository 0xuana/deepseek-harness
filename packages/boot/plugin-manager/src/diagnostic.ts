/** Whitelisted operation records shared by diagnostic transport and durable readers. */
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { PluginOperation, PluginOperationId } from './types.ts'

/** Identifies the process lifetime which observed management operations. */
export type PluginOperationRunId = Branded<'PluginOperationRunId'>

/** One diagnostic event; omissions and unknown outcomes must not be interpreted as successful operations. */
export interface PluginOperationRecord {
  readonly runId: PluginOperationRunId
  readonly operation: PluginOperation
  readonly transportDropped: number
}

const fields = {
  id: z.uuid().transform(value => value as PluginOperationId),
  time: z.iso.datetime(),
  reason: z.enum(['plugin', 'bundle', 'install', 'remove']),
  target: z.string().max(256).nullable(),
  stage: z.enum(['install', 'enable', 'remove']),
  enabled: z.boolean().optional(),
}
const operation: z.ZodType<PluginOperation> = z.discriminatedUnion('phase', [
  z.object({ ...fields, phase: z.literal('started') }),
  z.object({ ...fields, phase: z.literal('unknown') }),
  z.object({ ...fields, phase: z.literal('settled'),
    application: z.enum(['applied', 'restart-required', 'overridden', 'failed', 'cancelled']),
    changed: z.boolean(), version: z.string().max(128).optional(),
    errorCode: z.enum(['management-required', 'unaddressable', 'unknown-plugin', 'invalid-spec', 'already-installed',
      'ambiguous-install', 'not-bundle', 'not-removable', 'stop-profile', 'bundle-in-use', 'stale-approval',
      'incompatible-version', 'operation-error']).optional(),
    restartReason: z.enum(['no-hmr', 'package-moved', 'host-module', 'unmanaged-plugin', 'module-comparison']).optional(),
  }),
])
const record = z.object({
  runId: z.uuid().transform(value => value as PluginOperationRunId),
  operation,
  transportDropped: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
})

/**
 * Validate transport/file data and discard fields outside the diagnostic whitelist.
 * @param value - Untrusted decoded JSON.
 * @returns A bounded record, or undefined for malformed, oversized or unsupported records.
 */
export function parsePluginOperationRecord(value: unknown): PluginOperationRecord | undefined {
  const parsed = record.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

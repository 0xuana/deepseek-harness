/** Validate program-controlled completions received through birpc. */
import type { PtcJsonValue, PtcRunFailure } from '@deepseek-ai/dsh-ptc-runtime'
import { decodePtcJsonWire } from './json-wire.ts'

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Decode a remote run result without trusting model-written control traffic.
 * @param result - Untrusted result returned by the program process.
 * @returns Decoded completion or failure; malformed envelopes throw a protocol error.
 */
export function readProgramResult(result: unknown): { value?: PtcJsonValue; error?: PtcRunFailure } {
  if (!record(result)) throw new Error('invalid program result')
  if (result.error !== undefined) {
    const error = result.error
    if (!record(error) || typeof error.message !== 'string'
      || (error.kind !== 'exception' && error.kind !== 'invalid-output' && error.kind !== 'output-limit')) {
      throw new Error('invalid terminal error')
    }
    return { error: { kind: error.kind, message: error.message } }
  }
  if (result.value === undefined) return {}
  const value = decodePtcJsonWire(result.value)
  return value === undefined ? { error: { kind: 'invalid-output', message: 'program completion must be lossless JSON' } } : { value }
}

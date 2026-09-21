/** Shared narrowing for raw Tool call and result fields consumed by card models. */
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'

/** A parsed, in-window Tool call whose arguments are a JSON object. */
export interface ParsedToolCall {
  name: string
  args: Record<string, unknown>
}

const parsedCalls = new WeakMap<ToolCallBlock, ParsedToolCall | null>()

/**
 * Parse the call head paired with one immutable Tool block.
 * @param block - running or settled Tool block.
 * @returns the Tool name and object arguments, or null when the call head or valid JSON object is unavailable.
 */
export function parsedToolCall(block: ToolCallBlock): ParsedToolCall | null {
  const cached = parsedCalls.get(block)
  if (cached !== undefined || parsedCalls.has(block)) return cached ?? null
  const call = 'kind' in block ? block.call : block
  if (call === null) {
    parsedCalls.set(block, null)
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(call.argsRaw)
  } catch {
    parsedCalls.set(block, null)
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    parsedCalls.set(block, null)
    return null
  }
  const parsed = { name: call.name, args: value as Record<string, unknown> }
  parsedCalls.set(block, parsed)
  return parsed
}

/**
 * Read the exact single text block consumed by first-party card derivations.
 * @param block - settled Tool result.
 * @returns its text, or undefined for any other content layout.
 */
export function singleResultText(block: ToolResultNode): string | undefined {
  if (block.content.length !== 1) return undefined
  const only = block.content[0]
  return only?.type === 'text' ? only.text : undefined
}

/**
 * Narrow optional escalation fields for shell and file cards. Absent or blank
 * reasons are renderable; execution owns effective-mode and approval checks.
 * @param args - parsed open-root Tool arguments.
 * @returns whether field types, permission values, and non-empty reason pairing are renderable.
 */
export function validEscalationFields(args: Record<string, unknown>): boolean {
  const permission = args.sandbox_permissions
  const justification = args.justification
  if (justification !== undefined && typeof justification !== 'string') return false
  if (permission === undefined) return justification === undefined || justification.trim() === ''
  return permission === 'workspace-write' || permission === 'danger-full-access'
}

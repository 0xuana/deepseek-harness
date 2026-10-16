/** Durable model-selection fold and its client projection. */
import type { ModelSelection } from '@deepseek-ai/dsh-agent/types'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import type { EpochHeader } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type {} from './types.ts'
import { sameModelSelection, toSelection } from './selection.ts'

/** Selection a recorded request used, omitting an effort the adapter defaulted. */
function selectionOfHeader({ config, adapterDefaults }: EpochHeader): ModelSelection {
  return toSelection(config.provider, config.model, adapterDefaults?.reasoningEffort === true ? undefined : config.reasoningEffort)
}

const selectionSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).transform(ReasoningEffortId).exactOptional(),
}).nullable()

/**
 * Session selection fold: recorded selections become
 * the pending choice, and each request header retires a matching one.
 */
export const modelSelectionProjectionDefinition: Required<ProjectionDefinition<'modelSelection'>> = {
  key: 'modelSelection',
  stateVersion: 3,
  stateSchema: z.object({ lastUsed: selectionSchema, pending: selectionSchema }),
  init: () => ({ lastUsed: null, pending: null }),
  apply: (state, event) => {
    if (event.type === 'model/selection') {
      return sameModelSelection(state.pending, event.data) ? state : { ...state, pending: { ...event.data } }
    }
    if (event.type !== 'request/header') return state
    const lastUsed = selectionOfHeader(event.data.header)
    const pending = sameModelSelection(state.pending, lastUsed) ? null : state.pending
    return sameModelSelection(state.lastUsed, lastUsed) && pending === state.pending ? state : { lastUsed, pending }
  },
  wire: {
    viewSchema: z.object({ lastUsed: selectionSchema, next: selectionSchema }),
    view: state => ({ lastUsed: state.lastUsed, next: state.pending ?? state.lastUsed }),
  },
}

/** Cordis-owned image transfers shared by independently rendered image and composer entries. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { IMAGE_DRAG_TOKEN_TYPE, type DesktopImageDrag, type ImageDragActions } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { ImageDragFeedback, type ImageDragFailure, type ImageDragFeedbackInjected } from './feedback.tsx'

/** Application-local original bytes and the narrow operations injected into image entries. */
export interface ImageDragService {
  readonly actions: ImageDragActions
  /** Resolve this application's retained image; @param transfer - browser drop payload. @returns original file for a matching token. */
  readonly read: (transfer: DataTransfer) => File | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Image transfer ownership scoped to this plugin's lifetime. */
    imageDrag: ImageDragService
  }
}

/** Registry used to contribute feedback to the existing shell overlay. */
export const inject = ['slots']

/**
 * Own one application's drag bytes, desktop bridge, and transient failure feedback.
 * @param ctx - client plugin context carrying the slot registry.
 */
export function apply(ctx: Context): void {
  const bridge = (globalThis as typeof globalThis & { dshDesktop?: { protocolVersion: number; imageDrag?: DesktopImageDrag } }).dshDesktop
  const desktop = bridge?.protocolVersion === 1 ? bridge.imageDrag : undefined
  const failure = createSnapshotStore<ImageDragFailure | null>(null)
  let active: { token: string; file: File } | undefined
  let sequence = 0
  const end = (): void => { active = undefined }
  const dismiss = (): void => { failure.set(null) }
  const actions: ImageDragActions = {
    desktop,
    report: (text) => { failure.set({ text, sequence: ++sequence }) },
    begin: (file) => {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
      active = { token, file }
      return token
    },
    end,
  }
  ctx.provide('imageDrag', {
    actions,
    read: transfer => active !== undefined && active.token === transfer.getData(IMAGE_DRAG_TOKEN_TYPE) ? active.file : undefined,
  })
  ctx.effect(() => {
    window.addEventListener('dragend', end)
    return () => { window.removeEventListener('dragend', end); end(); dismiss() }
  })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'image-drag.feedback',
    inject: (): ImageDragFeedbackInjected => ({ hooks: { failure }, dismiss }),
  }, ImageDragFeedback))
}

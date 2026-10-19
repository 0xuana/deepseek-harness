/** Application-owned callbacks used by original-image drag primitives. */
import type { DesktopImageDrag } from './image-drag.ts'

/** DataTransfer type containing an application-local token, not image bytes. */
export const IMAGE_DRAG_TOKEN_TYPE = 'application/x-dsh-image'

/** Narrow operations supplied by an image-transfer owner that outlives the source component. */
export interface ImageDragActions {
  /** Native file operations when running in a supported desktop shell. */
  readonly desktop: DesktopImageDrag | undefined
  /** Display localized failure feedback independently of the source image. */
  readonly report: (text: string) => void
  /** Retain original bytes for this drag; @returns the application-local transfer token. */
  readonly begin: (file: File) => string
  /** End the current browser transfer and release its retained bytes. */
  readonly end: () => void
}

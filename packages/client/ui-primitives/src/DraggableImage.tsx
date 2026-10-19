/** Original-image drag gestures owned by a presentation primitive. */
import { forwardRef, type ImgHTMLAttributes } from 'react'
import { useImageDrag } from './image-drag.ts'

/** Image presentation plus the original bytes and localized drag failure. */
export interface DraggableImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'draggable' | 'onDragStart' | 'onDragEnd' | 'onPointerEnter' | 'onPointerDown' | 'onClickCapture'> {
  readonly src: string
  readonly name: string
  readonly failureText: string
  readonly original?: File | undefined
}

/**
 * Render an image with original-file dragging; requires an ancestor ImageDragProvider.
 * @param props - image attributes, original filename and localized failure text.
 * @param ref - image element for measurement and pointer-mode bindings.
 * @returns a draggable image that suppresses only the mouse click following its drag.
 */
export const DraggableImage = forwardRef<HTMLImageElement, DraggableImageProps>(function DraggableImage(
  { src, name, failureText, original, ...props }, ref,
) {
  const drag = useImageDrag(src, name, failureText, original)
  return <img {...props} {...drag} src={src} ref={ref} draggable />
})

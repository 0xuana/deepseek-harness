/** Application-lifetime feedback for image drag operations. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Toast } from './Toast.tsx'

/** Browser drag token; file bytes remain in the owning mounted application. */
export const IMAGE_DRAG_TYPE = 'application/x-dsh-image'

interface ImageTransfer {
  report: (text: string) => void
  begin: (file: File) => string
  end: () => void
  read: (transfer: DataTransfer) => File | undefined
}

const missingProvider = (): never => { throw new Error('Image dragging requires ImageDragProvider') }
const ImageDragFeedback = createContext<ImageTransfer>({
  report: missingProvider, begin: missingProvider, end: missingProvider, read: missingProvider,
})

/**
 * Keep drag failures visible when their source image or conversation unmounts.
 * @param props - application children.
 * @returns children and the current localized failure toast.
 */
export function ImageDragProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const active = useRef<{ token: string; file: File }>()
  const sequence = useRef(0)
  const [failure, setFailure] = useState<{ text: string; sequence: number }>()
  const report = useCallback((text: string) => { setFailure({ text, sequence: ++sequence.current }) }, [])
  const dismiss = useCallback(() => { setFailure(undefined) }, [])
  const begin = useCallback((file: File): string => {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
    active.current = { token, file }
    return token
  }, [])
  const end = useCallback(() => { active.current = undefined }, [])
  useEffect(() => {
    window.addEventListener('dragend', end)
    return () => { window.removeEventListener('dragend', end) }
  }, [end])
  const read = useCallback((transfer: DataTransfer): File | undefined => {
    const current = active.current
    return current !== undefined && current.token === transfer.getData(IMAGE_DRAG_TYPE) ? current.file : undefined
  }, [])
  const value = useMemo(() => ({ report, begin, end, read }), [report, begin, end, read])
  return <ImageDragFeedback.Provider value={value}>
    {children}
    {failure !== undefined && <Toast key={failure.sequence} text={failure.text} onDone={dismiss} />}
  </ImageDragFeedback.Provider>
}

/** @returns the mounted application's image transfer owner. */
export function useImageDragTransfer(): ImageTransfer {
  return useContext(ImageDragFeedback)
}

/** @returns a reader that resolves only this application's active original-image drag. */
export function useImageDrop(): (transfer: DataTransfer) => File | undefined {
  return useImageDragTransfer().read
}

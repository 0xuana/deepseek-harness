// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { bindImagePan } from '../src/client/image/pan.ts'

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals() })

function viewport(width: number, height: number) {
  const scrollport = document.createElement('div')
  scrollport.dataset.documentZoomScrollport = ''
  Object.defineProperties(scrollport, {
    clientWidth: { value: 400 }, clientHeight: { value: 300 },
    scrollWidth: { configurable: true, value: width }, scrollHeight: { configurable: true, value: height },
  })
  const image = document.createElement('img')
  scrollport.append(image)
  document.body.append(scrollport)
  let captured: number | undefined
  image.setPointerCapture = (id) => { captured = id }
  image.hasPointerCapture = id => captured === id
  image.releasePointerCapture = () => { captured = undefined }
  return { scrollport, image, captured: () => captured }
}
function pointer(image: HTMLImageElement, type: string, values: Partial<PointerEventInit> = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...values })
  Object.defineProperties(event, { pointerId: { value: values.pointerId ?? 1 }, pointerType: { value: values.pointerType ?? 'mouse' } })
  image.dispatchEvent(event)
  return event
}

it('pans a fit-width long image on its overflowing axis and leaves no pointer capture after release', () => {
  const { image, scrollport, captured } = viewport(400, 900)
  const dispose = bindImagePan(image)
  try {
    expect(image.draggable).toBe(false)
    expect(image.dataset.pan).toBe('available')
    expect(pointer(image, 'pointerdown', { clientX: 200, clientY: 200 }).defaultPrevented).toBe(true)
    pointer(image, 'pointermove', { clientX: 100, clientY: 100 })
    expect(scrollport.scrollLeft).toBe(0)
    expect(scrollport.scrollTop).toBe(100)
    expect(captured()).toBe(1)
    pointer(image, 'pointerup')
    expect(captured()).toBeUndefined()
    pointer(image, 'pointermove', { clientY: 0 })
    expect(scrollport.scrollTop).toBe(100)
  } finally { dispose() }
})

it('clamps both axes, reverses immediately at an edge, and releases on blur', () => {
  const { image, scrollport, captured } = viewport(800, 600)
  const dispose = bindImagePan(image)
  try {
    pointer(image, 'pointerdown', { clientX: 100, clientY: 100 })
    pointer(image, 'pointermove', { clientX: -500, clientY: -500 })
    expect([scrollport.scrollLeft, scrollport.scrollTop]).toEqual([400, 300])
    pointer(image, 'pointermove', { clientX: -490, clientY: -490 })
    expect([scrollport.scrollLeft, scrollport.scrollTop]).toEqual([390, 290])
    window.dispatchEvent(new Event('blur'))
    expect(captured()).toBeUndefined()
    expect(image.dataset.pan).toBe('available')
  } finally { dispose() }
})

it('lets contained images drag as files, and switches mode when their viewport changes', () => {
  const { image, scrollport } = viewport(400, 300)
  let resize = () => {}
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect = disconnect
  })
  const dispose = bindImagePan(image)
  expect(image.draggable).toBe(true)
  expect(pointer(image, 'pointerdown').defaultPrevented).toBe(false)
  Object.defineProperty(scrollport, 'scrollHeight', { value: 600 })
  resize()
  expect(image.draggable).toBe(true)
  pointer(image, 'pointerup')
  expect(image.draggable).toBe(false)
  pointer(image, 'pointerdown', { pointerType: 'touch' })
  expect(image.dataset.pan).toBe('available')
  dispose()
  expect(disconnect).toHaveBeenCalledOnce()
})

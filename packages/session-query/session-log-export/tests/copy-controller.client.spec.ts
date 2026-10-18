// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionMarkdownCopyController } from '../src/client/copy-controller.ts'

const SID = 'session-copy-controller' as SessionId
const OTHER = 'session-copy-other' as SessionId

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SessionMarkdownCopyController', () => {
  it('fetches the Markdown route and writes the complete response', async () => {
    const fetcher = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response('# Title\n\nText\n', { status: 200 }))
    const write = vi.fn(async () => true)
    const controller = new SessionMarkdownCopyController(fetcher, write)

    await controller.copy(SID)

    expect(fetcher).toHaveBeenCalledOnce()
    const [route, init] = fetcher.mock.calls[0]!
    expect(route).toBe(`api/session.markdown?sessionId=${SID}`)
    expect(init?.method).toBeUndefined()
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(write).toHaveBeenCalledWith('# Title\n\nText\n')
    expect(controller.store.getSnapshot()).toMatchObject({
      copying: false,
      notice: { kind: 'success' },
    })
  })

  it('joins a second-Session request to the pending copy and keeps its captured target', async () => {
    const responses = Promise.withResolvers<Response>()
    const fetcher = vi.fn((_input: string | URL, _init?: RequestInit) => responses.promise)
    const write = vi.fn(async () => true)
    const controller = new SessionMarkdownCopyController(fetcher, write)

    const first = controller.copy(SID)
    const second = controller.copy(OTHER)
    expect(first).toBe(second)
    expect(controller.store.getSnapshot().copying).toBe(true)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0]?.[0]).toBe(`api/session.markdown?sessionId=${SID}`)

    responses.resolve(new Response('markdown for first'))
    await first
    expect(write).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledWith('markdown for first')
    expect(controller.store.getSnapshot().copying).toBe(false)

    await controller.copy(OTHER)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1]?.[0]).toBe(`api/session.markdown?sessionId=${OTHER}`)
  })

  it('publishes failures for HTTP, transport, and clipboard rejection without leaking rejections', async () => {
    const http = new SessionMarkdownCopyController(
      async () => new Response('hidden detail', { status: 500 }),
      vi.fn(async () => true),
    )
    await http.copy(SID)
    expect(http.store.getSnapshot()).toMatchObject({
      copying: false,
      notice: { kind: 'failed' },
    })

    const write = vi.fn()
    const transport = new SessionMarkdownCopyController(async () => { throw new Error('offline') }, write)
    await transport.copy(SID)
    expect(transport.store.getSnapshot().notice?.kind).toBe('failed')
    expect(write).not.toHaveBeenCalled()

    const rejected = new SessionMarkdownCopyController(
      async () => new Response('markdown'),
      async () => false,
    )
    await rejected.copy(SID)
    expect(rejected.store.getSnapshot().notice?.kind).toBe('failed')
  })

  it('accepts a new copy after a failed operation settles', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('hidden', { status: 500 }))
      .mockResolvedValueOnce(new Response('markdown'))
    const write = vi.fn(async () => true)
    const controller = new SessionMarkdownCopyController(fetcher, write)

    await controller.copy(SID)
    expect(controller.store.getSnapshot().notice?.kind).toBe('failed')
    await controller.copy(SID)
    expect(controller.store.getSnapshot().notice?.kind).toBe('success')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenCalledOnce()
  })

  it('dismisses a notice and ignores a dismissal with no notice', async () => {
    const controller = new SessionMarkdownCopyController(
      async () => new Response('markdown'),
      async () => true,
    )
    controller.dismiss()
    expect(controller.store.getSnapshot().notice).toBeNull()

    await controller.copy(SID)
    expect(controller.store.getSnapshot().notice?.kind).toBe('success')
    controller.dismiss()
    expect(controller.store.getSnapshot().notice).toBeNull()
  })

  it('aborts pending fetches and suppresses a write that settles after disposal', async () => {
    const gate = Promise.withResolvers<Response>()
    const write = vi.fn(async () => true)
    const controller = new SessionMarkdownCopyController(() => gate.promise, write)

    const pending = controller.copy(SID)
    const disposing = controller.dispose()
    gate.resolve(new Response('late markdown'))
    await disposing
    await pending

    expect(write).not.toHaveBeenCalled()
    expect(controller.store.getSnapshot()).toEqual({ copying: false, notice: null })
    await expect(controller.copy(SID)).resolves.toBeUndefined()
  })

  it('suppresses success when disposal starts while the clipboard write is pending', async () => {
    const writeGate = Promise.withResolvers<boolean>()
    const write = vi.fn(() => writeGate.promise)
    const controller = new SessionMarkdownCopyController(async () => new Response('markdown'), write)
    const pending = controller.copy(SID)
    await vi.waitFor(() => { expect(write).toHaveBeenCalledOnce() })

    const disposing = controller.dispose()
    writeGate.resolve(true)
    await disposing
    await pending

    expect(controller.store.getSnapshot()).toEqual({ copying: false, notice: null })
  })

  it('suppresses a rejection caused by disposal instead of publishing failure', async () => {
    const fetcher = vi.fn((_input: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
    }))
    const controller = new SessionMarkdownCopyController(fetcher, vi.fn(async () => true))
    const pending = controller.copy(SID)

    await controller.dispose()
    await pending

    expect(controller.store.getSnapshot()).toEqual({ copying: false, notice: null })
  })

  it('uses the document-relative default carrier and the host clipboard writer', async () => {
    const fetcher = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response('default markdown'))
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('fetch', fetcher)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const controller = new SessionMarkdownCopyController()

    await controller.copy(SID)

    expect(fetcher).toHaveBeenCalledOnce()
    const [route, init] = fetcher.mock.calls[0]!
    expect(route).toBe(`api/session.markdown?sessionId=${SID}`)
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(writeText).toHaveBeenCalledWith('default markdown')
    expect(controller.store.getSnapshot().notice?.kind).toBe('success')
  })
})

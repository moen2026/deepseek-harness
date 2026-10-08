import { ConnectorChannelId } from '@deepseek-ai/dsh-connector'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDingtalkClient } from '../src/client.ts'

const WEBHOOK_URL = 'https://oapi.dingtalk.com/robot/sendBySession?session=x'

/** A session expiry far enough ahead of the current clock to stay usable. */
function farFuture(): number {
  return Date.now() + 3_600_000
}

/** Asymmetric substring matcher, typed unknown so expected-object literals stay lint-clean. */
function containing(text: string): unknown {
  const matcher: unknown = expect.stringContaining(text)
  return matcher
}

/** Asymmetric subset matcher, typed unknown so expected-object literals stay lint-clean. */
function objectWith(value: object): unknown {
  const matcher: unknown = expect.objectContaining(value)
  return matcher
}

/** Install a typed fetch stub for one test. */
function stubFetch(): ReturnType<typeof vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>> {
  const mock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
  vi.stubGlobal('fetch', mock)
  return mock
}

/** One successful send answer. */
function sendResponse(): Response {
  return Response.json({ errcode: 0, errmsg: 'ok' })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('DingTalk outbound client', () => {
  it('replies to a remembered session webhook in text', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(sendResponse())
    const client = createDingtalkClient({ timeoutMs: 1_000 })
    client.remember(ConnectorChannelId('conv-1'), WEBHOOK_URL, farFuture())

    await client.push(ConnectorChannelId('conv-1'), { text: 'hello' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(WEBHOOK_URL)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(init?.body as string)).toEqual({ msgtype: 'text', text: { content: 'hello' } })
  })

  it('renders a title above the text', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(sendResponse())
    const client = createDingtalkClient({ timeoutMs: 1_000 })
    client.remember(ConnectorChannelId('conv-1'), WEBHOOK_URL, farFuture())

    await client.push(ConnectorChannelId('conv-1'), { title: 'Report', text: 'Done' })

    expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string))
      .toEqual({ msgtype: 'text', text: { content: 'Report\nDone' } })
  })

  it('refuses a conversation that never spoke, before any request', async () => {
    const fetchMock = stubFetch()
    const client = createDingtalkClient({ timeoutMs: 1_000 })

    await expect(client.push(ConnectorChannelId('conv-1'), { text: 'hi' }))
      .rejects.toMatchObject({ code: 'DINGTALK_SESSION_UNAVAILABLE' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a session inside the expiry margin and accepts one just outside it', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValue(sendResponse())
    const client = createDingtalkClient({ timeoutMs: 1_000 })

    client.remember(ConnectorChannelId('conv-1'), WEBHOOK_URL, 1_700_000_060_000)
    await expect(client.push(ConnectorChannelId('conv-1'), { text: 'hi' }))
      .rejects.toMatchObject({ code: 'DINGTALK_SESSION_UNAVAILABLE' })

    client.remember(ConnectorChannelId('conv-1'), WEBHOOK_URL, 1_700_000_060_001)
    await client.push(ConnectorChannelId('conv-1'), { text: 'hi' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('prefers a newer webhook for the same conversation', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(sendResponse())
    const client = createDingtalkClient({ timeoutMs: 1_000 })
    client.remember(ConnectorChannelId('conv-1'), WEBHOOK_URL, farFuture())
    client.remember(ConnectorChannelId('conv-1'), `${WEBHOOK_URL}&fresh=1`, farFuture())

    await client.push(ConnectorChannelId('conv-1'), { text: 'hi' })

    expect(fetchMock.mock.calls[0]![0]).toContain('fresh=1')
  })

  it('maps every failure answer to DINGTALK_DELIVERY_FAILED', async () => {
    const fetchMock = stubFetch()
    const client = createDingtalkClient({ timeoutMs: 1_000 })
    client.remember(ConnectorChannelId('conv-1'), WEBHOOK_URL, farFuture())

    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))
    await expect(client.push(ConnectorChannelId('conv-1'), { text: 'hi' }))
      .rejects.toMatchObject({ code: 'DINGTALK_DELIVERY_FAILED', message: containing('responded 500') })

    fetchMock.mockResolvedValueOnce(new Response('not-json', { status: 200 }))
    await expect(client.push(ConnectorChannelId('conv-1'), { text: 'hi' }))
      .rejects.toMatchObject({ code: 'DINGTALK_DELIVERY_FAILED', message: containing('non-JSON body') })

    fetchMock.mockResolvedValueOnce(Response.json(null))
    await expect(client.push(ConnectorChannelId('conv-1'), { text: 'hi' }))
      .rejects.toMatchObject({ message: containing('unexpected body') })

    fetchMock.mockResolvedValueOnce(Response.json(['unexpected']))
    await expect(client.push(ConnectorChannelId('conv-1'), { text: 'hi' }))
      .rejects.toMatchObject({ message: containing('unexpected body') })

    fetchMock.mockResolvedValueOnce(Response.json({ errcode: 310000, errmsg: 'keywords not in content' }))
    await expect(client.push(ConnectorChannelId('conv-1'), { text: 'hi' }))
      .rejects.toMatchObject({ message: containing('send failed with code 310000') })
  })

  it('wraps a transport failure with its cause', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockRejectedValueOnce(new Error('socket reset'))
    const client = createDingtalkClient({ timeoutMs: 1_000 })
    client.remember(ConnectorChannelId('conv-1'), WEBHOOK_URL, farFuture())

    await expect(client.push(ConnectorChannelId('conv-1'), { text: 'hi' })).rejects.toMatchObject({
      code: 'DINGTALK_DELIVERY_FAILED',
      message: containing('request failed'),
      cause: objectWith({ message: 'socket reset' }),
    })
  })

  it('forwards cancellation into the request', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(sendResponse())
    const client = createDingtalkClient({ timeoutMs: 1_000 })
    client.remember(ConnectorChannelId('conv-1'), WEBHOOK_URL, farFuture())

    const controller = new AbortController()
    await client.push(ConnectorChannelId('conv-1'), { text: 'hi' }, controller.signal)
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(false)
    controller.abort()
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true)
  })
})

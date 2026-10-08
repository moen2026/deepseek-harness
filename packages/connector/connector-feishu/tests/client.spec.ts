import type { Context } from '@deepseek-ai/cordis'
import { ConnectorChannelId } from '@deepseek-ai/dsh-connector'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFeishuClient } from '../src/client.ts'

const OPTIONS = {
  apiBaseUrl: 'https://open.feishu.cn',
  appId: 'cli_app',
  appSecretRef: credentialRef('DSH_FEISHU_APP_SECRET'),
  timeoutMs: 1_000,
} as const

/** Credential store whose value can rotate or vanish between requests. */
function fakeContext(secret: string | undefined = 'app-secret'): {
  ctx: Context
  setSecret(value: string | undefined): void
} {
  let current: string | undefined = secret
  return {
    ctx: {
      credentials: {
        resolve: async () => current === undefined ? undefined : { value: current, source: 'environment' },
      },
    } as unknown as Context,
    setSecret(value) { current = value },
  }
}

/** One fetch call's request URL as its original string. */
function urlOf(url: string | URL | Request): string {
  if (typeof url === 'string') return url
  return url instanceof URL ? url.href : url.url
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

/** One successful tenant-token answer. */
function tokenResponse(token: string, expire: number): Response {
  return Response.json({ code: 0, msg: 'ok', tenant_access_token: token, expire })
}

/** One successful send answer. */
function sendResponse(): Response {
  return Response.json({ code: 0, msg: 'ok', data: { message_id: 'om-1' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Feishu outbound client', () => {
  it('mints a tenant token and posts the addressed text', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(tokenResponse('t-1', 7200)).mockResolvedValueOnce(sendResponse())
    const client = createFeishuClient(fakeContext().ctx, { ...OPTIONS })

    await client.push(ConnectorChannelId('chat-1'), { text: 'hello' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!
    expect(tokenUrl).toBe('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal')
    expect(tokenInit?.method).toBe('POST')
    expect(JSON.parse(tokenInit?.body as string)).toEqual({ app_id: 'cli_app', app_secret: 'app-secret' })
    const [sendUrl, sendInit] = fetchMock.mock.calls[1]!
    expect(sendUrl).toBe('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id')
    expect(sendInit?.headers).toEqual({ authorization: 'Bearer t-1', 'content-type': 'application/json' })
    expect(JSON.parse(sendInit?.body as string)).toEqual({
      receive_id: 'chat-1',
      msg_type: 'text',
      content: '{"text":"hello"}',
    })
  })

  it('caches the token across pushes and re-mints after its usable window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const fetchMock = stubFetch()
    fetchMock
      .mockResolvedValueOnce(tokenResponse('t-1', 7200))
      .mockResolvedValueOnce(sendResponse())
      .mockResolvedValueOnce(sendResponse())
    const client = createFeishuClient(fakeContext().ctx, { ...OPTIONS })

    await client.push(ConnectorChannelId('chat-1'), { text: 'first' })
    await client.push(ConnectorChannelId('chat-1'), { text: 'second' })
    expect(fetchMock.mock.calls.filter(call => urlOf(call[0]).includes('tenant_access_token'))).toHaveLength(1)

    vi.advanceTimersByTime((7200 - 60) * 1000)
    fetchMock.mockResolvedValueOnce(tokenResponse('t-2', 7200)).mockResolvedValueOnce(sendResponse())
    await client.push(ConnectorChannelId('chat-1'), { text: 'third' })

    const urls = fetchMock.mock.calls.map(call => urlOf(call[0]))
    expect(urls.filter(url => url.includes('tenant_access_token'))).toHaveLength(2)
    expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).toMatchObject({ authorization: 'Bearer t-2' })
  })

  it('refuses an unavailable or empty app secret before any request', async () => {
    const fetchMock = stubFetch()
    const fake = fakeContext()
    const client = createFeishuClient(fake.ctx, { ...OPTIONS })

    fake.setSecret(undefined)
    await expect(client.push(ConnectorChannelId('chat-1'), { text: 'hi' }))
      .rejects.toMatchObject({ code: 'FEISHU_CREDENTIALS_UNAVAILABLE' })
    fake.setSecret('')
    await expect(client.push(ConnectorChannelId('chat-1'), { text: 'hi' }))
      .rejects.toMatchObject({ code: 'FEISHU_CREDENTIALS_UNAVAILABLE' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rotates the app secret between token mints', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const fetchMock = stubFetch()
    const fake = fakeContext('first-secret')
    const client = createFeishuClient(fake.ctx, { ...OPTIONS })

    fetchMock.mockResolvedValueOnce(tokenResponse('t-1', 7200)).mockResolvedValueOnce(sendResponse())
    await client.push(ConnectorChannelId('chat-1'), { text: 'one' })
    expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toMatchObject({ app_secret: 'first-secret' })

    fake.setSecret('second-secret')
    vi.advanceTimersByTime(7200 * 1000)
    fetchMock.mockResolvedValueOnce(tokenResponse('t-2', 7200)).mockResolvedValueOnce(sendResponse())
    await client.push(ConnectorChannelId('chat-1'), { text: 'two' })
    const mintCalls = fetchMock.mock.calls.filter(call => urlOf(call[0]).includes('tenant_access_token'))
    expect(JSON.parse(mintCalls[1]![1]?.body as string)).toMatchObject({ app_secret: 'second-secret' })
  })

  it('maps token request failures to FEISHU_DELIVERY_FAILED', async () => {
    const fetchMock = stubFetch()
    const client = createFeishuClient(fakeContext().ctx, { ...OPTIONS })

    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))
    await expect(client.push(ConnectorChannelId('chat-1'), { text: 'hi' }))
      .rejects.toMatchObject({ code: 'FEISHU_DELIVERY_FAILED', message: containing('responded 500') })

    fetchMock.mockResolvedValueOnce(Response.json({ code: 100, msg: 'bad secret' }))
    await expect(client.push(ConnectorChannelId('chat-1'), { text: 'hi' }))
      .rejects.toMatchObject({ code: 'FEISHU_DELIVERY_FAILED', message: containing('code 100') })

    fetchMock.mockResolvedValueOnce(new Response('not-json', { status: 200 }))
    await expect(client.push(ConnectorChannelId('chat-1'), { text: 'hi' }))
      .rejects.toMatchObject({ message: containing('non-JSON body') })

    fetchMock.mockResolvedValueOnce(Response.json(null))
    await expect(client.push(ConnectorChannelId('chat-1'), { text: 'hi' }))
      .rejects.toMatchObject({ message: containing('unexpected body') })

    fetchMock.mockResolvedValueOnce(Response.json('unexpected'))
    await expect(client.push(ConnectorChannelId('chat-1'), { text: 'hi' }))
      .rejects.toMatchObject({ message: containing('unexpected body') })

    fetchMock.mockResolvedValueOnce(Response.json({ code: 0, tenant_access_token: '', expire: 7200 }))
    await expect(client.push(ConnectorChannelId('chat-1'), { text: 'hi' }))
      .rejects.toMatchObject({ message: containing('code 0') })

    fetchMock.mockResolvedValueOnce(Response.json({ code: 0, tenant_access_token: 't', expire: 'soon' }))
    await expect(client.push(ConnectorChannelId('chat-1'), { text: 'hi' }))
      .rejects.toMatchObject({ message: containing('code 0') })
  })

  it('maps send failures to FEISHU_DELIVERY_FAILED', async () => {
    const fetchMock = stubFetch()
    const client = createFeishuClient(fakeContext().ctx, { ...OPTIONS })

    fetchMock.mockResolvedValueOnce(tokenResponse('t-1', 7200)).mockResolvedValueOnce(new Response('no', { status: 403 }))
    await expect(client.push(ConnectorChannelId('chat-1'), { text: 'hi' }))
      .rejects.toMatchObject({ code: 'FEISHU_DELIVERY_FAILED', message: containing('responded 403') })

    fetchMock.mockResolvedValueOnce(Response.json({ code: 999, msg: 'nope' }))
    await expect(client.push(ConnectorChannelId('chat-1'), { text: 'hi' }))
      .rejects.toMatchObject({ message: containing('send failed with code 999') })

    fetchMock.mockResolvedValueOnce(new Response('not-json', { status: 200 }))
    await expect(client.push(ConnectorChannelId('chat-1'), { text: 'hi' }))
      .rejects.toMatchObject({ message: containing('non-JSON body') })

    fetchMock.mockResolvedValueOnce(Response.json(['unexpected']))
    await expect(client.push(ConnectorChannelId('chat-1'), { text: 'hi' }))
      .rejects.toMatchObject({ message: containing('unexpected body') })
  })

  it('renders a title above the text and forwards cancellation into the requests', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(tokenResponse('t-1', 7200)).mockResolvedValueOnce(sendResponse())
    const client = createFeishuClient(fakeContext().ctx, { ...OPTIONS })

    const controller = new AbortController()
    await client.push(ConnectorChannelId('chat-1'), { title: 'Report', text: 'Done' }, controller.signal)

    expect(JSON.parse(fetchMock.mock.calls[1]![1]?.body as string)).toMatchObject({
      content: JSON.stringify({ text: 'Report\nDone' }),
    })
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(false)
    controller.abort()
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true)
    expect(fetchMock.mock.calls[1]![1]?.signal?.aborted).toBe(true)
  })

  it('renders action-bearing messages as an interactive card with per-button action ids', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(tokenResponse('t-1', 7200)).mockResolvedValueOnce(sendResponse())
    const client = createFeishuClient(fakeContext().ctx, { ...OPTIONS })

    await client.push(ConnectorChannelId('chat-1'), {
      title: 'Approval',
      text: 'shell requests approval',
      actions: [
        { id: 'dsh-approval:a:allowed-once', label: 'Approve', style: 'primary' },
        { id: 'dsh-approval:a:rejected', label: 'Reject', style: 'danger' },
      ],
    })

    const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string) as { msg_type: string; content: string }
    expect(body.msg_type).toBe('interactive')
    const card = JSON.parse(body.content) as {
      header: { title: { content: string } }
      elements: [{ text: { content: string } }, { actions: unknown[] }]
    }
    expect(card.header.title).toEqual({ tag: 'plain_text', content: 'Approval' })
    expect(card.elements[0]).toEqual({ tag: 'div', text: { tag: 'lark_md', content: 'shell requests approval' } })
    expect(card.elements[1].actions).toEqual([
      { tag: 'button', text: { tag: 'plain_text', content: 'Approve' }, type: 'primary', value: { actionId: 'dsh-approval:a:allowed-once' } },
      { tag: 'button', text: { tag: 'plain_text', content: 'Reject' }, type: 'danger', value: { actionId: 'dsh-approval:a:rejected' } },
    ])
  })

  it('wraps a transport failure with its cause', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockRejectedValueOnce(new Error('socket reset'))
    const client = createFeishuClient(fakeContext().ctx, { ...OPTIONS })

    await expect(client.push(ConnectorChannelId('chat-1'), { text: 'hi' })).rejects.toMatchObject({
      code: 'FEISHU_DELIVERY_FAILED',
      message: containing('request failed'),
      cause: objectWith({ message: 'socket reset' }),
    })
  })
})

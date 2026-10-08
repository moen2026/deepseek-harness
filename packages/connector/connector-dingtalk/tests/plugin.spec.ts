import { createHmac } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { ConnectorChannelId, type ConnectorOutboundMessage } from '@deepseek-ai/dsh-connector'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
})

/** The provider object the plugin registers on `ctx.connector`. */
interface FakeProvider {
  readonly id: string
  push(channel: ConnectorChannelId, message: ConnectorOutboundMessage, signal?: AbortSignal): void | Promise<void>
}

/** The route object the plugin registers on `ctx.webServer`. */
interface FakeRoute {
  readonly kind: string
  readonly path: string
  handler(request: IncomingMessage, response: ServerResponse): void | Promise<void>
}

/** Context with only the services direct apply reads. */
function harness(): {
  ctx: Context
  register: ReturnType<typeof vi.fn<(route: FakeRoute) => () => void>>
  registerProvider: ReturnType<typeof vi.fn<(provider: FakeProvider) => () => void>>
  remove: ReturnType<typeof vi.fn>
  removeProvider: ReturnType<typeof vi.fn>
} {
  const ctx = new Context()
  contexts.push(ctx)
  const remove = vi.fn()
  const removeProvider = vi.fn()
  const register = vi.fn<(route: FakeRoute) => () => void>(() => remove)
  const registerProvider = vi.fn<(provider: FakeProvider) => () => void>(() => removeProvider)
  ctx.provide('webServer', { register } as never)
  ctx.provide('connector', { registerProvider, deliver: async () => 'queued' } as never)
  ctx.provide('credentials', { resolve: async () => ({ value: 'fixture-secret', source: 'environment' }) } as never)
  return { ctx, register, registerProvider, remove, removeProvider }
}

const valid = {
  path: '/dingtalk',
  appSecretEnv: 'DSH_DINGTALK_APP_SECRET',
  maxBodyBytes: 1024,
} satisfies Config

describe('DingTalk connector plugin config', () => {
  it('registers one exact route and one provider, removed with the plugin fiber', async () => {
    const test = harness()
    apply(test.ctx, { ...valid, timeoutMs: 5_000 })
    expect(test.register).toHaveBeenCalledWith(expect.objectContaining({ kind: 'exact', path: '/dingtalk' }))
    expect(test.registerProvider).toHaveBeenCalledWith(expect.objectContaining({ id: 'dingtalk' }))
    await test.ctx.fiber.dispose()
    expect(test.remove).toHaveBeenCalledOnce()
    expect(test.removeProvider).toHaveBeenCalledOnce()
  })

  it('shares the remembered session webhook between the route and the provider', async () => {
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(Response.json({ errcode: 0 }))
    const test = harness()
    apply(test.ctx, valid)
    const route = test.register.mock.calls[0]![0]
    const timestamp = String(Date.now())
    const sign = createHmac('sha256', 'fixture-secret').update(`${timestamp}\nfixture-secret`).digest('base64')
    const body = JSON.stringify({
      msgtype: 'text',
      text: { content: 'hello' },
      msgId: 'm-1',
      conversationId: 'conv-1',
      senderStaffId: 'staff-1',
      sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=x',
      sessionWebhookExpiredTime: Date.now() + 3_600_000,
    })
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      headersDistinct: { timestamp: [timestamp], sign: [sign] },
      complete: true,
      async * [Symbol.asyncIterator]() { yield Buffer.from(body) },
    } as unknown as IncomingMessage
    const response = { setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() } as unknown as ServerResponse
    await route.handler(request, response)

    const provider = test.registerProvider.mock.calls[0]![0]
    await provider.push(ConnectorChannelId('conv-1'), { text: 'ping' })

    expect(fetchMock.mock.calls[0]![0]).toBe('https://oapi.dingtalk.com/robot/sendBySession?session=x')
    expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string))
      .toEqual({ msgtype: 'text', text: { content: 'ping' } })
  })

  it('rejects a push to a conversation that never spoke, before any request', async () => {
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetchMock)
    const test = harness()
    apply(test.ctx, valid)
    const provider = test.registerProvider.mock.calls[0]![0]
    await expect(provider.push(ConnectorChannelId('conv-1'), { text: 'hi' }))
      .rejects.toMatchObject({ code: 'DINGTALK_SESSION_UNAVAILABLE' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [{ ...valid, path: 'dingtalk' }, /path/],
    [{ ...valid, path: '/' }, /path/],
    [{ ...valid, path: '/dingtalk/' }, /path/],
    [{ ...valid, path: '/dingtalk?x=1' }, /path/],
    [{ ...valid, path: '/dingtalk#x' }, /path/],
    [{ ...valid, appSecretEnv: 'not valid' }, /credential ref/],
  ] as const)('rejects invalid config %# before registration', (config, message) => {
    const test = harness()
    expect(() => { apply(test.ctx, config) }).toThrow(message)
    expect(test.register).not.toHaveBeenCalled()
    expect(test.registerProvider).not.toHaveBeenCalled()
  })
})

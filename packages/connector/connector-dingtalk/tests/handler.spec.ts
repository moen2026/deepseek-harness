import { createHmac } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { ConnectorChannelId, type ConnectorOutboundMessage } from '@deepseek-ai/dsh-connector'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DingtalkClient } from '../src/client.ts'
import { createDingtalkCallbackHandler } from '../src/handler.ts'

const APP_SECRET_REF = credentialRef('DSH_DINGTALK_APP_SECRET')
const SECRET = 'app-secret'
const WEBHOOK_URL = 'https://oapi.dingtalk.com/robot/sendBySession?session=x'
const EXPIRES_AT = 1_700_003_600_000

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => { resolve() }))))
})

/** Mutable credential map plus delivery and diagnostic observation. */
function fakeContext(secrets: Record<string, string> = { DSH_DINGTALK_APP_SECRET: SECRET }): {
  ctx: Context
  deliver: ReturnType<typeof vi.fn>
  warnings: ReturnType<typeof vi.fn>
} {
  const values = new Map(Object.entries(secrets))
  const deliver = vi.fn(async () => 'queued')
  const warnings = vi.fn()
  return {
    ctx: {
      credentials: {
        resolve: async (ref: string) => {
          const value = values.get(ref)
          return value === undefined ? undefined : { value, source: 'environment' }
        },
      },
      connector: { deliver },
      logger: { warn: warnings },
    } as unknown as Context,
    deliver,
    warnings,
  }
}

/** Typed mock signatures for the stub outbound client. */
type RememberFn = (channel: ConnectorChannelId, url: string, expiresAt: number) => void
type PushFn = (channel: ConnectorChannelId, message: ConnectorOutboundMessage, signal?: AbortSignal) => Promise<void>

/** The stub outbound client the handler registers sessions on. */
function fakeClient(): {
  client: DingtalkClient
  remember: ReturnType<typeof vi.fn<RememberFn>>
} {
  const remember = vi.fn<RememberFn>()
  const push = vi.fn<PushFn>(async () => {})
  return { client: { remember, push }, remember }
}

/** Start a real Node server around the package-owned route handler. */
async function serve(
  ctx: Context,
  options: { maxBodyBytes?: number } = {},
): Promise<{
  base: string
  remember: ReturnType<typeof vi.fn<RememberFn>>
}> {
  const fake = fakeClient()
  const handler = createDingtalkCallbackHandler(ctx, fake.client, {
    appSecretRef: APP_SECRET_REF,
    maxBodyBytes: options.maxBodyBytes ?? 65536,
  })
  const server = createServer((request, response) => { void handler(request, response) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { base: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, remember: fake.remember }
}

/** Independent recompute of the documented signing string. */
function signOf(timestamp: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64')
}

/** Send one request whose timestamp and signature are consistent by default. */
async function post(
  base: string,
  body: string | Uint8Array<ArrayBuffer>,
  headers: Record<string, string> = {},
): Promise<Response> {
  const timestamp = headers.timestamp ?? String(Date.now())
  return await fetch(base, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
      timestamp,
      sign: headers.sign ?? signOf(timestamp),
    },
    body,
  })
}

/** One text callback payload with per-test field overrides. */
function textPayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    msgtype: 'text',
    text: { content: 'hello' },
    msgId: 'm-1',
    conversationId: 'conv-1',
    senderStaffId: 'staff-1',
    sessionWebhook: WEBHOOK_URL,
    sessionWebhookExpiredTime: EXPIRES_AT,
    ...overrides,
  }
}

describe('DingTalk callback HTTP handler', () => {
  it('admits a signed text message and remembers its session webhook', async () => {
    const fake = fakeContext()
    const server = await serve(fake.ctx)
    const response = await post(server.base, JSON.stringify(textPayload()), {
      'content-type': 'application/json; charset=utf-8',
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(fake.deliver).toHaveBeenCalledWith({
      provider: 'dingtalk',
      channel: 'conv-1',
      messageId: 'm-1',
      sender: 'staff-1',
      text: 'hello',
    })
    expect(server.remember).toHaveBeenCalledWith('conv-1', WEBHOOK_URL, EXPIRES_AT)
  })

  it('acknowledges callbacks the connector does not consume', async () => {
    const fake = fakeContext()
    const server = await serve(fake.ctx)
    const response = await post(server.base, JSON.stringify(textPayload({ msgtype: 'picture' })))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(fake.deliver).not.toHaveBeenCalled()
    expect(server.remember).not.toHaveBeenCalled()
  })

  it('rejects a stale timestamp or a mismatching signature', async () => {
    const fake = fakeContext()
    const server = await serve(fake.ctx)
    const stale = String(Date.now() - 3_600_001)
    const expired = await post(server.base, JSON.stringify(textPayload()), { timestamp: stale })
    expect(expired.status).toBe(401)
    expect(await expired.text()).toBe('stale request timestamp')
    const wrong = await post(server.base, JSON.stringify(textPayload()), { sign: signOf('1', 'other-secret') })
    expect(wrong.status).toBe(401)
    expect(await wrong.text()).toBe('invalid webhook signature')
    expect(fake.deliver).not.toHaveBeenCalled()
  })

  it('rejects missing, empty, or duplicate signature headers', async () => {
    const fake = fakeContext()
    const server = await serve(fake.ctx)
    const body = JSON.stringify(textPayload())

    const missing = await fetch(server.base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    expect(missing.status).toBe(401)

    const empty = await post(server.base, body, { sign: ' ' })
    expect(empty.status).toBe(401)

    const handler = createDingtalkCallbackHandler(fake.ctx, fakeClient().client, {
      appSecretRef: APP_SECRET_REF,
      maxBodyBytes: 1024,
    })
    const writeHead = vi.fn()
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      headersDistinct: { timestamp: [String(Date.now())], sign: ['a', 'b'] },
      complete: true,
      async * [Symbol.asyncIterator]() { yield Buffer.from(body) },
    } as unknown as IncomingMessage
    const response = { setHeader: vi.fn(), writeHead, end: vi.fn() } as unknown as ServerResponse
    await handler(request, response)
    expect(writeHead).toHaveBeenCalledWith(401, expect.any(Object))
  })

  it('rejects a non-POST method or a non-JSON media type', async () => {
    const fake = fakeContext()
    const server = await serve(fake.ctx)
    const method = await fetch(server.base, { method: 'GET' })
    expect(method.status).toBe(405)
    expect(method.headers.get('allow')).toBe('POST')
    const media = await fetch(server.base, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })
    expect(media.status).toBe(415)
    const absent = await fetch(server.base, { method: 'POST', body: new Uint8Array() })
    expect(absent.status).toBe(415)
  })

  it.each([
    ['not JSON', '{', 'request body is not valid JSON'],
    ['array', '[]', 'DingTalk callback payload must be a JSON object'],
    ['null', 'null', 'DingTalk callback payload must be a JSON object'],
    ['scalar', '"text"', 'DingTalk callback payload must be a JSON object'],
  ] as const)('rejects a %s body', async (_label, body, message) => {
    const fake = fakeContext()
    const server = await serve(fake.ctx)
    const response = await post(server.base, body)
    expect(response.status).toBe(400)
    expect(await response.text()).toBe(message)
    expect(fake.deliver).not.toHaveBeenCalled()
  })

  it('rejects a body that is not UTF-8', async () => {
    const fake = fakeContext()
    const server = await serve(fake.ctx)
    const response = await post(server.base, new Uint8Array([0xff, 0xfe]))
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('request body is not valid UTF-8')
  })

  it('rejects a structurally invalid message', async () => {
    const fake = fakeContext()
    const server = await serve(fake.ctx)
    const response = await post(server.base, JSON.stringify(textPayload({ conversationId: '' })))
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('DingTalk callback conversationId must be a non-empty string')
    expect(server.remember).not.toHaveBeenCalled()
  })

  it('rejects a body over the configured cap', async () => {
    const fake = fakeContext()
    const server = await serve(fake.ctx, { maxBodyBytes: 2 })
    const response = await post(server.base, '{} ')
    expect(response.status).toBe(413)
    expect(await response.text()).toBe('request body is too large')
  })

  it('refuses while the app secret credential is unavailable', async () => {
    const missing = fakeContext({})
    const missingServer = await serve(missing.ctx)
    const first = await post(missingServer.base, JSON.stringify(textPayload()))
    expect(first.status).toBe(503)
    expect(await first.text()).toBe('DingTalk app secret is unavailable')

    const empty = fakeContext({ DSH_DINGTALK_APP_SECRET: '' })
    const emptyServer = await serve(empty.ctx)
    const second = await post(emptyServer.base, JSON.stringify(textPayload()))
    expect(second.status).toBe(503)
  })

  it('maps an undeliverable message and a connector outage to distinct refusals', async () => {
    const fake = fakeContext()
    const server = await serve(fake.ctx)
    fake.deliver.mockRejectedValueOnce(new TypeError('connector rejected the message'))
    const undeliverable = await post(server.base, JSON.stringify(textPayload()))
    expect(undeliverable.status).toBe(400)
    expect(await undeliverable.text()).toBe('DingTalk message is not deliverable')
    fake.deliver.mockRejectedValueOnce(new Error('connector is shutting down'))
    const outage = await post(server.base, JSON.stringify(textPayload()))
    expect(outage.status).toBe(503)
    expect(await outage.text()).toBe('connector delivery is unavailable')
  })

  it('answers 503 and never logs request data for an unexpected failure', async () => {
    const fake = fakeContext()
    ;(fake.ctx.credentials.resolve as ReturnType<typeof vi.fn> | undefined) = vi.fn(async () => {
      throw new Error('credential store unavailable')
    }) as never
    const server = await serve(fake.ctx)
    const response = await post(server.base, JSON.stringify(textPayload()))
    expect(response.status).toBe(503)
    expect(await response.text()).toBe('connector-dingtalk ingress is unavailable')
    expect(fake.warnings).toHaveBeenCalledWith('connector-dingtalk: request failed')
    const diagnostics = JSON.stringify(fake.warnings.mock.calls)
    expect(diagnostics).not.toContain(SECRET)
    expect(diagnostics).not.toContain('hello')
  })
})

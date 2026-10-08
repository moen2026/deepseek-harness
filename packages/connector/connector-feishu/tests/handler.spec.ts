import { createCipheriv, createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFeishuCallbackHandler } from '../src/handler.ts'

const VERIFICATION_TOKEN_REF = credentialRef('DSH_FEISHU_VERIFICATION_TOKEN')
const ENCRYPT_KEY_REF = credentialRef('DSH_FEISHU_ENCRYPT_KEY')

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => { resolve() }))))
})

/** Mutable credential map plus delivery and diagnostic observation. */
function fakeContext(secrets: Record<string, string> = {
  DSH_FEISHU_VERIFICATION_TOKEN: 'vt-1',
  DSH_FEISHU_ENCRYPT_KEY: 'ek-1',
}): {
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

/** Start a real Node server around the package-owned route handler. */
async function serve(
  ctx: Context,
  options: { encryptKey?: boolean; maxBodyBytes?: number } = {},
): Promise<string> {
  const handler = createFeishuCallbackHandler(ctx, {
    verificationTokenRef: VERIFICATION_TOKEN_REF,
    ...options.encryptKey === false ? {} : { encryptKeyRef: ENCRYPT_KEY_REF },
    maxBodyBytes: options.maxBodyBytes ?? 65536,
  })
  const server = createServer((request, response) => { void handler(request, response) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
}

/** Mirror of Feishu's documented envelope: SHA-256 key, IV prefix, AES-256-CBC, base64. */
function encryptEnvelope(payload: unknown, encryptKey: string): string {
  const key = createHash('sha256').update(encryptKey).digest()
  const iv = Buffer.alloc(16, 7)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  return Buffer.concat([iv, cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')), cipher.final()]).toString('base64')
}

/** Independent recompute of the documented signature concatenation. */
function signatureOf(timestamp: string, nonce: string, encryptKey: string, rawBody: string): string {
  return createHash('sha256')
    .update(timestamp + nonce + encryptKey)
    .update(rawBody)
    .digest('hex')
}

/** Send one JSON request with optional extra headers. */
async function post(base: string, body: string | Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}): Promise<Response> {
  return await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body })
}

/** Send one encrypted callback whose signature covers the exact bytes sent. */
async function postEncrypted(
  base: string,
  payload: unknown,
  overrides: { envelopeKey?: string; signature?: string } = {},
): Promise<Response> {
  const timestamp = '1700000000'
  const nonce = 'n-1'
  const body = JSON.stringify({ encrypt: encryptEnvelope(payload, overrides.envelopeKey ?? 'ek-1') })
  return await post(base, body, {
    'x-lark-request-timestamp': timestamp,
    'x-lark-request-nonce': nonce,
    'x-lark-signature': overrides.signature ?? signatureOf(timestamp, nonce, 'ek-1', body),
  })
}

/** One v2 text-message payload with per-test field overrides. */
function messagePayload(
  message: Record<string, unknown> = {},
  sender: Record<string, unknown> = { sender_id: { open_id: 'ou-1' } },
  token = 'vt-1',
): unknown {
  return {
    header: { event_type: 'im.message.receive_v1', token },
    event: {
      sender,
      message: {
        message_id: 'm-1',
        chat_id: 'chat-1',
        message_type: 'text',
        content: '{"text":"hello"}',
        ...message,
      },
    },
  }
}

const CHALLENGE = { type: 'url_verification', challenge: 'c-1', token: 'vt-1' }

describe('Feishu callback HTTP handler', () => {
  it('answers the URL-verification challenge for plaintext and encrypted callbacks', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx)
    const plain = await post(base, JSON.stringify(CHALLENGE))
    expect(plain.status).toBe(200)
    expect(await plain.json()).toEqual({ challenge: 'c-1' })
    const encrypted = await postEncrypted(base, CHALLENGE)
    expect(encrypted.status).toBe(200)
    expect(await encrypted.json()).toEqual({ challenge: 'c-1' })
    expect(fake.deliver).not.toHaveBeenCalled()
  })

  it('admits a plaintext text message through the connector', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx)
    const response = await post(base, JSON.stringify(messagePayload()))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ code: 0 })
    expect(fake.deliver).toHaveBeenCalledWith({
      provider: 'feishu',
      channel: 'chat-1',
      messageId: 'm-1',
      sender: 'ou-1',
      text: 'hello',
    })
  })

  it('admits an encrypted text message through the connector', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx)
    const response = await postEncrypted(base, messagePayload())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ code: 0 })
    expect(fake.deliver).toHaveBeenCalledOnce()
  })

  it('acknowledges events the connector does not consume', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx)
    const response = await post(base, JSON.stringify({ header: { event_type: 'im.chat.updated', token: 'vt-1' } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ code: 0 })
    expect(fake.deliver).not.toHaveBeenCalled()
  })

  it('rejects an encrypted callback whose signature does not verify', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx)
    const response = await postEncrypted(base, messagePayload(), { signature: 'not-the-signature' })
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('invalid webhook signature')
    expect(fake.deliver).not.toHaveBeenCalled()
  })

  it('rejects an encrypted callback with missing, empty, or duplicate signature headers', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx)
    const body = JSON.stringify({ encrypt: encryptEnvelope(messagePayload(), 'ek-1') })

    const missing = await post(base, body)
    expect(missing.status).toBe(400)
    expect(await missing.text()).toBe('missing x-lark-request-timestamp header')

    const empty = await post(base, body, {
      'x-lark-request-timestamp': '1700000000',
      'x-lark-request-nonce': 'n-1',
      'x-lark-signature': ' ',
    })
    expect(empty.status).toBe(400)
    expect(await empty.text()).toBe('missing x-lark-signature header')

    const handler = createFeishuCallbackHandler(fake.ctx, {
      verificationTokenRef: VERIFICATION_TOKEN_REF,
      encryptKeyRef: ENCRYPT_KEY_REF,
      maxBodyBytes: 1024,
    })
    const writeHead = vi.fn()
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      headersDistinct: {
        'x-lark-request-timestamp': ['1700000000'],
        'x-lark-request-nonce': ['n-1'],
        'x-lark-signature': ['a', 'b'],
      },
      complete: true,
      async * [Symbol.asyncIterator]() { yield Buffer.from(body) },
    } as unknown as IncomingMessage
    const response = { setHeader: vi.fn(), writeHead, end: vi.fn() } as unknown as ServerResponse
    await handler(request, response)
    expect(writeHead).toHaveBeenCalledWith(400, expect.any(Object))
  })

  it('rejects an encrypted callback when no encrypt key is configured', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx, { encryptKey: false })
    const response = await postEncrypted(base, messagePayload())
    expect(response.status).toBe(503)
    expect(await response.text()).toBe('Feishu callback is encrypted but no encrypt key is configured')
  })

  it('rejects an encrypted callback when the encrypt key credential is unavailable', async () => {
    const fake = fakeContext({ DSH_FEISHU_VERIFICATION_TOKEN: 'vt-1' })
    const base = await serve(fake.ctx)
    const response = await postEncrypted(base, messagePayload())
    expect(response.status).toBe(503)
    expect(await response.text()).toBe('Feishu encrypt key is unavailable')
  })

  it('rejects an encrypted callback whose envelope cannot be decrypted', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx)
    const response = await postEncrypted(base, messagePayload(), { envelopeKey: 'ek-other' })
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('encrypted payload could not be decrypted')
    expect(fake.deliver).not.toHaveBeenCalled()
  })

  it('rejects a mismatched or missing verification token', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx)
    const mismatched = await post(base, JSON.stringify(messagePayload({}, { sender_id: { open_id: 'ou-1' } }, 'vt-2')))
    expect(mismatched.status).toBe(401)
    expect(await mismatched.text()).toBe('invalid verification token')
    const missing = await post(base, JSON.stringify({ header: { event_type: 'im.message.receive_v1' } }))
    expect(missing.status).toBe(401)
    expect(fake.deliver).not.toHaveBeenCalled()
  })

  it('refuses while the verification token credential is unavailable', async () => {
    const missing = fakeContext({})
    const missingBase = await serve(missing.ctx)
    const first = await post(missingBase, JSON.stringify(messagePayload()))
    expect(first.status).toBe(503)
    expect(await first.text()).toBe('Feishu verification token is unavailable')

    const empty = fakeContext({ DSH_FEISHU_VERIFICATION_TOKEN: '' })
    const emptyBase = await serve(empty.ctx)
    const second = await post(emptyBase, JSON.stringify(messagePayload()))
    expect(second.status).toBe(503)
  })

  it('rejects a non-POST method or a non-JSON media type', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx)
    const method = await fetch(base, { method: 'GET' })
    expect(method.status).toBe(405)
    expect(method.headers.get('allow')).toBe('POST')
    const media = await fetch(base, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })
    expect(media.status).toBe(415)
    const absent = await fetch(base, { method: 'POST', body: new Uint8Array() })
    expect(absent.status).toBe(415)
  })

  it.each([
    ['not JSON', '{', 'request body is not valid JSON'],
    ['array', '[]', 'Feishu callback payload must be a JSON object'],
    ['null', 'null', 'Feishu callback payload must be a JSON object'],
    ['scalar', '"text"', 'Feishu callback payload must be a JSON object'],
  ] as const)('rejects a %s body', async (_label, body, message) => {
    const fake = fakeContext()
    const base = await serve(fake.ctx)
    const response = await post(base, body)
    expect(response.status).toBe(400)
    expect(await response.text()).toBe(message)
    expect(fake.deliver).not.toHaveBeenCalled()
  })

  it('rejects a body that is not UTF-8', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx)
    const response = await post(base, new Uint8Array([0xff, 0xfe]))
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('request body is not valid UTF-8')
  })

  it('rejects a structurally invalid message', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx)
    const response = await post(base, JSON.stringify(messagePayload({ chat_id: '' })))
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Feishu callback message.chat_id must be a non-empty string')
  })

  it('rejects a body over the configured cap', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx, { maxBodyBytes: 2 })
    const response = await post(base, '{} ')
    expect(response.status).toBe(413)
    expect(await response.text()).toBe('request body is too large')
  })

  it('maps an undeliverable message and a connector outage to distinct refusals', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx)
    fake.deliver.mockRejectedValueOnce(new TypeError('connector rejected the message'))
    const undeliverable = await post(base, JSON.stringify(messagePayload()))
    expect(undeliverable.status).toBe(400)
    expect(await undeliverable.text()).toBe('Feishu message is not deliverable')
    fake.deliver.mockRejectedValueOnce(new Error('connector is shutting down'))
    const outage = await post(base, JSON.stringify(messagePayload()))
    expect(outage.status).toBe(503)
    expect(await outage.text()).toBe('connector delivery is unavailable')
  })

  it('answers 503 and never logs request data for an unexpected failure', async () => {
    const fake = fakeContext()
    ;(fake.ctx.credentials.resolve as ReturnType<typeof vi.fn> | undefined) = vi.fn(async () => {
      throw new Error('credential store unavailable')
    }) as never
    const base = await serve(fake.ctx)
    const response = await post(base, JSON.stringify(messagePayload()))
    expect(response.status).toBe(503)
    expect(await response.text()).toBe('connector-feishu ingress is unavailable')
    expect(fake.warnings).toHaveBeenCalledWith('connector-feishu: request failed')
    const diagnostics = JSON.stringify(fake.warnings.mock.calls)
    expect(diagnostics).not.toContain('vt-1')
    expect(diagnostics).not.toContain('hello')
  })
})

import { createHmac } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSlackCallbackHandler } from '../src/handler.ts'

const SIGNING_SECRET_REF = credentialRef('DSH_SLACK_SIGNING_SECRET')

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => { resolve() }))))
})

/** Credential map plus delivery and diagnostic observation. */
function fakeContext(secret = 'fixture-signing-secret'): {
  ctx: Context
  deliver: ReturnType<typeof vi.fn>
  warnings: ReturnType<typeof vi.fn>
} {
  const deliver = vi.fn(async () => 'queued')
  const warnings = vi.fn()
  return {
    ctx: {
      credentials: {
        resolve: async (ref: string) => ref === SIGNING_SECRET_REF && secret !== ''
          ? { value: secret, source: 'environment' }
          : undefined,
      },
      connector: { deliver },
      logger: { warn: warnings },
    } as unknown as Context,
    deliver,
    warnings,
  }
}

/** Start a real Node server around the package-owned route handler. */
async function serve(ctx: Context, maxBodyBytes = 65536): Promise<string> {
  const handler = createSlackCallbackHandler(ctx, { signingSecretRef: SIGNING_SECRET_REF, maxBodyBytes })
  const server = createServer((request, response) => { void handler(request, response) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
}

/** Sign one body exactly as Slack does. */
function signedHeaders(body: string, secret: string, timestamp = String(Math.floor(Date.now() / 1000))): Record<string, string> {
  return {
    'x-slack-request-timestamp': timestamp,
    'x-slack-signature': `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:`).update(body).digest('hex')}`,
  }
}

/** Send one signed request; pass headers to override or omit them. */
async function post(base: string, body: string, headers?: Record<string, string>): Promise<Response> {
  return await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers ?? signedHeaders(body, 'fixture-signing-secret')) },
    body,
  })
}

describe('createSlackCallbackHandler', () => {
  it('answers the URL-verification challenge after signature verification', async () => {
    const test = fakeContext()
    const base = await serve(test.ctx)
    const body = JSON.stringify({ type: 'url_verification', challenge: 'ch-1' })
    const response = await post(base, body)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ challenge: 'ch-1' })
    expect(test.deliver).not.toHaveBeenCalled()
  })

  it('admits a message event after signature verification', async () => {
    const test = fakeContext()
    const base = await serve(test.ctx)
    const body = JSON.stringify({
      type: 'event_callback',
      event_id: 'Ev-1',
      event: { type: 'message', channel: 'C1', user: 'U1', text: 'hello' },
    })
    const response = await post(base, body)
    expect(response.status).toBe(200)
    expect(test.deliver).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'slack',
      channel: 'C1',
      messageId: 'Ev-1',
      sender: 'U1',
      text: 'hello',
    }))
  })

  it('admits an urlencoded interactive click', async () => {
    const test = fakeContext()
    const base = await serve(test.ctx)
    const payload = {
      type: 'block_actions',
      channel: { id: 'C1' },
      user: { id: 'U1' },
      message: { ts: '1.2' },
      actions: [{ action_id: 'a1', value: 'a1' }],
    }
    const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`
    const response = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...signedHeaders(body, 'fixture-signing-secret') },
      body,
    })
    expect(response.status).toBe(200)
    expect(test.deliver).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'C1',
      sender: 'U1',
      resolution: { actionId: 'a1', value: 'a1' },
    }))
  })

  it('acknowledges ignored events without delivery', async () => {
    const test = fakeContext()
    const base = await serve(test.ctx)
    const body = JSON.stringify({ type: 'event_callback', event_id: 'Ev-8', event: { type: 'reaction_added' } })
    const response = await post(base, body)
    expect(response.status).toBe(200)
    expect(test.deliver).not.toHaveBeenCalled()
  })

  it('refuses a wrong signature with 401 without touching the connector', async () => {
    const test = fakeContext()
    const base = await serve(test.ctx)
    const body = JSON.stringify({ type: 'url_verification', challenge: 'ch-1' })
    const response = await post(base, body, signedHeaders(body, 'another-secret'))
    expect(response.status).toBe(401)
    expect(test.deliver).not.toHaveBeenCalled()
  })

  it('refuses a stale timestamp with 401', async () => {
    const test = fakeContext()
    const base = await serve(test.ctx)
    const body = JSON.stringify({ type: 'url_verification', challenge: 'ch-1' })
    const stale = String(Math.floor(Date.now() / 1000) - 600)
    const response = await post(base, body, signedHeaders(body, 'fixture-signing-secret', stale))
    expect(response.status).toBe(401)
  })

  it('refuses a structurally invalid message with 400', async () => {
    const test = fakeContext()
    const base = await serve(test.ctx)
    const body = JSON.stringify({ type: 'event_callback', event: { type: 'message', channel: 'C1', user: 'U1', text: 'hi' } })
    const response = await post(base, body)
    expect(response.status).toBe(400)
  })

  it('maps delivery TypeErrors to 400 and other delivery failures to 503', async () => {
    const typeError = fakeContext()
    typeError.deliver.mockRejectedValueOnce(new TypeError('bad field'))
    const typeBase = await serve(typeError.ctx)
    const body = JSON.stringify({ type: 'event_callback', event_id: 'Ev-1', event: { type: 'message', channel: 'C1', user: 'U1', text: 'hi' } })
    expect((await post(typeBase, body)).status).toBe(400)

    const failing = fakeContext()
    failing.deliver.mockRejectedValueOnce(new Error('outbox unavailable'))
    const failingBase = await serve(failing.ctx)
    expect((await post(failingBase, body)).status).toBe(503)
  })

  it('refuses an unavailable signing secret with 503', async () => {
    const test = fakeContext('')
    const base = await serve(test.ctx)
    const response = await post(base, '{}', { 'content-type': 'application/json' })
    expect(response.status).toBe(503)
  })

  it('refuses oversized bodies with 413 and wrong media types with 415', async () => {
    const test = fakeContext()
    const base = await serve(test.ctx, 16)
    const response = await post(base, JSON.stringify({ type: 'url_verification', challenge: 'c'.repeat(64) }))
    expect(response.status).toBe(413)

    const media = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', ...signedHeaders('x', 'fixture-signing-secret') },
      body: 'x',
    })
    expect(media.status).toBe(415)
  })

  it('answers 405 for non-POST methods and 503 with a warning for unexpected failures', async () => {
    const test = fakeContext()
    const base = await serve(test.ctx)
    expect((await fetch(base, { method: 'GET' })).status).toBe(405)

    const parse = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...signedHeaders('not json', 'fixture-signing-secret') },
      body: 'not json',
    })
    expect(parse.status).toBe(400)

    const failing = fakeContext()
    failing.ctx.credentials = undefined as never
    const failingBase = await serve(failing.ctx)
    const response = await post(failingBase, '{}', { 'content-type': 'application/json' })
    expect(response.status).toBe(503)
    expect(failing.warnings).toHaveBeenCalled()
  })
})

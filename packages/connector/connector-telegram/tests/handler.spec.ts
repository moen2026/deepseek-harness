import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TelegramClient } from '../src/client.ts'
import { createTelegramCallbackHandler } from '../src/handler.ts'

const BOT_TOKEN_REF = credentialRef('DSH_TELEGRAM_BOT_TOKEN')
const WEBHOOK_SECRET_REF = credentialRef('DSH_TELEGRAM_WEBHOOK_SECRET')
const FIXTURE_SECRET_TOKEN = 'fixture-secret-token'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => { resolve() }))))
})

/** Credential map plus delivery, callback-answer, and diagnostic observation. */
function fakeContext(secret = FIXTURE_SECRET_TOKEN): {
  ctx: Context
  deliver: ReturnType<typeof vi.fn>
  warnings: ReturnType<typeof vi.fn>
} {
  const deliver = vi.fn(async () => 'queued')
  const warnings = vi.fn()
  return {
    ctx: {
      credentials: {
        resolve: async (ref: string) => {
          if (ref === BOT_TOKEN_REF) return { value: 'fixture-bot-token', source: 'environment' }
          if (ref === WEBHOOK_SECRET_REF && secret !== '') return { value: secret, source: 'environment' }
          return undefined
        },
      },
      connector: { deliver },
      logger: { warn: warnings },
    } as unknown as Context,
    deliver,
    warnings,
  }
}

/** Callback-answer spy standing in for the outbound client. */
function fakeClient(answer: ReturnType<typeof vi.fn>): TelegramClient {
  return {
    push: async () => undefined,
    answerCallbackQuery: answer as TelegramClient['answerCallbackQuery'],
  }
}

/** Start a real Node server around the package-owned route handler. */
async function serve(
  ctx: Context,
  client: TelegramClient,
  options: { webhookSecret?: boolean; maxBodyBytes?: number } = {},
): Promise<string> {
  const handler = createTelegramCallbackHandler(ctx, client, {
    botTokenRef: BOT_TOKEN_REF,
    ...(options.webhookSecret === true ? { webhookSecretRef: WEBHOOK_SECRET_REF } : {}),
    maxBodyBytes: options.maxBodyBytes ?? 65536,
  })
  const server = createServer((request, response) => { void handler(request, response) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
}

/** Send one JSON request; pass headers to override or omit them. */
async function post(base: string, body: string, headers?: Record<string, string>): Promise<Response> {
  return await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    body,
  })
}

describe('createTelegramCallbackHandler', () => {
  it('admits a text message and answers with an empty 200', async () => {
    const test = fakeContext()
    const answer = vi.fn(async () => undefined)
    const base = await serve(test.ctx, fakeClient(answer))
    const response = await post(base, JSON.stringify({
      update_id: 41,
      message: { chat: { id: 700 }, from: { id: 800 }, text: 'hello' },
    }))
    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('')
    expect(test.deliver).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'telegram',
      channel: '700',
      messageId: '41',
      sender: '800',
      text: 'hello',
    }))
    expect(answer).not.toHaveBeenCalled()
  })

  it('admits a callback query, answers it, and delivers the resolution', async () => {
    const test = fakeContext()
    const answer = vi.fn(async () => undefined)
    const base = await serve(test.ctx, fakeClient(answer))
    const response = await post(base, JSON.stringify({
      update_id: 42,
      callback_query: {
        id: 'cq-1',
        from: { id: 800 },
        message: { chat: { id: 700 } },
        data: 'dsh-approval:1:allowed-once',
      },
    }))
    expect(response.status).toBe(200)
    expect(answer).toHaveBeenCalledWith('cq-1')
    expect(test.deliver).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'telegram',
      channel: '700',
      messageId: 'cq-1',
      sender: '800',
      resolution: { actionId: 'dsh-approval:1:allowed-once', value: '' },
    }))
  })

  it('keeps admitting the click when the callback answer fails', async () => {
    const test = fakeContext()
    const answer = vi.fn(async () => { throw new Error('telegram down') })
    const base = await serve(test.ctx, fakeClient(answer))
    const response = await post(base, JSON.stringify({
      update_id: 43,
      callback_query: { id: 'cq-2', from: { id: 800 }, message: { chat: { id: 700 } }, data: 'a1' },
    }))
    expect(response.status).toBe(200)
    expect(answer).toHaveBeenCalledWith('cq-2')
    expect(test.deliver).toHaveBeenCalled()
    expect(test.warnings).toHaveBeenCalled()
  })

  it('acknowledges ignored updates without delivery or answers', async () => {
    const test = fakeContext()
    const answer = vi.fn(async () => undefined)
    const base = await serve(test.ctx, fakeClient(answer))
    const response = await post(base, JSON.stringify({ update_id: 44, edited_message: { chat: { id: 700 } } }))
    expect(response.status).toBe(200)
    expect(test.deliver).not.toHaveBeenCalled()
    expect(answer).not.toHaveBeenCalled()
  })

  it('verifies the webhook secret token when configured', async () => {
    const test = fakeContext()
    const answer = vi.fn(async () => undefined)
    const base = await serve(test.ctx, fakeClient(answer), { webhookSecret: true })
    const body = JSON.stringify({ update_id: 45, message: { chat: { id: 700 }, from: { id: 800 }, text: 'hi' } })

    const missing = await post(base, body)
    expect(missing.status).toBe(400)

    const wrong = await post(base, body, { 'x-telegram-bot-api-secret-token': 'another-secret-token' })
    expect(wrong.status).toBe(401)
    expect(test.deliver).not.toHaveBeenCalled()

    const matched = await post(base, body, { 'x-telegram-bot-api-secret-token': FIXTURE_SECRET_TOKEN })
    expect(matched.status).toBe(200)
    expect(test.deliver).toHaveBeenCalled()
  })

  it('accepts every caller when no webhook secret is configured', async () => {
    const test = fakeContext()
    const answer = vi.fn(async () => undefined)
    const base = await serve(test.ctx, fakeClient(answer))
    const response = await post(base, JSON.stringify({
      update_id: 46,
      message: { chat: { id: 700 }, from: { id: 800 }, text: 'hi' },
    }))
    expect(response.status).toBe(200)
    expect(test.deliver).toHaveBeenCalled()
  })

  it('maps delivery TypeErrors to 400 and other delivery failures to 503', async () => {
    const body = JSON.stringify({ update_id: 47, message: { chat: { id: 700 }, from: { id: 800 }, text: 'hi' } })

    const typeError = fakeContext()
    typeError.deliver.mockRejectedValueOnce(new TypeError('bad field'))
    const answerA = vi.fn(async () => undefined)
    const typeBase = await serve(typeError.ctx, fakeClient(answerA))
    expect((await post(typeBase, body)).status).toBe(400)

    const failing = fakeContext()
    failing.deliver.mockRejectedValueOnce(new Error('outbox unavailable'))
    const answerB = vi.fn(async () => undefined)
    const failingBase = await serve(failing.ctx, fakeClient(answerB))
    expect((await post(failingBase, body)).status).toBe(503)
  })

  it('answers 405 for non-POST methods and 415 for wrong media types', async () => {
    const test = fakeContext()
    const answer = vi.fn(async () => undefined)
    const base = await serve(test.ctx, fakeClient(answer))
    expect((await fetch(base, { method: 'GET' })).status).toBe(405)

    const media = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'x',
    })
    expect(media.status).toBe(415)
  })

  it('refuses non-JSON bodies with 400 and oversized bodies with 413', async () => {
    const test = fakeContext()
    const answer = vi.fn(async () => undefined)
    const base = await serve(test.ctx, fakeClient(answer))
    expect((await post(base, 'not json')).status).toBe(400)

    const small = fakeContext()
    const smallBase = await serve(small.ctx, fakeClient(answer), { maxBodyBytes: 16 })
    expect((await post(smallBase, JSON.stringify({ update_id: 48, message: { chat: { id: 700 }, from: { id: 800 }, text: 'c'.repeat(64) } }))).status).toBe(413)
  })

  it('answers 503 with a warning for unexpected failures', async () => {
    const test = fakeContext()
    test.ctx.credentials = {
      resolve: async () => { throw new Error('credential registry is down') },
    } as never
    const answer = vi.fn(async () => undefined)
    const base = await serve(test.ctx, fakeClient(answer), { webhookSecret: true })
    const response = await post(base, '{}')
    expect(response.status).toBe(503)
    expect(test.warnings).toHaveBeenCalled()
  })
})

import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTelegramClient, inlineKeyboardOf } from '../src/client.ts'

const BOT_TOKEN_REF = credentialRef('DSH_TELEGRAM_BOT_TOKEN')

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Context with only the credential service the client reads. */
function fakeContext(values: Record<string, string> = { DSH_TELEGRAM_BOT_TOKEN: 'bot-token-1' }): never {
  const map = new Map(Object.entries(values))
  return {
    credentials: {
      resolve: async (ref: string) => {
        const value = map.get(ref)
        return value === undefined ? undefined : { value, source: 'environment' }
      },
    },
  } as never
}

describe('inlineKeyboardOf', () => {
  it('renders one button per action with the action id as callback data', () => {
    expect(inlineKeyboardOf({
      text: 'Run the tool?',
      actions: [
        { id: 'a1', label: 'Approve' },
        { id: 'a2', label: 'Reject' },
      ],
    })).toEqual({
      inline_keyboard: [[
        { text: 'Approve', callback_data: 'a1' },
        { text: 'Reject', callback_data: 'a2' },
      ]],
    })
  })
})

describe('createTelegramClient', () => {
  it('posts plain text to the token-scoped method URL', async () => {
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(Response.json({ ok: true, result: { message_id: 7 } }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createTelegramClient(fakeContext(), { apiBaseUrl: 'https://api.telegram.org', botTokenRef: BOT_TOKEN_REF, timeoutMs: 1000 })
    await client.push('-100200', { title: 'T', text: 'hello' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.telegram.org/botbot-token-1/sendMessage')
    expect(JSON.parse(init?.body as string)).toEqual({ chat_id: '-100200', text: 'T\nhello' })
  })

  it('posts an inline keyboard when the message carries actions', async () => {
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(Response.json({ ok: true, result: {} }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createTelegramClient(fakeContext(), { apiBaseUrl: 'https://api.telegram.org', botTokenRef: BOT_TOKEN_REF, timeoutMs: 1000 })
    await client.push('1', { text: 'hi', actions: [{ id: 'a1', label: 'Go' }] })
    const body = JSON.parse(fetchMock.mock.calls[0]![1]?.body as string) as { reply_markup: unknown }
    expect(body.reply_markup).toEqual({ inline_keyboard: [[{ text: 'Go', callback_data: 'a1' }]] })
  })

  it('answers callback queries', async () => {
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(Response.json({ ok: true, result: true }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createTelegramClient(fakeContext(), { apiBaseUrl: 'https://api.telegram.org', botTokenRef: BOT_TOKEN_REF, timeoutMs: 1000 })
    await client.answerCallbackQuery('cq-1')
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.telegram.org/botbot-token-1/answerCallbackQuery')
    expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toEqual({ callback_query_id: 'cq-1' })
  })

  it('refuses a token-less credential', async () => {
    const client = createTelegramClient(fakeContext({}), { apiBaseUrl: 'https://api.telegram.org', botTokenRef: BOT_TOKEN_REF, timeoutMs: 1000 })
    await expect(client.push('1', { text: 'hi' })).rejects.toThrow('token is unavailable')
  })

  it('maps transport, HTTP, and API failures onto TELEGRAM_DELIVERY_FAILED', async () => {
    const client = createTelegramClient(fakeContext(), { apiBaseUrl: 'https://api.telegram.org', botTokenRef: BOT_TOKEN_REF, timeoutMs: 1000 })
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetchMock)

    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await expect(client.push('1', { text: 'hi' })).rejects.toThrow('sendMessage request failed')

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))
    await expect(client.push('1', { text: 'hi' })).rejects.toThrow('responded 500')

    fetchMock.mockResolvedValueOnce(Response.json({ ok: false, description: 'chat not found' }))
    await expect(client.push('1', { text: 'hi' })).rejects.toThrow('chat not found')

    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }))
    await expect(client.push('1', { text: 'hi' })).rejects.toThrow('non-JSON body')

    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, result: {} }))
    await expect(client.answerCallbackQuery('cq-1')).resolves.toBeUndefined()
  })
})

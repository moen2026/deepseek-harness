import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSlackClient, interactiveBlocksOf } from '../src/client.ts'

const BOT_TOKEN_REF = credentialRef('DSH_SLACK_BOT_TOKEN')

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Context with only the credential service the client reads. */
function fakeContext(values: Record<string, string> = { DSH_SLACK_BOT_TOKEN: 'xoxb-1' }): never {
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

describe('interactiveBlocksOf', () => {
  it('renders one button per action with the style hint and the action id in both fields', () => {
    const blocks = interactiveBlocksOf({
      title: 'Approval',
      text: 'Run the tool?',
      actions: [
        { id: 'a1', label: 'Approve', style: 'primary' },
        { id: 'a2', label: 'Reject', style: 'danger' },
        { id: 'a3', label: 'Later' },
      ],
    })
    expect(blocks[1]).toEqual({
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Approve', emoji: true }, action_id: 'a1', value: 'a1', style: 'primary' },
        { type: 'button', text: { type: 'plain_text', text: 'Reject', emoji: true }, action_id: 'a2', value: 'a2', style: 'danger' },
        { type: 'button', text: { type: 'plain_text', text: 'Later', emoji: true }, action_id: 'a3', value: 'a3' },
      ],
    })
  })
})

describe('createSlackClient', () => {
  it('posts plain text to the configured origin with the resolved bot token', async () => {
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createSlackClient(fakeContext(), { apiBaseUrl: 'https://slack.com', botTokenRef: BOT_TOKEN_REF, timeoutMs: 1000 })
    await client.push('C1', { title: 'T', text: 'hello' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://slack.com/api/chat.postMessage')
    expect(JSON.parse(init?.body as string)).toEqual({ channel: 'C1', text: 'T\nhello' })
    expect(init?.headers).toMatchObject({ authorization: 'Bearer xoxb-1' })
  })

  it('posts Block Kit blocks when the message carries actions', async () => {
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createSlackClient(fakeContext(), { apiBaseUrl: 'https://slack.com', botTokenRef: BOT_TOKEN_REF, timeoutMs: 1000 })
    await client.push('C1', { text: 'hi', actions: [{ id: 'a1', label: 'Go' }] })
    const body = JSON.parse(fetchMock.mock.calls[0]![1]?.body as string) as { blocks: unknown[]; text: string }
    expect(body.blocks).toHaveLength(2)
    expect(body.text).toBe('hi')
  })

  it.each([
    ['a token-less credential', {}, /token is unavailable/],
  ] as const)('refuses %s', async (_name, values, message) => {
    const client = createSlackClient(fakeContext(values), { apiBaseUrl: 'https://slack.com', botTokenRef: BOT_TOKEN_REF, timeoutMs: 1000 })
    await expect(client.push('C1', { text: 'hi' })).rejects.toThrow(message)
  })

  it('maps transport, HTTP, and API failures onto SLACK_DELIVERY_FAILED', async () => {
    const client = createSlackClient(fakeContext(), { apiBaseUrl: 'https://slack.com', botTokenRef: BOT_TOKEN_REF, timeoutMs: 1000 })
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetchMock)

    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await expect(client.push('C1', { text: 'hi' })).rejects.toThrow('Slack request failed')

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))
    await expect(client.push('C1', { text: 'hi' })).rejects.toThrow('responded 500')

    fetchMock.mockResolvedValueOnce(Response.json({ ok: false, error: 'channel_not_found' }))
    await expect(client.push('C1', { text: 'hi' })).rejects.toThrow('channel_not_found')

    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }))
    await expect(client.push('C1', { text: 'hi' })).rejects.toThrow('non-JSON body')

    fetchMock.mockResolvedValueOnce(Response.json(null))
    await expect(client.push('C1', { text: 'hi' })).rejects.toThrow('unexpected body')
  })
})

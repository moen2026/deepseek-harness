import { Context } from '@deepseek-ai/cordis'
import { ConnectorChannelId, type ConnectorOutboundMessage } from '@deepseek-ai/dsh-connector'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/index.ts'

/** Minimal stand-in for the global WebSocket the gateway connects with. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(data: string): void {
    void data
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.onclose?.()
  }
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
})

/** The provider object the plugin registers on `ctx.connector`. */
interface FakeProvider {
  readonly id: string
  push(channel: ConnectorChannelId, message: ConnectorOutboundMessage, signal?: AbortSignal): Promise<void>
}

/** Context with only the services direct apply reads. */
function harness(): {
  ctx: Context
  registerProvider: ReturnType<typeof vi.fn<(provider: FakeProvider) => () => void>>
  removeProvider: ReturnType<typeof vi.fn>
} {
  const ctx = new Context()
  contexts.push(ctx)
  const removeProvider = vi.fn()
  const registerProvider = vi.fn<(provider: FakeProvider) => () => void>(() => removeProvider)
  ctx.provide('connector', { registerProvider } as never)
  ctx.provide('credentials', { resolve: async () => ({ value: 'bot-token-1', source: 'environment' }) } as never)
  return { ctx, registerProvider, removeProvider }
}

const valid = {
  botTokenEnv: 'DSH_DISCORD_BOT_TOKEN',
} satisfies Config

describe('Discord connector plugin config', () => {
  it('registers one provider and one gateway connection, both removed with the plugin fiber', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    FakeWebSocket.instances = []
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockImplementation(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const test = harness()
    apply(test.ctx, { ...valid, intents: 512, timeoutMs: 5_000 })
    expect(test.registerProvider).toHaveBeenCalledWith(expect.objectContaining({ id: 'discord' }))
    expect(FakeWebSocket.instances[0]!.url).toBe('wss://gateway.discord.gg/?v=10&encoding=json')
    await test.ctx.fiber.dispose()
    expect(test.removeProvider).toHaveBeenCalledOnce()
    expect(FakeWebSocket.instances[0]!.readyState).toBe(3)
  })

  it('pushes through the configured origin and defaults to discord.com', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    FakeWebSocket.instances = []
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockImplementation(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const proxied = harness()
    apply(proxied.ctx, { ...valid, apiBaseUrl: 'https://discord.example.com/api/v10/' })
    const proxiedProvider = proxied.registerProvider.mock.calls[0]![0]
    await proxiedProvider.push(ConnectorChannelId('c-1'), { text: 'hi' })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://discord.example.com/api/v10/channels/c-1/messages')

    const plain = harness()
    apply(plain.ctx, valid)
    const plainProvider = plain.registerProvider.mock.calls[0]![0]
    await plainProvider.push(ConnectorChannelId('c-1'), { text: 'hi' })
    expect(fetchMock.mock.calls[1]![0]).toBe('https://discord.com/api/v10/channels/c-1/messages')
  })

  it.each([
    [{ ...valid, botTokenEnv: 'not valid' }, /credential ref/],
    [{ ...valid, apiBaseUrl: 'not a URL' }, /absolute URL/],
    [{ ...valid, apiBaseUrl: 'http://discord.com' }, /https/],
    [{ ...valid, apiBaseUrl: 'https://discord.com/?q=1' }, /https/],
    [{ ...valid, gatewayUrl: 'not a URL' }, /absolute URL/],
    [{ ...valid, gatewayUrl: 'ws://gateway.discord.gg' }, /wss/],
  ] as const)('rejects invalid config %# before registration', (config, message) => {
    const test = harness()
    expect(() => { apply(test.ctx, config) }).toThrow(message)
    expect(test.registerProvider).not.toHaveBeenCalled()
  })
})

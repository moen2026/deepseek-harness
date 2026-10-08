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
  push(channel: ConnectorChannelId, message: ConnectorOutboundMessage, signal?: AbortSignal): Promise<void>
}

/** Context with only the services direct apply reads. */
function harness(): {
  ctx: Context
  register: ReturnType<typeof vi.fn>
  registerProvider: ReturnType<typeof vi.fn<(provider: FakeProvider) => () => void>>
  remove: ReturnType<typeof vi.fn>
  removeProvider: ReturnType<typeof vi.fn>
} {
  const ctx = new Context()
  contexts.push(ctx)
  const remove = vi.fn()
  const removeProvider = vi.fn()
  const register = vi.fn(() => remove)
  const registerProvider = vi.fn<(provider: FakeProvider) => () => void>(() => removeProvider)
  ctx.provide('webServer', { register } as never)
  ctx.provide('connector', { registerProvider } as never)
  ctx.provide('credentials', { resolve: async () => ({ value: 'fixture-secret', source: 'environment' }) } as never)
  return { ctx, register, registerProvider, remove, removeProvider }
}

const valid = {
  path: '/slack',
  signingSecretEnv: 'DSH_SLACK_SIGNING_SECRET',
  botTokenEnv: 'DSH_SLACK_BOT_TOKEN',
  maxBodyBytes: 1024,
} satisfies Config

describe('Slack connector plugin config', () => {
  it('registers one exact route and one provider, removed with the plugin fiber', async () => {
    const test = harness()
    apply(test.ctx, { ...valid, timeoutMs: 5_000 })
    expect(test.register).toHaveBeenCalledWith(expect.objectContaining({ kind: 'exact', path: '/slack' }))
    expect(test.registerProvider).toHaveBeenCalledWith(expect.objectContaining({ id: 'slack' }))
    await test.ctx.fiber.dispose()
    expect(test.remove).toHaveBeenCalledOnce()
    expect(test.removeProvider).toHaveBeenCalledOnce()
  })

  it('pushes through the configured origin and defaults to slack.com', async () => {
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockImplementation(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const proxied = harness()
    apply(proxied.ctx, { ...valid, apiBaseUrl: 'https://slack.example.com/' })
    const proxiedProvider = proxied.registerProvider.mock.calls[0]![0]
    await proxiedProvider.push(ConnectorChannelId('C1'), { text: 'hi' })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://slack.example.com/api/chat.postMessage')

    const plain = harness()
    apply(plain.ctx, valid)
    const plainProvider = plain.registerProvider.mock.calls[0]![0]
    await plainProvider.push(ConnectorChannelId('C1'), { text: 'hi' })
    expect(fetchMock.mock.calls[1]![0]).toBe('https://slack.com/api/chat.postMessage')
  })

  it.each([
    [{ ...valid, path: 'slack' }, /path/],
    [{ ...valid, path: '/' }, /path/],
    [{ ...valid, path: '/slack/' }, /path/],
    [{ ...valid, path: '/slack?q=1' }, /path/],
    [{ ...valid, path: '/slack#x' }, /path/],
    [{ ...valid, apiBaseUrl: 'not a URL' }, /absolute URL/],
    [{ ...valid, apiBaseUrl: 'http://slack.com' }, /https/],
    [{ ...valid, apiBaseUrl: 'https://slack.com/?q=1' }, /https/],
    [{ ...valid, signingSecretEnv: 'not valid' }, /credential ref/],
    [{ ...valid, botTokenEnv: 'not valid' }, /credential ref/],
  ] as const)('rejects invalid config %# before registration', (config, message) => {
    const test = harness()
    expect(() => { apply(test.ctx, config) }).toThrow(message)
    expect(test.register).not.toHaveBeenCalled()
    expect(test.registerProvider).not.toHaveBeenCalled()
  })
})

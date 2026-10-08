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
  path: '/feishu',
  appId: 'cli_app',
  appSecretEnv: 'DSH_FEISHU_APP_SECRET',
  verificationTokenEnv: 'DSH_FEISHU_VERIFICATION_TOKEN',
  maxBodyBytes: 1024,
} satisfies Config

describe('Feishu connector plugin config', () => {
  it('registers one exact route and one provider, removed with the plugin fiber', async () => {
    const test = harness()
    apply(test.ctx, { ...valid, timeoutMs: 5_000 })
    expect(test.register).toHaveBeenCalledWith(expect.objectContaining({ kind: 'exact', path: '/feishu' }))
    expect(test.registerProvider).toHaveBeenCalledWith(expect.objectContaining({ id: 'feishu' }))
    await test.ctx.fiber.dispose()
    expect(test.remove).toHaveBeenCalledOnce()
    expect(test.removeProvider).toHaveBeenCalledOnce()
  })

  it('pushes through the configured Lark origin and defaults to the Feishu origin', async () => {
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock
      .mockResolvedValueOnce(Response.json({ code: 0, tenant_access_token: 't-1', expire: 7200 }))
      .mockResolvedValueOnce(Response.json({ code: 0 }))
      .mockResolvedValueOnce(Response.json({ code: 0, tenant_access_token: 't-1', expire: 7200 }))
      .mockResolvedValueOnce(Response.json({ code: 0 }))

    const lark = harness()
    apply(lark.ctx, { ...valid, apiBaseUrl: 'https://open.larksuite.com/' })
    const larkProvider = lark.registerProvider.mock.calls[0]![0]
    await larkProvider.push(ConnectorChannelId('chat-1'), { text: 'hi' })
    expect(fetchMock.mock.calls[0]![0])
      .toBe('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal')

    const plain = harness()
    apply(plain.ctx, valid)
    const plainProvider = plain.registerProvider.mock.calls[0]![0]
    await plainProvider.push(ConnectorChannelId('chat-1'), { text: 'hi' })
    expect(fetchMock.mock.calls[2]![0])
      .toBe('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal')
  })

  it.each([
    [{ ...valid, appId: '' }, /appId/],
    [{ ...valid, appId: ' cli_app' }, /appId/],
    [{ ...valid, path: 'feishu' }, /path/],
    [{ ...valid, path: '/' }, /path/],
    [{ ...valid, path: '/feishu/' }, /path/],
    [{ ...valid, path: '/feishu?q=1' }, /path/],
    [{ ...valid, path: '/feishu#x' }, /path/],
    [{ ...valid, apiBaseUrl: 'not a URL' }, /absolute URL/],
    [{ ...valid, apiBaseUrl: 'http://open.feishu.cn' }, /https/],
    [{ ...valid, apiBaseUrl: 'https://open.feishu.cn/?q=1' }, /https/],
    [{ ...valid, appSecretEnv: 'not valid' }, /credential ref/],
    [{ ...valid, verificationTokenEnv: 'not valid' }, /credential ref/],
    [{ ...valid, encryptKeyEnv: 'not valid' }, /credential ref/],
  ] as const)('rejects invalid config %# before registration', (config, message) => {
    const test = harness()
    expect(() => { apply(test.ctx, config) }).toThrow(message)
    expect(test.register).not.toHaveBeenCalled()
    expect(test.registerProvider).not.toHaveBeenCalled()
  })
})

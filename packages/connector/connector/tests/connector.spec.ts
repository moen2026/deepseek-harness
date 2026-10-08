/** The connector seam reserves provider ids, routes verified messages into the outbox, and derives one Session per channel. */
import { Context } from '@deepseek-ai/cordis'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { WebhookDeliveryId, WebhookSourceId } from '@deepseek-ai/dsh-webhook'
import type { VerifiedWebhookDelivery, WebhookSessionRequest } from '@deepseek-ai/dsh-webhook'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Connector, { ConnectorChannelId, ConnectorError, ConnectorMessageId } from '../src/index.ts'
import type {
  ConnectorChannel,
  ConnectorInboundMessage,
  ConnectorInboundOptions,
  ConnectorProvider,
} from '../src/index.ts'

/** One inbound rule captured from the fake webhook runtime. */
interface CapturedRule {
  readonly id: string
  readonly kind: string
  readonly run: (
    delivery: Readonly<VerifiedWebhookDelivery>,
    signal: AbortSignal,
  ) => Promise<WebhookSessionRequest | null>
}

const contexts: Context[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-28T00:00:00Z'))
})

afterEach(async () => {
  const errors: unknown[] = []
  for (const ctx of contexts.splice(0)) {
    try { await ctx.fiber.dispose() } catch (error) { errors.push(error) }
  }
  vi.useRealTimers()
  if (errors.length > 0) throw new AggregateError(errors, 'connector test cleanup failed')
})

/** One provider; overrides inject the values the seam must reject. */
function providerWith(overrides: Record<string, unknown>): ConnectorProvider {
  return Object.assign({ id: 'feishu', push: (): void => {} }, overrides)
}

/** One inbound message; overrides inject the values the seam must reject. */
function badMessage(overrides: Record<string, unknown>): ConnectorInboundMessage {
  return Object.assign({
    provider: 'feishu',
    channel: ConnectorChannelId('chat-1'),
    messageId: ConnectorMessageId('m-1'),
    sender: 'u-1',
    text: 'hello',
  }, overrides)
}

/** One valid inbound message. */
function message(): ConnectorInboundMessage {
  return badMessage({})
}

/** Deployment options; overrides inject the values the seam must reject. */
function badOptions(overrides: Record<string, unknown>): ConnectorInboundOptions {
  return Object.assign({
    provider: 'feishu',
    workspacePath: process.cwd(),
    agentPreset: 'default',
    permissionPreset: 'standard',
  }, overrides)
}

/** One valid deployment choice set. */
function inboundOptions(overrides: Partial<ConnectorInboundOptions> = {}): ConnectorInboundOptions {
  return { ...badOptions({}), ...overrides }
}

/** One delivery addressed to the fixture channel. */
function deliveryOf(
  event: VerifiedWebhookDelivery['event'] = { channel: 'chat-1', messageId: 'm-1', sender: 'u-1', text: 'hello' },
): VerifiedWebhookDelivery {
  return {
    kind: 'feishu',
    source: WebhookSourceId('feishu'),
    deliveryId: WebhookDeliveryId('m-1'),
    event,
    receivedAt: 1,
  }
}

/** The code of the ConnectorError one call throws, or undefined when it does not throw. */
function codeOf(call: () => unknown): unknown {
  try {
    call()
    return undefined
  } catch (error) {
    return error instanceof ConnectorError ? error.code : undefined
  }
}

/** The user message one followup received, narrowed for content and source assertions. */
function followupMessage(followup: ReturnType<typeof vi.fn>): { content: unknown; source: unknown } {
  const call = followup.mock.calls[0]
  if (call === undefined) throw new Error('connector spec: followup was not called')
  return call[0] as { content: unknown; source: unknown }
}

/** Fake webhook runtime, outbox, agent registry, and preset registry behind one real Connector. */
async function harness() {
  const ctx = new Context()
  contexts.push(ctx)
  const rules = new Map<string, CapturedRule>()
  const outboxDeliver = vi.fn(async (): Promise<'queued' | 'duplicate'> => 'queued')
  const resumeFollowup = vi.fn()
  const agentsGet = vi.fn((..._args: unknown[]): unknown => undefined)
  const agentsResume = vi.fn(async (options: {
    resumeSessionId?: string
    signal?: AbortSignal
    setup?: (agentCtx: unknown) => Promise<void>
  }) => {
    await options.setup?.(undefined)
    return { agent: { followup: resumeFollowup } }
  })
  const presetsMount = vi.fn(async (..._args: unknown[]) => {})
  const scopeDisposed = vi.fn(async () => {})
  const presetsResolve = vi.fn(async (id: string) => ({ id }))
  const presetsAcquireScope = vi.fn(async (id: string) => ({ id, [Symbol.asyncDispose]: scopeDisposed }))
  const register = vi.fn((rule: CapturedRule) => {
    rules.set(rule.id, rule)
    // A real runtime disposer removes only its own registration: calling it
    // again after its rule was replaced must not touch the newer rule.
    return async () => {
      if (rules.get(rule.id) === rule) rules.delete(rule.id)
    }
  })
  ctx.provide('webhookRuntime', { register } as never)
  ctx.provide('webhookOutbox', { deliver: outboxDeliver } as never)
  ctx.provide('agents', { get: agentsGet, resume: agentsResume } as never)
  ctx.provide('agentPresets', {
    resolve: presetsResolve,
    acquireScope: presetsAcquireScope,
    mount: presetsMount,
  } as never)
  ctx.provide('sessionPersistence', {} as never)
  await ctx.plugin(Connector)
  const runRule = (
    delivery: VerifiedWebhookDelivery,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<WebhookSessionRequest | null> => ruleOf(rules, 'feishu').run(delivery, signal)
  return {
    ctx,
    connector: ctx.connector,
    runRule,
    rules,
    register,
    outboxDeliver,
    agentsGet,
    agentsResume,
    resumeFollowup,
    presetsResolve,
    presetsAcquireScope,
    presetsMount,
    scopeDisposed,
  }
}

/** A harness with the fixture provider registered and its inbound rule in place. */
async function ruleHarness(options: ConnectorInboundOptions = inboundOptions()) {
  const h = await harness()
  h.connector.registerProvider(providerWith({}))
  h.connector.inbound(options)
  return { ...h, options }
}

/** The captured rule of one provider. */
function ruleOf(rules: Map<string, CapturedRule>, provider: string): CapturedRule {
  const rule = rules.get(`connector-inbound:${provider}`)
  if (rule === undefined) throw new Error(`connector spec: no inbound rule registered for "${provider}"`)
  return rule
}

describe('provider registry', () => {
  it('rejects a provider whose id is not a non-empty string', async () => {
    const { connector } = await harness()
    expect(codeOf(() => connector.registerProvider(providerWith({ id: 42 })))).toBe('CONNECTOR_INVALID_PROVIDER')
    expect(() => connector.registerProvider(providerWith({ id: '   ' })))
      .toThrow('a connector provider id must be a non-empty string')
  })

  it('rejects a provider without a push function', async () => {
    const { connector } = await harness()
    expect(codeOf(() => connector.registerProvider(providerWith({ push: undefined }))))
      .toBe('CONNECTOR_INVALID_PROVIDER')
  })

  it('rejects a duplicate registration', async () => {
    const { connector } = await harness()
    connector.registerProvider(providerWith({}))
    expect(codeOf(() => connector.registerProvider(providerWith({})))).toBe('CONNECTOR_CONFLICT')
  })

  it('releases the reserved id with its disposer', async () => {
    const { connector } = await harness()
    const dispose = connector.registerProvider(providerWith({}))
    expect(codeOf(() => connector.registerProvider(providerWith({})))).toBe('CONNECTOR_CONFLICT')
    dispose()
    await vi.advanceTimersByTimeAsync(0)
    expect(codeOf(() => connector.registerProvider(providerWith({})))).toBeUndefined()
  })
})

describe('deliver', () => {
  it('rejects an invalid channel', async () => {
    const { connector } = await harness()
    await expect(connector.deliver(badMessage({ channel: 42 })))
      .rejects.toThrow('connector inbound channel must be a non-empty string')
    await expect(connector.deliver(badMessage({ channel: '   ' })))
      .rejects.toThrow('connector inbound channel must be a non-empty string')
  })

  it('rejects an invalid messageId', async () => {
    const { connector } = await harness()
    await expect(connector.deliver(badMessage({ messageId: 42 })))
      .rejects.toThrow('connector inbound messageId must be a non-empty string')
    await expect(connector.deliver(badMessage({ messageId: '   ' })))
      .rejects.toThrow('connector inbound messageId must be a non-empty string')
  })

  it('rejects an invalid sender', async () => {
    const { connector } = await harness()
    await expect(connector.deliver(badMessage({ sender: 42 })))
      .rejects.toThrow('connector inbound sender must be a non-empty string')
    await expect(connector.deliver(badMessage({ sender: '   ' })))
      .rejects.toThrow('connector inbound sender must be a non-empty string')
  })

  it('rejects an invalid text', async () => {
    const { connector } = await harness()
    await expect(connector.deliver(badMessage({ text: 42 })))
      .rejects.toThrow('connector inbound text must be a non-empty string')
    await expect(connector.deliver(badMessage({ text: '   ' })))
      .rejects.toThrow('connector inbound text must be a non-empty string')
  })

  it('rejects a message whose provider is not registered', async () => {
    const { connector } = await harness()
    await expect(connector.deliver(message())).rejects.toMatchObject({ code: 'CONNECTOR_UNKNOWN_PROVIDER' })
  })

  it('rejects a message whose provider has no inbound rule', async () => {
    const { connector } = await harness()
    connector.registerProvider(providerWith({}))
    await expect(connector.deliver(message())).rejects.toMatchObject({ code: 'CONNECTOR_INBOUND_UNAVAILABLE' })
  })

  it('queues a delivery built from the message', async () => {
    const { connector, outboxDeliver } = await harness()
    connector.registerProvider(providerWith({}))
    connector.inbound(inboundOptions())
    await expect(connector.deliver(message())).resolves.toBe('queued')
    expect(outboxDeliver).toHaveBeenCalledWith({
      kind: 'feishu',
      source: WebhookSourceId('feishu'),
      deliveryId: WebhookDeliveryId('m-1'),
      event: { channel: 'chat-1', messageId: 'm-1', sender: 'u-1', text: 'hello' },
      receivedAt: Date.now(),
    })
  })

  it('reports a duplicate the outbox already holds', async () => {
    const { connector, outboxDeliver } = await harness()
    connector.registerProvider(providerWith({}))
    connector.inbound(inboundOptions())
    outboxDeliver.mockResolvedValueOnce('duplicate')
    await expect(connector.deliver(message())).resolves.toBe('duplicate')
  })

  it('queues a resolution whose chat text is empty', async () => {
    const { connector, outboxDeliver } = await harness()
    connector.registerProvider(providerWith({}))
    connector.inbound(inboundOptions())
    await expect(connector.deliver(badMessage({
      text: '',
      resolution: { actionId: 'a:b:rejected', value: '' },
    }))).resolves.toBe('queued')
    expect(outboxDeliver.mock.calls[0]?.[0]).toMatchObject({
      event: { text: '', resolution: { actionId: 'a:b:rejected', value: '' } },
    })
  })
})

describe('push', () => {
  it('rejects a channel whose provider is not registered', async () => {
    const { connector } = await harness()
    const channel: ConnectorChannel = { provider: 'ghost', channel: ConnectorChannelId('chat-1') }
    await expect(connector.push(channel, { text: 'hi' })).rejects.toMatchObject({ code: 'CONNECTOR_UNKNOWN_PROVIDER' })
  })

  it('delegates to the registered provider', async () => {
    const { connector } = await harness()
    const push = vi.fn(async () => {})
    connector.registerProvider(providerWith({ push }))
    const controller = new AbortController()
    const channel: ConnectorChannel = { provider: 'feishu', channel: ConnectorChannelId('chat-1') }
    await connector.push(channel, { title: 'report', text: 'hi' }, controller.signal)
    expect(push).toHaveBeenCalledWith(ConnectorChannelId('chat-1'), { title: 'report', text: 'hi' }, controller.signal)
  })
})

describe('inbound registration', () => {
  it('rejects invalid deployment options', async () => {
    const { connector } = await harness()
    expect(() => connector.inbound(badOptions({ provider: 42 })))
      .toThrow('connector inbound provider must be a non-empty string')
    expect(() => connector.inbound(badOptions({ provider: '   ' })))
      .toThrow('connector inbound provider must be a non-empty string')
    expect(() => connector.inbound(badOptions({ workspacePath: 42 })))
      .toThrow('connector inbound workspacePath must be an absolute path')
    expect(() => connector.inbound(badOptions({ workspacePath: 'relative/dir' })))
      .toThrow('connector inbound workspacePath must be an absolute path')
    expect(() => connector.inbound(badOptions({ agentPreset: '   ' })))
      .toThrow('connector inbound agentPreset must be a non-empty string')
    expect(() => connector.inbound(badOptions({ permissionPreset: '' })))
      .toThrow('connector inbound permissionPreset must be a non-empty string')
    expect(() => connector.inbound(badOptions({ title: '' })))
      .toThrow('connector inbound title must be a non-empty string when present')
  })

  it('registers one rule per provider and forgets only its own release', async () => {
    const { connector, register, rules } = await harness()
    const disposeA = connector.inbound(inboundOptions())
    expect(register).toHaveBeenCalledTimes(1)
    const [registered] = register.mock.calls[0] ?? []
    expect(registered?.id).toBe('connector-inbound:feishu')
    expect(registered?.kind).toBe('feishu')
    expect(typeof registered?.run).toBe('function')
    expect(rules.has('connector-inbound:feishu')).toBe(true)
    expect(codeOf(() => connector.inbound(inboundOptions()))).toBe('CONNECTOR_CONFLICT')

    await disposeA()
    expect(rules.has('connector-inbound:feishu')).toBe(false)

    const disposeB = connector.inbound(inboundOptions())
    expect(rules.has('connector-inbound:feishu')).toBe(true)
    // The old disposer runs after its registration was replaced: it must not
    // forget the newer rule.
    await disposeA()
    expect(rules.has('connector-inbound:feishu')).toBe(true)
    expect(codeOf(() => connector.inbound(inboundOptions()))).toBe('CONNECTOR_CONFLICT')

    await disposeB()
    expect(rules.has('connector-inbound:feishu')).toBe(false)
  })
})

describe('channel bindings', () => {
  it('keeps the channel-to-Session pair 1:1 and releases it on unbind', async () => {
    const { connector } = await harness()
    const channel: ConnectorChannel = { provider: 'feishu', channel: ConnectorChannelId('chat-1') }
    const otherChannel: ConnectorChannel = { provider: 'feishu', channel: ConnectorChannelId('chat-2') }
    const sessionA = brandString<SessionId>('session-a')
    const sessionB = brandString<SessionId>('session-b')

    connector.bind(channel, sessionA)
    expect(connector.sessionOf(channel)).toBe(sessionA)
    expect(connector.channelOf(sessionA)).toEqual(channel)

    // Re-binding the same pair changes nothing.
    connector.bind(channel, sessionA)
    expect(connector.sessionOf(channel)).toBe(sessionA)
    expect(connector.channelOf(sessionA)).toEqual(channel)

    // Re-binding the channel releases the previous Session's side.
    connector.bind(channel, sessionB)
    expect(connector.sessionOf(channel)).toBe(sessionB)
    expect(connector.channelOf(sessionA)).toBeUndefined()

    // Re-binding the Session releases the previous channel's side.
    connector.bind(otherChannel, sessionB)
    expect(connector.channelOf(sessionB)).toEqual(otherChannel)
    expect(connector.sessionOf(channel)).toBeUndefined()

    // Unbinding an unbound channel changes nothing.
    connector.unbind({ provider: 'feishu', channel: ConnectorChannelId('ghost') })
    expect(connector.channelOf(sessionB)).toEqual(otherChannel)

    connector.unbind(otherChannel)
    expect(connector.sessionOf(otherChannel)).toBeUndefined()
    expect(connector.channelOf(sessionB)).toBeUndefined()
  })
})

describe('inbound rule', () => {
  it('rejects a payload that is not a JSON object', async () => {
    const h = await ruleHarness()
    await expect(h.runRule(deliveryOf(null)))
      .rejects.toThrow('connector delivery event must be a JSON object')
    await expect(h.runRule(deliveryOf('text')))
      .rejects.toThrow('connector delivery event must be a JSON object')
    await expect(h.runRule(deliveryOf([])))
      .rejects.toThrow('connector delivery event must be a JSON object')
  })

  it('rejects a payload missing any non-empty string field', async () => {
    const h = await ruleHarness()
    await expect(h.runRule(deliveryOf({})))
      .rejects.toThrow('connector delivery event channel must be a non-empty string')
    await expect(h.runRule(deliveryOf({ channel: '   ' })))
      .rejects.toThrow('connector delivery event channel must be a non-empty string')
    await expect(h.runRule(deliveryOf({ channel: 'chat-1' })))
      .rejects.toThrow('connector delivery event messageId must be a non-empty string')
    await expect(h.runRule(deliveryOf({ channel: 'chat-1', messageId: 'm-1' })))
      .rejects.toThrow('connector delivery event sender must be a non-empty string')
    await expect(h.runRule(deliveryOf({ channel: 'chat-1', messageId: 'm-1', sender: 'u-1' })))
      .rejects.toThrow('connector delivery event text must be a non-empty string')
  })

  it('continues a live Session of the channel', async () => {
    const h = await ruleHarness()
    const followup = vi.fn()
    h.agentsGet.mockReturnValue({ followup })
    await expect(h.runRule(deliveryOf())).resolves.toBeNull()
    expect(h.agentsResume).not.toHaveBeenCalled()
    expect(followupMessage(followup).content).toMatchObject([{ type: 'text', text: 'hello' }])
    expect(followupMessage(followup).source).toMatchObject({
      kind: 'webhook',
      provider: 'feishu',
      deliveryId: 'm-1',
      ruleId: 'connector-inbound:feishu',
    })
  })

  it('resumes the persisted Session when it is not live', async () => {
    const h = await ruleHarness()
    const controller = new AbortController()
    await expect(h.runRule(deliveryOf(), controller.signal)).resolves.toBeNull()
    expect(h.presetsResolve).toHaveBeenCalledWith('default')
    expect(h.presetsAcquireScope).toHaveBeenCalledWith('default')
    expect(h.scopeDisposed).toHaveBeenCalledTimes(1)
    expect(h.presetsMount).toHaveBeenCalledTimes(1)
    expect(h.presetsMount.mock.calls[0]?.[1]).toBe('default')
    const resumeCall = h.agentsResume.mock.calls[0]?.[0]
    expect(resumeCall?.resumeSessionId).toMatch(/^connector-[0-9a-f]{24}$/)
    expect(resumeCall?.signal).toBe(controller.signal)
    expect(followupMessage(h.resumeFollowup).content).toMatchObject([{ type: 'text', text: 'hello' }])
    expect(followupMessage(h.resumeFollowup).source).toMatchObject({ ruleId: 'connector-inbound:feishu' })
  })

  it('derives one stable Session per channel and provider', async () => {
    const options = inboundOptions()
    const h = await ruleHarness(options)
    await h.runRule(deliveryOf({ channel: 'chat-1', messageId: 'm-1', sender: 'u-1', text: 'first' }))
    await h.runRule(deliveryOf({ channel: 'chat-1', messageId: 'm-2', sender: 'u-1', text: 'second' }))
    const firstId = String(h.agentsGet.mock.calls[0]?.[0])
    const secondId = String(h.agentsGet.mock.calls[1]?.[0])
    expect(firstId).toMatch(/^connector-[0-9a-f]{24}$/)
    expect(secondId).toBe(firstId)
    expect(h.connector.sessionOf({ provider: 'feishu', channel: ConnectorChannelId('chat-1') })).toBe(firstId)

    // The same channel text on another provider addresses its own Session.
    h.connector.registerProvider(providerWith({ id: 'dingtalk' }))
    h.connector.inbound(inboundOptions({ provider: 'dingtalk' }))
    await ruleOf(h.rules, 'dingtalk').run(
      deliveryOf({ channel: 'chat-1', messageId: 'm-3', sender: 'u-1', text: 'third' }),
      new AbortController().signal,
    )
    expect(String(h.agentsGet.mock.calls[2]?.[0])).not.toBe(firstId)
  })

  it('returns the creation request when no Session exists to resume', async () => {
    const options = inboundOptions()
    const h = await ruleHarness(options)
    h.agentsResume.mockRejectedValueOnce(new Error('connector spec: nothing stored'))
    const result = await h.runRule(deliveryOf())
    const sessionId = String(h.agentsGet.mock.calls[0]?.[0])
    expect(result).toEqual({
      workspacePath: options.workspacePath,
      title: 'Connector feishu',
      prompt: 'hello',
      agentPreset: 'default',
      permissionPreset: 'standard',
      sessionId,
    })
  })

  it('carries an explicit title and model into the creation request', async () => {
    const options = inboundOptions({
      title: 'Ops channel',
      model: { provider: 'deepseek', model: 'deepseek-chat' },
    })
    const h = await ruleHarness(options)
    h.agentsResume.mockRejectedValueOnce(new Error('connector spec: nothing stored'))
    const result = await h.runRule(deliveryOf())
    expect(result).not.toBeNull()
    expect(result?.title).toBe('Ops channel')
    expect(result?.model).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
  })

  it('aborts without creating a Session when the signal is cancelled', async () => {
    const h = await ruleHarness()
    const controller = new AbortController()
    controller.abort(new Error('connector spec: cancelled'))
    await expect(h.runRule(deliveryOf(), controller.signal)).rejects.toThrow('connector spec: cancelled')
    expect(h.agentsResume).not.toHaveBeenCalled()
  })
})

describe('interactive resolutions', () => {
  /** One delivery whose event carries a resolution. */
  function resolutionDelivery(overrides: Record<string, unknown> = {}): VerifiedWebhookDelivery {
    return deliveryOf({
      channel: 'chat-1', messageId: 'm-1', sender: 'u-1', text: 'clicked Approve',
      resolution: { actionId: 'dsh-approval:abc:allowed-once', value: '' },
      ...overrides,
    })
  }

  it('validates the provider id, handler, registration, and conflicts', async () => {
    const h = await harness()
    expect(codeOf(() => h.connector.resolutions('   ', async () => {}))).toBe('CONNECTOR_INVALID_PROVIDER')
    expect(codeOf(() => h.connector.resolutions('feishu', undefined))).toBe('CONNECTOR_INVALID_PROVIDER')
    expect(codeOf(() => h.connector.resolutions('feishu', async () => {}))).toBe('CONNECTOR_UNKNOWN_PROVIDER')
    h.connector.registerProvider(providerWith({}))
    const dispose = h.connector.resolutions('feishu', async () => {})
    expect(codeOf(() => h.connector.resolutions('feishu', async () => {}))).toBe('CONNECTOR_CONFLICT')
    dispose()
    expect(codeOf(() => h.connector.resolutions('feishu', async () => {}))).toBeUndefined()
  })

  it('validates the resolution fields before a durable record exists', async () => {
    const h = await ruleHarness()
    await expect(h.connector.deliver(badMessage({ resolution: { actionId: '   ', value: '' } })))
      .rejects.toThrow('resolution.actionId must be a non-empty string')
    await expect(h.connector.deliver(badMessage({ resolution: { actionId: 'a', value: 3 } })))
      .rejects.toThrow('resolution.value must be a string')
  })

  it('hands a resolution to the consumer instead of the Session', async () => {
    const h = await ruleHarness()
    const handler = vi.fn(async () => {})
    h.connector.resolutions('feishu', handler)
    await expect(h.runRule(resolutionDelivery())).resolves.toBeNull()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      provider: 'feishu',
      channel: 'chat-1',
      messageId: 'm-1',
      sender: 'u-1',
      text: 'clicked Approve',
      resolution: { actionId: 'dsh-approval:abc:allowed-once', value: '' },
    })
    expect(h.agentsGet).not.toHaveBeenCalled()
    expect(h.agentsResume).not.toHaveBeenCalled()
    expect(h.connector.sessionOf({ provider: 'feishu', channel: ConnectorChannelId('chat-1') })).toBeUndefined()
  })

  it('admits a resolution whose event carries no chat text', async () => {
    const h = await ruleHarness()
    const handler = vi.fn(async () => {})
    h.connector.resolutions('feishu', handler)
    await h.runRule(deliveryOf({
      channel: 'chat-1', messageId: 'm-9', sender: 'u-1',
      resolution: { actionId: 'dsh-approval:abc:rejected', value: '' },
    }))
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ text: '', messageId: 'm-9' })
  })

  it('fails the delivery when no resolution consumer is registered', async () => {
    const h = await ruleHarness()
    await expect(h.runRule(resolutionDelivery())).rejects.toMatchObject({ code: 'CONNECTOR_INBOUND_UNAVAILABLE' })
  })

  it('stops consuming after the disposer runs', async () => {
    const h = await ruleHarness()
    const handler = vi.fn(async () => {})
    const dispose = h.connector.resolutions('feishu', handler)
    await h.runRule(resolutionDelivery({ messageId: 'm-1' }))
    dispose()
    await expect(h.runRule(resolutionDelivery({ messageId: 'm-2' })))
      .rejects.toMatchObject({ code: 'CONNECTOR_INBOUND_UNAVAILABLE' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('delivers resolutions through the outbox with the resolution payload', async () => {
    const h = await ruleHarness()
    h.connector.resolutions('feishu', async () => {})
    await expect(h.connector.deliver(badMessage({ resolution: { actionId: 'a:b:allowed-once', value: 'v' } })))
      .resolves.toBe('queued')
    expect(h.outboxDeliver.mock.calls[0]?.[0]).toMatchObject({
      event: { resolution: { actionId: 'a:b:allowed-once', value: 'v' } },
    })
  })

  it('pushes outbound actions to the provider unchanged', async () => {
    const push = vi.fn(async () => {})
    const h = await harness()
    h.connector.registerProvider(providerWith({ push }))
    const actions = [
      { id: 'act-1', label: 'Approve', style: 'primary' },
      { id: 'act-2', label: 'Reject', style: 'danger' },
    ] as const
    await h.connector.push({ provider: 'feishu', channel: ConnectorChannelId('chat-1') }, {
      text: 'hello', actions,
    })
    expect(push.mock.calls[0]?.[1]).toEqual({ text: 'hello', actions })
  })
})

describe('inbound attachments', () => {
  /** One canonical base64 payload for a tiny fixture image. */
  const PNG = 'iVBORw0KGgo='

  /** One fake attachment store covering the two operations the seam admits through. */
  function fakeStore(): {
    saveImages: ReturnType<typeof vi.fn>
    saveFile: ReturnType<typeof vi.fn>
  } {
    return {
      saveImages: vi.fn(async (
        inputs: readonly { readonly mediaType: string; readonly name?: string }[],
      ) => inputs.map(input => ({
        attachmentId: brandString<AttachmentId>(`att-${input.name ?? 'img'}`),
        mediaType: input.mediaType,
        bytes: 7,
        width: 2,
        height: 3,
        ...(input.name === undefined ? {} : { name: input.name }),
      }))),
      saveFile: vi.fn(async (input: { readonly name?: string }) => ({
        attachmentId: brandString<AttachmentId>('att-file'),
        name: input.name ?? 'file.bin',
        bytes: 0,
      })),
    }
  }

  /** One prompt delivery carrying one image and one file. */
  function attachmentDelivery(overrides: Record<string, unknown> = {}): VerifiedWebhookDelivery {
    return deliveryOf({
      channel: 'chat-1', messageId: 'm-1', sender: 'u-1', text: 'look',
      attachments: [
        { type: 'image', mediaType: 'image/png', data: PNG, name: 'shot.png' },
        { type: 'file', data: '', name: 'notes.txt' },
      ],
      ...overrides,
    })
  }

  it('validates attachments before the durable record exists', async () => {
    const { connector } = await harness()
    connector.registerProvider(providerWith({}))
    connector.inbound(inboundOptions())
    await expect(connector.deliver(badMessage({ attachments: 42 })))
      .rejects.toThrow('connector inbound attachments must be an array when present')
    await expect(connector.deliver(badMessage({ attachments: ['x'] })))
      .rejects.toThrow('connector inbound attachments entries must be JSON objects')
    await expect(connector.deliver(badMessage({ attachments: [{ type: 'sticker', data: 'aGk=' }] })))
      .rejects.toThrow("connector inbound attachments entry type must be 'image' or 'file'")
    await expect(connector.deliver(badMessage({ attachments: [{ type: 'file', data: 'aGk' }] })))
      .rejects.toThrow('connector inbound attachments entry data must be canonical base64')
    await expect(connector.deliver(badMessage({ attachments: [{ type: 'image', mediaType: 'image/png', data: '' }] })))
      .rejects.toThrow('connector inbound attachments entry data must be canonical base64 of at least one byte')
    await expect(connector.deliver(badMessage({ attachments: [{ type: 'image', mediaType: 'image/svg+xml', data: PNG }] })))
      .rejects.toThrow('connector inbound attachments entry mediaType must be one of the accepted raster image types')
    await expect(connector.deliver(badMessage({ attachments: [{ type: 'file', data: 'aGk=', name: ' ' }] })))
      .rejects.toThrow('connector inbound attachments entry name must be a non-empty string when present')
  })

  it('rejects a resolution message carrying attachments', async () => {
    const h = await ruleHarness()
    await expect(h.connector.deliver(badMessage({
      resolution: { actionId: 'a:b:rejected', value: '' },
      attachments: [{ type: 'file', data: 'aGk=' }],
    }))).rejects.toThrow('connector inbound resolution message must not carry attachments')
    await expect(h.runRule(deliveryOf({
      channel: 'chat-1', messageId: 'm-1', sender: 'u-1', text: 'clicked Approve',
      resolution: { actionId: 'dsh-approval:abc:rejected', value: '' },
      attachments: [{ type: 'file', data: 'aGk=' }],
    }))).rejects.toThrow('connector delivery event resolution must not carry attachments')
  })

  it('queues the event carrying the validated attachments', async () => {
    const h = await ruleHarness()
    await expect(h.connector.deliver(badMessage({
      attachments: [
        { type: 'image', mediaType: 'image/png', data: PNG },
        { type: 'file', data: '', name: 'notes.txt' },
      ],
    }))).resolves.toBe('queued')
    expect(h.outboxDeliver.mock.calls[0]?.[0]).toMatchObject({
      event: {
        attachments: [
          { type: 'image', mediaType: 'image/png', data: PNG },
          { type: 'file', data: '', name: 'notes.txt' },
        ],
      },
    })
  })

  it('appends the admitted references after the prompt text', async () => {
    const h = await ruleHarness()
    const store = fakeStore()
    h.ctx.provide('attachments', store as never)
    const followup = vi.fn()
    h.agentsGet.mockReturnValue({ followup })
    await expect(h.runRule(attachmentDelivery())).resolves.toBeNull()
    const saved = store.saveImages.mock.calls[0]?.[0] as readonly {
      readonly data: Uint8Array
      readonly mediaType: string
      readonly name?: string
    }[]
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ mediaType: 'image/png', name: 'shot.png' })
    expect(saved[0]?.data).toBeInstanceOf(Uint8Array)
    expect(followupMessage(followup).content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', attachment: {
        attachmentId: 'att-shot.png', mediaType: 'image/png', bytes: 7, width: 2, height: 3, name: 'shot.png',
      } },
      { type: 'file', attachment: { attachmentId: 'att-file', name: 'notes.txt', bytes: 0 } },
    ])
  })

  it('carries admitted attachments in the creation request', async () => {
    const options = inboundOptions()
    const h = await ruleHarness(options)
    h.ctx.provide('attachments', fakeStore() as never)
    h.agentsResume.mockRejectedValueOnce(new Error('connector spec: nothing stored'))
    const result = await h.runRule(attachmentDelivery())
    expect(result).toMatchObject({
      prompt: 'look',
      attachments: [
        { type: 'image', attachment: { attachmentId: 'att-shot.png', mediaType: 'image/png', bytes: 7, width: 2, height: 3 } },
        { type: 'file', attachment: { attachmentId: 'att-file', name: 'notes.txt', bytes: 0 } },
      ],
    })
  })

  it('performs no storage operation for a message without attachments', async () => {
    const h = await ruleHarness()
    const store = fakeStore()
    h.ctx.provide('attachments', store as never)
    const followup = vi.fn()
    h.agentsGet.mockReturnValue({ followup })
    await h.runRule(deliveryOf())
    expect(store.saveImages).not.toHaveBeenCalled()
    expect(store.saveFile).not.toHaveBeenCalled()
    expect(followupMessage(followup).content).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('fails the delivery when attachments are present without an attachment capability', async () => {
    const h = await ruleHarness()
    await expect(h.runRule(attachmentDelivery()))
      .rejects.toMatchObject({ code: 'CONNECTOR_ATTACHMENTS_UNAVAILABLE' })
  })
})

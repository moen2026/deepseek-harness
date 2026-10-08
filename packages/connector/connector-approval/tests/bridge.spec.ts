import { Context } from '@deepseek-ai/cordis'
import { ConnectorChannelId, ConnectorMessageId } from '@deepseek-ai/dsh-connector'
import type { ConnectorChannel, ConnectorOutboundMessage, ConnectorResolutionHandler } from '@deepseek-ai/dsh-connector'
import { brandString } from '@deepseek-ai/dsh-brand'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import { decodeBridgeActionId } from '../src/types.ts'
import type { Config } from '../src/types.ts'

const contexts: Context[] = []

afterEach(async () => {
  const errors: unknown[] = []
  for (const ctx of contexts.splice(0)) {
    try { await ctx.fiber.dispose() } catch (error) { errors.push(error) }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'connector-approval test cleanup failed')
})

/** One captured push. */
interface CapturedPush {
  readonly channel: ConnectorChannel
  readonly message: ConnectorOutboundMessage
  readonly signal: AbortSignal | undefined
}

/** Fake connector behind the bridge; `channelOf` starts unbound. */
async function harness(config: Config = { providers: ['feishu'] }) {
  const ctx = new Context()
  contexts.push(ctx)
  const pushes: CapturedPush[] = []
  const handlers = new Map<string, ConnectorResolutionHandler>()
  const channelOf = vi.fn((): ConnectorChannel | undefined => undefined)
  const connector = {
    channelOf,
    push: vi.fn(async (channel: ConnectorChannel, message: ConnectorOutboundMessage, signal?: AbortSignal) => {
      pushes.push({ channel, message, signal })
    }),
    resolutions: vi.fn((provider: string, handler: ConnectorResolutionHandler) => {
      handlers.set(provider, handler)
      return () => {
        if (handlers.get(provider) === handler) handlers.delete(provider)
      }
    }),
  }
  ctx.provide('connector', connector as never)
  apply(ctx, config)

  /** Ask through the same dispatch the approval service uses. */
  const ask = (overrides: Partial<ApprovalRequest> = {}): Promise<ApprovalOutcome> => {
    const req: ApprovalRequest = {
      agent: { id: brandString<SessionId>('connector-aaaaaaaaaaaaaaaaaaaaaaaa') },
      toolName: 'shell',
      ...overrides,
    }
    return ctx.waterfall(
      scopeTarget(req.agent, req.agent),
      'approval/request',
      req,
      () => Promise.resolve<ApprovalOutcome>('unavailable'),
    )
  }

  /** Deliver one platform resolution to the bridge's handler for the provider. */
  const decide = (provider: string, actionId: string, sender = 'operator'): void => {
    const handler = handlers.get(provider)
    if (handler === undefined) throw new Error(`connector-approval spec: no resolution handler for "${provider}"`)
    void handler({
      provider,
      channel: ConnectorChannelId('chat-1'),
      messageId: ConnectorMessageId('m-1'),
      sender,
      text: '',
      resolution: { actionId, value: '' },
    })
  }

  return { ctx, channelOf, pushes, handlers, ask, decide }
}

/** Wait until the bridge's push has rendered, so the listener is waiting on the race. */
async function rendered(pushes: readonly CapturedPush[]): Promise<void> {
  await vi.waitFor(() => { expect(pushes).toHaveLength(1) })
}

describe('configuration', () => {
  it('rejects an empty provider list', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('connector', {} as never)
    expect(() => {
      apply(ctx, { providers: [] })
    }).toThrow('at least one connector provider')
  })

  it('rejects an approver map without any sender', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('connector', {} as never)
    expect(() => {
      apply(ctx, { providers: ['feishu'], approvers: {} })
    }).toThrow('at least one sender id')
  })

  it('rejects an approver entry whose identity is empty', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('connector', {} as never)
    expect(() => {
      apply(ctx, { providers: ['feishu'], approvers: { 'u-1': ' ' } })
    }).toThrow('non-empty sender ids to non-empty identities')
  })
})

describe('unbound sessions', () => {
  it('delegates to the next answerer without pushing a card', async () => {
    const { pushes, ask } = await harness()
    await expect(ask()).resolves.toBe('unavailable')
    expect(pushes).toHaveLength(0)
  })
})

describe('bound sessions', () => {
  it('pushes one card with an action per bridged outcome and answers from the clicked resolution', async () => {
    const h = await harness()
    h.channelOf.mockReturnValue({ provider: 'feishu', channel: 'chat-1' })
    const answer = h.ask({ reason: 'needs network' })
    await rendered(h.pushes)
    expect(h.pushes[0].channel).toEqual({ provider: 'feishu', channel: 'chat-1' })
    expect(h.pushes[0].message.text).toContain('shell')
    expect(h.pushes[0].message.text).toContain('needs network')
    const [allow, reject] = h.pushes[0].message.actions ?? []
    expect(allow?.label).toBe('Approve')
    expect(allow?.style).toBe('primary')
    expect(allow && decodeBridgeActionId(allow.id)).toMatchObject({ outcome: 'allowed-once' })
    expect(reject?.label).toBe('Reject')
    expect(reject?.style).toBe('danger')
    expect(reject && decodeBridgeActionId(reject.id)).toMatchObject({ outcome: 'rejected' })
    expect(decodeBridgeActionId(allow!.id)?.correlationId)
      .toBe(decodeBridgeActionId(reject!.id)?.correlationId)
    h.decide('feishu', allow!.id)
    await expect(answer).resolves.toBe('allowed-once')
  })

  it('answers rejected when the danger action is clicked', async () => {
    const h = await harness()
    h.channelOf.mockReturnValue({ provider: 'feishu', channel: 'chat-1' })
    const answer = h.ask()
    await rendered(h.pushes)
    h.decide('feishu', h.pushes[0].message.actions![1].id)
    await expect(answer).resolves.toBe('rejected')
  })

  it('honors configured button labels', async () => {
    const h = await harness({ providers: ['feishu'], allowLabel: '允许', rejectLabel: '拒绝' })
    h.channelOf.mockReturnValue({ provider: 'feishu', channel: 'chat-1' })
    const answer = h.ask()
    await rendered(h.pushes)
    const [allow, reject] = h.pushes[0].message.actions ?? []
    expect(allow?.label).toBe('允许')
    expect(allow?.style).toBe('primary')
    expect(reject?.label).toBe('拒绝')
    expect(reject?.style).toBe('danger')
    h.decide('feishu', allow!.id)
    await expect(answer).resolves.toBe('allowed-once')
  })

  it('passes the request signal to the push', async () => {
    const h = await harness()
    h.channelOf.mockReturnValue({ provider: 'feishu', channel: 'chat-1' })
    const controller = new AbortController()
    const answer = h.ask({ signal: controller.signal })
    await rendered(h.pushes)
    expect(h.pushes[0].signal).toBe(controller.signal)
    controller.abort()
    await expect(answer).resolves.toBe('cancelled')
  })

  it('settles an already-aborted request as cancelled', async () => {
    const h = await harness()
    h.channelOf.mockReturnValue({ provider: 'feishu', channel: 'chat-1' })
    const controller = new AbortController()
    controller.abort()
    await expect(h.ask({ signal: controller.signal })).resolves.toBe('cancelled')
    expect(h.pushes).toHaveLength(1)
  })

  it('drops resolutions minted outside this bridge', async () => {
    const h = await harness()
    h.channelOf.mockReturnValue({ provider: 'feishu', channel: 'chat-1' })
    const controller = new AbortController()
    const answer = h.ask({ signal: controller.signal })
    await rendered(h.pushes)
    h.decide('feishu', 'not-an-approval-action')
    h.decide('feishu', 'dsh-approval:not-a-uuid:not-an-outcome')
    controller.abort()
    await expect(answer).resolves.toBe('cancelled')
  })

  it('drops late resolutions for requests that are no longer pending', async () => {
    const h = await harness()
    h.channelOf.mockReturnValue({ provider: 'feishu', channel: 'chat-1' })
    const controller = new AbortController()
    const answer = h.ask({ signal: controller.signal })
    await rendered(h.pushes)
    controller.abort()
    await expect(answer).resolves.toBe('cancelled')
    // The bridge consumed the pending wait; a replayed click must not crash.
    const late = h.pushes[0].message.actions![0].id
    h.decide('feishu', late)
  })
})

describe('approver mapping', () => {
  it('rejects a decision from an unmapped sender', async () => {
    const h = await harness({ providers: ['feishu'], approvers: { 'boss-1': 'Alice' } })
    h.channelOf.mockReturnValue({ provider: 'feishu', channel: 'chat-1' })
    const answer = h.ask()
    await rendered(h.pushes)
    h.decide('feishu', h.pushes[0].message.actions![0].id, 'intruder')
    await expect(answer).resolves.toBe('rejected')
  })

  it('answers a mapped sender with the clicked outcome', async () => {
    const h = await harness({ providers: ['feishu'], approvers: { 'boss-1': 'Alice' } })
    h.channelOf.mockReturnValue({ provider: 'feishu', channel: 'chat-1' })
    const answer = h.ask()
    await rendered(h.pushes)
    h.decide('feishu', h.pushes[0].message.actions![1].id, 'boss-1')
    await expect(answer).resolves.toBe('rejected')
  })

  it('drops an unmapped sender click on a request that is no longer pending', async () => {
    const h = await harness({ providers: ['feishu'], approvers: { 'boss-1': 'Alice' } })
    h.channelOf.mockReturnValue({ provider: 'feishu', channel: 'chat-1' })
    const controller = new AbortController()
    const answer = h.ask({ signal: controller.signal })
    await rendered(h.pushes)
    controller.abort()
    await expect(answer).resolves.toBe('cancelled')
    h.decide('feishu', h.pushes[0].message.actions![0].id, 'intruder')
  })
})

describe('bridge unload', () => {
  it('registers one resolution consumer per provider', async () => {
    const h = await harness({ providers: ['feishu', 'dingtalk'] })
    expect(h.handlers.has('feishu')).toBe(true)
    expect(h.handlers.has('dingtalk')).toBe(true)
  })

  it('cancels every pending wait when the bridge unloads', async () => {
    const h = await harness()
    h.channelOf.mockReturnValue({ provider: 'feishu', channel: 'chat-1' })
    const answer = h.ask()
    await rendered(h.pushes)
    contexts.splice(contexts.indexOf(h.ctx), 1)
    await h.ctx.fiber.dispose()
    await expect(answer).resolves.toBe('cancelled')
  })
})

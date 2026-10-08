/** Fire-and-forget webhook rule registry and Workspace-backed Session runtime. */

import { Context, Service } from '@deepseek-ai/cordis'
import { errorChain } from '@deepseek-ai/dsh-llm'
import { deepFreeze, snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import type { WebhookRuleId } from './brand.ts'
import { createWebhookSession } from './session.ts'
import type { VerifiedWebhookDelivery, WebhookRule, WebhookSessionRequest } from './types.ts'

export * from './brand.ts'
export type * from './types.ts'
export { webhookDeliveryMessage } from './session.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webhookRuntime: WebhookRuntime
  }
}

/** Internal type erasure after public generic registration validates the provider kind. */
interface AnyWebhookRule {
  readonly id: WebhookRuleId
  readonly kind: string
  run(
    delivery: Readonly<VerifiedWebhookDelivery>,
    signal: AbortSignal,
  ): WebhookSessionRequest | null | Promise<WebhookSessionRequest | null>
}

/** One effect-owned rule registration and the invocations that currently use it. */
interface RuleRegistration {
  readonly rule: AnyWebhookRule
  readonly controller: AbortController
  readonly active: Set<Promise<boolean>>
  closing: boolean
  disposal?: Promise<void>
}

/**
 * Validate and detach one delivery before sharing it across arbitrary rules
 * or persisting it in durable storage.
 * @param delivery - provider data validated and copied at this boundary.
 * @returns a frozen lossless-JSON copy sharing no reference with the input.
 * @throws TypeError when kind, source, or deliveryId is not a non-empty string, when receivedAt
 * is not a non-negative safe integer, or when the value is not lossless JSON.
 */
export function snapshotDelivery(delivery: VerifiedWebhookDelivery): VerifiedWebhookDelivery {
  if (typeof delivery.kind !== 'string' || delivery.kind.trim() === '') {
    throw new TypeError('webhook delivery kind must be a non-empty string')
  }
  if (typeof delivery.source !== 'string' || delivery.source.trim() === '') {
    throw new TypeError('webhook delivery source must be a non-empty string')
  }
  if (typeof delivery.deliveryId !== 'string' || delivery.deliveryId.trim() === '') {
    throw new TypeError('webhook delivery id must be a non-empty string')
  }
  if (!Number.isSafeInteger(delivery.receivedAt) || delivery.receivedAt < 0) {
    throw new TypeError('webhook delivery receivedAt must be a non-negative safe integer')
  }
  const snapshot = snapshotJsonValue(delivery)
  if (snapshot === undefined) throw new TypeError('webhook delivery must be lossless JSON')
  return deepFreeze(snapshot)
}

/** Fire-and-forget rule runtime. Session creation is the only built-in action. */
export class WebhookRuntime extends Service {
  static inject = [
    'agents',
    'agentDefaultModel',
    'agentPresets',
    'permissionPresets',
    'sessionTitle',
    'workspaceRegistry',
  ]

  private readonly rules = new Map<WebhookRuleId, RuleRegistration>()
  private readonly selfCtx: Context
  private closing = false

  constructor(ctx: Context) {
    super(ctx, 'webhookRuntime')
    this.selfCtx = ctx
    ctx.effect(() => async () => {
      this.closing = true
      /* v8 ignore next -- caller-owned registration effects normally dispose first; this covers provider-first unload. */
      await Promise.all(
        [...this.rules.values()].map(rule => this.disposeRegistration(rule)),
      )
    }, 'webhookRuntime.lifecycle()')
  }

  /**
   * Register one trusted programmatic rule.
   * @param rule - unique id, provider kind, and arbitrary callback.
   * @returns awaitable effect disposer that aborts and drains this rule's active callbacks.
   */
  register<K extends string>(rule: WebhookRule<K>): () => Promise<void> {
    if (this.closing) throw new Error('webhook runtime is closing')
    if (typeof rule.id !== 'string' || rule.id.trim() === '') {
      throw new TypeError('webhook rule id must be a non-empty string')
    }
    if (typeof rule.kind !== 'string' || rule.kind.trim() === '') {
      throw new TypeError(`webhook rule "${String(rule.id)}" kind must be a non-empty string`)
    }
    if (typeof rule.run !== 'function') {
      throw new TypeError(`webhook rule "${String(rule.id)}" requires run()`)
    }

    // The public generic preserves adapter-specific authoring types. The runtime
    // stores one erased callback after validating the shared provider tag.
    const erased = rule as AnyWebhookRule
    let registration!: RuleRegistration
    const disposeEffect = this.ctx.effect(() => {
      /* v8 ignore next -- no await separates the public liveness check from this initializer. */
      if (this.closing) throw new Error('webhook runtime is closing')
      if (this.rules.has(rule.id)) throw new Error(`webhook rule "${rule.id}" is already registered`)
      registration = {
        rule: erased,
        controller: new AbortController(),
        active: new Set(),
        closing: false,
      }
      this.rules.set(rule.id, registration)
      return () => this.disposeRegistration(registration)
    }, `webhookRuntime.register(${rule.id})`)
    return async () => { await disposeEffect() }
  }

  /**
   * Start every currently matching rule and return before any callback settles.
   * @param delivery - authenticated provider data; snapshotted before dispatch.
   * @throws synchronously when the runtime is closing or the delivery is malformed.
   */
  dispatch<K extends string>(delivery: VerifiedWebhookDelivery<K>): void {
    if (this.closing) throw new Error('webhook runtime is closing')
    const snapshot = snapshotDelivery(delivery)
    for (const registration of this.matchingRegistrations(snapshot)) {
      void this.startInvocation(registration, snapshot)
    }
  }

  /**
   * Dispatch a delivery and await what became of it.
   * @param delivery - authenticated provider data; snapshotted before dispatch.
   * @returns `true` only when at least one rule matched and every invocation this call
   * started settled successfully; `false` when no rule matched or any invocation failed.
   * @throws synchronously when the runtime is closing or the delivery is malformed.
   */
  dispatchAcknowledged<K extends string>(delivery: VerifiedWebhookDelivery<K>): Promise<boolean> {
    if (this.closing) throw new Error('webhook runtime is closing')
    const snapshot = snapshotDelivery(delivery)
    const invocations = this.matchingRegistrations(snapshot)
      .map(registration => this.startInvocation(registration, snapshot))
    if (invocations.length === 0) return Promise.resolve(false)
    return Promise.all(invocations).then(outcomes => outcomes.every(succeeded => succeeded))
  }

  /** Registrations currently eligible for one snapshotted delivery. */
  private matchingRegistrations(delivery: VerifiedWebhookDelivery): RuleRegistration[] {
    return [...this.rules.values()].filter(
      registration => !registration.closing && registration.rule.kind === delivery.kind,
    )
  }

  /**
   * Start one contained invocation and attach it to registration teardown.
   * @returns `true` when the rule and any Session creation settled successfully, `false` after a contained failure.
   */
  private startInvocation(registration: RuleRegistration, delivery: VerifiedWebhookDelivery): Promise<boolean> {
    const tracked = Promise.resolve().then(async (): Promise<boolean> => {
      registration.controller.signal.throwIfAborted()
      const request = await registration.rule.run(delivery, registration.controller.signal)
      registration.controller.signal.throwIfAborted()
      if (request !== null) {
        await createWebhookSession(
          this.selfCtx,
          delivery,
          registration.rule.id,
          request,
          registration.controller.signal,
        )
      }
      return true
    }).catch((error: unknown): boolean => {
      const invocation = `webhook: provider=${JSON.stringify(delivery.kind)} source=${JSON.stringify(delivery.source)} `
        + `delivery=${JSON.stringify(delivery.deliveryId)} rule=${JSON.stringify(registration.rule.id)}`
      if (registration.controller.signal.aborted) {
        this.selfCtx.logger.debug(`${invocation} stopped after disposal: ${errorChain(error)}`)
      } else {
        this.selfCtx.logger.warn(`${invocation} failed: ${errorChain(error)}`)
      }
      return false
    }).finally(() => {
      registration.active.delete(tracked)
    })
    registration.active.add(tracked)
    return tracked
  }

  /** Memoized registration teardown: hide, abort, then drain. */
  private disposeRegistration(registration: RuleRegistration): Promise<void> {
    registration.disposal ??= (async () => {
      registration.closing = true
      this.rules.delete(registration.rule.id)
      registration.controller.abort(new Error(`webhook rule "${registration.rule.id}" was disposed`))
      while (registration.active.size > 0) {
        await Promise.allSettled([...registration.active])
      }
    })()
    return registration.disposal
  }
}

export default WebhookRuntime

/**
 * Approval bridge for the connector seam. One plugin instance answers
 * `approval/request` waterfall events for Sessions bound to a connector
 * channel: it pushes an interactive outbound message carrying one action per
 * bridgeable outcome, waits for the platform's interactive callback to arrive
 * as a durable connector resolution, and answers the waterfall with the
 * clicked outcome. An aborted request settles `cancelled`; a bridge unload
 * cancels every pending wait; every other failure — including the push
 * itself — fails the request closed. Clicks on action ids this bridge did
 * not mint, and resolutions for requests that are no longer pending, are
 * logged and dropped.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-connector-approval
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-connector'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { bridgeActionId, decodeBridgeActionId, BridgedOutcome, Config } from './types.ts'

export { bridgeActionId, decodeBridgeActionId, Config }
export type { BridgedOutcome }

/** Cordis function-plugin name. */
export const name = 'connector-approval'

/** Host services required before the bridge can register. */
export const inject = ['connector']

/** Default button label deciding `allowed-once`. */
export const DEFAULT_ALLOW_LABEL = 'Approve'

/** Default button label deciding `rejected`. */
export const DEFAULT_REJECT_LABEL = 'Reject'

/** Validate the provider list shape Schemastery cannot fully express. */
function assertConfig(config: Config): void {
  if (config.providers.length === 0) {
    throw new Error('connector-approval providers must list at least one connector provider')
  }
  if (config.providers.some(provider => typeof provider !== 'string' || provider.trim() === '')) {
    throw new Error('connector-approval providers must be non-empty strings')
  }
  const approvers = config.approvers
  if (approvers === undefined) return
  if (Object.keys(approvers).length === 0) {
    throw new Error('connector-approval approvers must map at least one sender id; omit it to allow every channel member')
  }
  for (const [sender, identity] of Object.entries(approvers)) {
    if (sender.trim() === '' || typeof identity !== 'string' || identity.trim() === '') {
      throw new Error('connector-approval approvers must map non-empty sender ids to non-empty identities')
    }
  }
}

/**
 * The cancellation leg of one request's decision race: settles `'cancelled'`
 * when the request's signal aborts. The disposer removes the abort listener
 * once another leg wins, so one signal can serve many waits without
 * accumulating listeners.
 * @param signal - the pending request's cancellation lifetime.
 * @returns the cancellation leg and its disposer.
 */
function cancellationLeg(signal: AbortSignal): { readonly promise: Promise<ApprovalOutcome>; readonly dispose: () => void } {
  let onAbort: (() => void) | undefined
  const promise = new Promise<ApprovalOutcome>((resolve) => {
    if (signal.aborted) {
      resolve('cancelled')
      return
    }
    onAbort = (): void => { resolve('cancelled') }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  return {
    promise,
    dispose: () => {
      if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
    },
  }
}

/**
 * Register the approval bridge: the `approval/request` waterfall listener and
 * one resolution consumer per configured provider.
 * @param ctx - the plugin context (must inject `connector`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  assertConfig(config)
  const allowLabel = config.allowLabel ?? DEFAULT_ALLOW_LABEL
  const rejectLabel = config.rejectLabel ?? DEFAULT_REJECT_LABEL
  const approvers = config.approvers
  /** One pending platform decision per in-flight approval request. */
  const pending = new Map<string, PromiseWithResolvers<ApprovalOutcome>>()

  const disposeListener = ctx.on('approval/request', async (req: ApprovalRequest, next) => {
    const channel = ctx.connector.channelOf(req.agent.id)
    if (channel === undefined) return next()
    const correlationId = randomUUID()
    const wait = Promise.withResolvers<ApprovalOutcome>()
    pending.set(correlationId, wait)
    const cancelled = req.signal === undefined ? undefined : cancellationLeg(req.signal)
    try {
      // Registered before the push: the platform callback can only arrive
      // after the card renders, but an early resolution must never be lost.
      await ctx.connector.push(channel, {
        text: `${req.toolName} requests approval${req.reason === undefined ? '' : `: ${req.reason}`}`,
        actions: [
          { id: bridgeActionId(correlationId, 'allowed-once' satisfies BridgedOutcome), label: allowLabel, style: 'primary' },
          { id: bridgeActionId(correlationId, 'rejected' satisfies BridgedOutcome), label: rejectLabel, style: 'danger' },
        ],
      }, req.signal)
      return await Promise.race([
        wait.promise,
        ...(cancelled === undefined ? [] : [cancelled.promise]),
      ])
    } finally {
      cancelled?.dispose()
      pending.delete(correlationId)
    }
  })

  const disposeHandlers = config.providers.map((provider) => {
    return ctx.connector.resolutions(provider, (message) => {
      const decoded = decodeBridgeActionId(message.resolution.actionId)
      if (decoded === undefined) {
        ctx.logger.warn(`connector-approval: ignoring a resolution this bridge did not mint (${message.resolution.actionId}) from ${message.sender}`)
        return
      }
      // Default-deny: when an approver map is configured, an unmapped sender
      // may not decide, so the request settles rejected instead of staying
      // pending until it is cancelled.
      const identity = approvers?.[message.sender]
      if (approvers !== undefined && identity === undefined) {
        ctx.logger.warn(`connector-approval: rejecting an approval decided by unmapped sender ${message.sender}`)
        pending.get(decoded.correlationId)?.resolve('rejected')
        return
      }
      const wait = pending.get(decoded.correlationId)
      if (wait === undefined) {
        ctx.logger.warn(`connector-approval: ignoring a late or unknown resolution from ${message.sender}`)
        return
      }
      ctx.logger.info(`connector-approval: ${decoded.outcome} decided by ${identity} (${message.sender})`)
      wait.resolve(decoded.outcome)
    })
  })

  ctx.effect(() => () => {
    disposeListener()
    for (const dispose of disposeHandlers) dispose()
    // An unloading bridge cannot receive decisions anymore: cancel every
    // pending wait so requests fail visibly instead of waiting forever.
    for (const wait of pending.values()) wait.resolve('cancelled')
    pending.clear()
  }, 'connector-approval: bridge')
}

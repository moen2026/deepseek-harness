/**
 * Service Definition for the notification capability seam (`ctx.notification`):
 * a single-provider reservation registry and one order-independent route —
 * notify — over provider-agnostic alerts.
 *
 * A provider reserves the seam exclusively: {@link Notification.registerProvider}
 * validates and conflict-checks before mutating, so an invalid or conflicting
 * registration publishes nothing, and its disposer releases the reservation.
 * Only one provider may hold the seam at a time — the alert channel is a
 * deployment-wide choice, not a per-caller route. The seam exposes the one
 * operation and no protocol escape hatch.
 * @module @deepseek-ai/dsh-notification
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { NotificationError } from './types.ts'
import type {
  NotificationProvider,
  NotificationRequest,
  NotificationService,
} from './types.ts'

export {
  NotificationError,
} from './types.ts'
export type {
  NotificationErrorCode,
  NotificationProvider,
  NotificationRequest,
  NotificationService,
  NotificationUrgency,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    notification: NotificationService
  }
}

/**
 * `ctx.notification`. Holds the single reserved provider; the reservation and
 * the route are populated and cleared together so a route always has a live provider.
 */
export class Notification extends Service implements NotificationService {
  private provider: NotificationProvider | undefined

  constructor(ctx: Context) {
    super(ctx, 'notification')
  }

  registerProvider(provider: NotificationProvider): () => void {
    // Validate and conflict-check BEFORE any mutation: an invalid or conflicting
    // registration must publish nothing (fail-loud, all-or-nothing).
    if (provider.id.trim() === '') {
      throw new NotificationError('a notification provider id must be a non-empty string', 'NOTIFICATION_INVALID_PROVIDER')
    }
    if (this.provider !== undefined) {
      throw new NotificationError(
        `notification seam is already held by provider "${this.provider.id}"`,
        'NOTIFICATION_CONFLICT',
      )
    }

    const dispose = this.ctx.effect(function* (this: Notification) {
      this.provider = provider
      yield () => {
        this.provider = undefined
      }
    }.bind(this), 'notification.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is synchronous
    // fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /** The single reserved provider or a fail-loud `NOTIFICATION_UNAVAILABLE`. */
  private requireProvider(): NotificationProvider {
    const provider = this.provider
    if (provider === undefined) {
      throw new NotificationError('no notification provider is registered', 'NOTIFICATION_UNAVAILABLE')
    }
    return provider
  }

  async notify(request: NotificationRequest, signal?: AbortSignal): Promise<void> {
    return this.requireProvider().notify(request, signal)
  }
}

export default Notification

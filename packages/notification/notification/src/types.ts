/**
 * Vocabulary for the notification capability seam (`ctx.notification`): one
 * provider-agnostic alert request, the provider contract that reserves the
 * seam, and the `NotificationService` surface consumers call.
 * @module @deepseek-ai/dsh-notification/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * Stable, machine-routable codes for notification failures, carried on
 * {@link NotificationError} so callers branch on `code` instead of parsing `message`.
 */
export type NotificationErrorCode =
  | 'NOTIFICATION_INVALID_PROVIDER'
  | 'NOTIFICATION_CONFLICT'
  | 'NOTIFICATION_UNAVAILABLE'
  | 'NOTIFICATION_PROVIDER_FAILED'

/**
 * Structured notification failure. Extends {@link HarnessError} with one
 * {@link NotificationErrorCode}.
 */
export class NotificationError extends HarnessError {
  override readonly code: NotificationErrorCode

  constructor(message: string, code: NotificationErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/** How prominently a platform should surface an alert. */
export type NotificationUrgency = 'low' | 'normal' | 'critical'

/**
 * One alert a consumer asks the provider to surface to the operator. The
 * provider owns how a platform renders it — icon, sound, persistence, and
 * click behavior stay provider concerns, so they are not part of this vocabulary.
 */
export interface NotificationRequest {
  /** Short alert title shown first. */
  readonly title: string
  /** Alert body text shown under the title. */
  readonly body: string
  /** Stable dedup or grouping key a provider may coalesce sibling alerts on. */
  readonly tag?: string
  /** Prominence hint; providers map it onto their platform's priority where one exists. */
  readonly urgency?: NotificationUrgency
}

/**
 * A backend that reserves `ctx.notification` and surfaces alerts on one
 * platform (desktop shell, browser, …). The provider owns delivery mechanics
 * and platform capability checks; the seam only routes.
 */
export interface NotificationProvider {
  /** Opaque provider identity reserved atomically at registration. */
  readonly id: string
  /**
   * Surface one alert against the provider's platform. A provider whose
   * delivery is a local handoff returns `void`; the seam's notify route
   * still resolves a promise for every accepted alert.
   * @param request - the alert to surface.
   * @param signal - cancellation honored across the request's I/O.
   */
  notify(request: NotificationRequest, signal?: AbortSignal): void | Promise<void>
}

/**
 * The `ctx.notification` surface: a single-provider reservation registry plus
 * the routed `notify` operation. The seam exposes no protocol escape hatch —
 * platform mechanics are the provider's private concern.
 */
export interface NotificationService {
  /**
   * Reserve the seam for one provider. Validate and conflict-check everything
   * before mutating: an invalid or conflicting registration publishes nothing,
   * and its disposer releases the reservation.
   * @param provider - the backend claiming the seam.
   * @returns a synchronous disposer releasing this provider's reservation.
   */
  registerProvider(provider: NotificationProvider): () => void
  /**
   * Route one alert to the registered provider.
   * @param request - the alert to surface.
   * @param signal - cancellation forwarded to the provider.
   * @throws {@link NotificationError} with `NOTIFICATION_UNAVAILABLE` when no provider is registered.
   */
  notify(request: NotificationRequest, signal?: AbortSignal): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One alert was accepted by the seam and is republished for surface
     * consumers. A provider whose delivery path is a forwarded Host event
     * emits this on every accepted request; deployments without such a
     * forwarder have no listener.
     * @mode emit
     * @param alert - the accepted alert, as the caller raised it.
     */
    'notification/raised'(alert: NotificationRequest): void
  }
}

/**
 * Browser-surface notification provider for `ctx.notification`. One plugin
 * instance reserves the seam and republishes every accepted alert as the
 * process-local `notification/raised` event; an application whose forwarded
 * event allowlist carries that event to a Client lets the browser surface
 * present it through the Web Notification API.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-notification-web
 */

import type { Context } from '@deepseek-ai/cordis'
import type { NotificationProvider, NotificationRequest } from '@deepseek-ai/dsh-notification'

/** Cordis plugin name for loader diagnostics. */
export const name = 'notification-web'

/** Services required by this plugin. */
export const inject = ['notification']

/** Stable provider identity reserved on the seam. */
export const WEB_PROVIDER_ID = 'web'

/**
 * Build the web provider over one publish sink.
 * @param publish - receives every accepted alert for Client delivery.
 * @returns the provider registered on the seam.
 */
export function createWebNotificationProvider(publish: (request: NotificationRequest) => void): NotificationProvider {
  return {
    id: WEB_PROVIDER_ID,
    notify: (request: NotificationRequest): void => { publish(request) },
  }
}

/**
 * Reserve the seam with the Web surface provider.
 * @param ctx - the plugin context (must inject `notification`).
 */
export function apply(ctx: Context): void {
  ctx.notification.registerProvider(createWebNotificationProvider((request) => {
    ctx.emit('notification/raised', request)
  }))
}

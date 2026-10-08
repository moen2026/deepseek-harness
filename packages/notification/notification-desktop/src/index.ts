/**
 * Electron-shell notification provider for `ctx.notification`. One plugin
 * instance reserves the seam and forwards every accepted alert over the
 * Desktop Host IPC channel, where the Electron main process raises a native
 * notification. The channel is the Host process's own `process.send`; mounting
 * this provider without that channel fails at load instead of silently
 * dropping every alert.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-notification-desktop
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  NotificationError,
  type NotificationProvider,
  type NotificationRequest,
  type NotificationUrgency,
} from '@deepseek-ai/dsh-notification'

/** Cordis plugin name for loader diagnostics. */
export const name = 'notification-desktop'

/** Services required by this plugin. */
export const inject = ['notification']

/** Stable provider identity reserved on the seam. */
export const DESKTOP_PROVIDER_ID = 'desktop'

/** One alert forwarded to the Electron shell over the Host IPC channel. */
export interface DesktopAlertMessage {
  readonly type: 'desktop-notification'
  /** Alert title as raised. */
  readonly title: string
  /** Alert body as raised. */
  readonly body: string
  /** Dedup or grouping key as raised, when the caller supplied one. */
  readonly tag?: string
  /** Prominence hint as raised, when the caller supplied one. */
  readonly urgency?: NotificationUrgency
}

/** Sink every accepted alert is forwarded to. */
export type DesktopAlertChannel = (message: DesktopAlertMessage) => void

/**
 * Build the desktop provider over one alert channel.
 * @param channel - the sink every accepted alert is forwarded to.
 * @returns the provider registered on the seam.
 */
export function createDesktopNotificationProvider(channel: DesktopAlertChannel): NotificationProvider {
  return {
    id: DESKTOP_PROVIDER_ID,
    notify: (request: NotificationRequest): void => {
      channel({
        type: 'desktop-notification',
        title: request.title,
        body: request.body,
        ...request.tag === undefined ? {} : { tag: request.tag },
        ...request.urgency === undefined ? {} : { urgency: request.urgency },
      })
    },
  }
}

/**
 * Reserve the seam with the Desktop shell provider.
 * @param ctx - the plugin context (must inject `notification`).
 */
export function apply(ctx: Context): void {
  if (process.send === undefined) {
    // The Desktop provider is mountable only where the Desktop Host IPC channel
    // exists; mounting it elsewhere is a misconfiguration that must fail at load.
    throw new NotificationError(
      'notification-desktop requires the Desktop Host IPC channel',
      'NOTIFICATION_UNAVAILABLE',
    )
  }
  ctx.notification.registerProvider(
    createDesktopNotificationProvider((message) => {
      // Call as a method on `process` so the native sender keeps its receiver; a
      // channel closed after load surfaces on the call itself.
      process.send?.(message)
    }),
  )
}

/**
 * Notification surface plugin, browser half: presents Host-raised alerts
 * through the Web Notification API. Every accepted alert arrives on the
 * forwarded `notification/raised` event; an alert is presented only when the
 * browser already granted permission — permission stays the user's decision,
 * never a side effect of an alert.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the forwarded alert event declaration and its payload vocabulary.
import type { NotificationRequest } from '@deepseek-ai/dsh-notification/types'

/** Required services: the forwarded Host event stream. */
export const inject = ['remote']

/** The Web Notification API surface this plugin presents through. */
export interface WebNotificationApi {
  /** Current permission for this origin; alerts present only when `'granted'`. */
  readonly permission: string
  /** Construct and show one notification. */
  new (title: string, options?: { readonly body: string; readonly tag?: string }): unknown
}

/**
 * Present one alert when the browser granted permission, and drop it otherwise.
 * The DOM lib types the global API non-optional; the caller passes the read in
 * as `| undefined` so the absent-API check stays honest.
 * @param alert - the accepted alert forwarded by the Host.
 * @param api - the platform constructor, undefined in browsers without the API.
 */
function present(alert: NotificationRequest, api: WebNotificationApi | undefined): void {
  if (api === undefined || api.permission !== 'granted') return
  new api(alert.title, { body: alert.body, ...alert.tag === undefined ? {} : { tag: alert.tag } })
}

/**
 * Client plugin body: present every forwarded alert through the Web Notification API.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.remote.$on('notification/raised', (alert) => { present(alert, globalThis.Notification) }), 'ui-notification: alerts')
}

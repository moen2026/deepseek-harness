import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Notification, { type NotificationRequest } from '@deepseek-ai/dsh-notification'
import {
  apply,
  createWebNotificationProvider,
  WEB_PROVIDER_ID,
} from '@deepseek-ai/dsh-notification-web'

/** Mount the notification seam on a fresh root context. */
async function mountNotification(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Notification)
  return ctx
}

/** Mount the web provider as a fiber so disposal releases the seam. */
function mountWebProvider(ctx: Context) {
  return ctx.plugin(Object.assign((inner: Context) => { apply(inner) }, { inject: ['notification'] }))
}

describe('createWebNotificationProvider', () => {
  it('forwards the request verbatim to the publish sink', async () => {
    const seen: NotificationRequest[] = []
    const provider = createWebNotificationProvider((request) => { seen.push(request) })
    expect(provider.id).toBe(WEB_PROVIDER_ID)
    const request: NotificationRequest = { title: 'Build finished', body: 'All tests passed', tag: 'build' }
    await provider.notify(request)
    expect(seen[0]).toBe(request)
  })
})

describe('notification-web apply', () => {
  it('republishes every accepted alert as notification/raised', async () => {
    const ctx = await mountNotification()
    await mountWebProvider(ctx)
    const seen: NotificationRequest[] = []
    ctx.on('notification/raised', (alert: NotificationRequest): void => { seen.push(alert) })
    const request: NotificationRequest = { title: 'Build finished', body: 'All tests passed' }
    await ctx.notification.notify(request)
    expect(seen[0]).toBe(request)
  })

  it('releases the seam when the contributing fiber is disposed', async () => {
    const ctx = await mountNotification()
    const fiber = await mountWebProvider(ctx)
    await fiber.dispose()
    await expect(ctx.notification.notify({ title: 't', body: 'b' }))
      .rejects.toThrow(expect.objectContaining({ code: 'NOTIFICATION_UNAVAILABLE' }))
  })
})

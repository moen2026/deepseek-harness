import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Notification, { type NotificationRequest } from '@deepseek-ai/dsh-notification'
import {
  apply,
  createDesktopNotificationProvider,
  DESKTOP_PROVIDER_ID,
  type DesktopAlertMessage,
} from '@deepseek-ai/dsh-notification-desktop'

/**
 * Run `body` with `process.send` replaced by `stub`, restoring the previous
 * property descriptor afterwards so the surrounding test process is untouched.
 */
async function withProcessSend(
  stub: ((message: unknown) => boolean) | undefined,
  body: () => Promise<void>,
): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(process, 'send')
  Object.defineProperty(process, 'send', { value: stub, configurable: true, writable: true })
  try {
    await body()
  } finally {
    if (original === undefined) {
      Reflect.deleteProperty(process, 'send')
    } else {
      Object.defineProperty(process, 'send', original)
    }
  }
}

/** Mount the notification seam on a fresh root context. */
async function mountNotification(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Notification)
  return ctx
}

/** Mount the desktop provider as a fiber so disposal releases the seam. */
function mountDesktopProvider(ctx: Context) {
  return ctx.plugin(Object.assign((inner: Context) => { apply(inner) }, { inject: ['notification'] }))
}

describe('createDesktopNotificationProvider', () => {
  it('forwards title, body, tag, and urgency as one desktop-notification message', async () => {
    const seen: DesktopAlertMessage[] = []
    const provider = createDesktopNotificationProvider((message) => { seen.push(message) })
    expect(provider.id).toBe(DESKTOP_PROVIDER_ID)
    const request: NotificationRequest = {
      title: 'Build finished',
      body: 'All tests passed',
      tag: 'build',
      urgency: 'critical',
    }
    await provider.notify(request)
    expect(seen).toEqual([{
      type: 'desktop-notification',
      title: 'Build finished',
      body: 'All tests passed',
      tag: 'build',
      urgency: 'critical',
    }])
  })

  it('omits tag and urgency when the caller left them out', async () => {
    const seen: DesktopAlertMessage[] = []
    const provider = createDesktopNotificationProvider((message) => { seen.push(message) })
    await provider.notify({ title: 'Build finished', body: 'All tests passed' })
    expect(seen).toEqual([{
      type: 'desktop-notification',
      title: 'Build finished',
      body: 'All tests passed',
    }])
    expect(seen[0]).not.toHaveProperty('tag')
    expect(seen[0]).not.toHaveProperty('urgency')
  })
})

describe('notification-desktop apply', () => {
  it('fails at load with NOTIFICATION_UNAVAILABLE when the Host IPC channel is absent', async () => {
    await withProcessSend(undefined, async () => {
      const ctx = await mountNotification()
      expect(() => { apply(ctx) })
        .toThrow(expect.objectContaining({ code: 'NOTIFICATION_UNAVAILABLE' }))
    })
  })

  it('routes notify through the IPC channel and releases the seam on dispose', async () => {
    const sent: unknown[] = []
    await withProcessSend((message) => {
      sent.push(message)
      return true
    }, async () => {
      const ctx = await mountNotification()
      const fiber = await mountDesktopProvider(ctx)
      await ctx.notification.notify({ title: 'Build finished', body: 'All tests passed' })
      expect(sent).toEqual([{
        type: 'desktop-notification',
        title: 'Build finished',
        body: 'All tests passed',
      }])
      await fiber.dispose()
      await expect(ctx.notification.notify({ title: 't', body: 'b' }))
        .rejects.toThrow(expect.objectContaining({ code: 'NOTIFICATION_UNAVAILABLE' }))
    })
  })
})

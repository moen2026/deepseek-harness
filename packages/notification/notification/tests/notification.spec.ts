import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Notification, {
  NotificationError,
  type NotificationProvider,
  type NotificationRequest,
} from '@deepseek-ai/dsh-notification'

/** A scripted provider that records every alert it receives and resolves. */
function makeProvider(id: string, overrides: Partial<NotificationProvider> = {}): NotificationProvider & {
  seenRequests: NotificationRequest[]
  seenSignals: (AbortSignal | undefined)[]
} {
  const seenRequests: NotificationRequest[] = []
  const seenSignals: (AbortSignal | undefined)[] = []
  return {
    id,
    seenRequests,
    seenSignals,
    notify(request, signal) {
      seenRequests.push(request)
      seenSignals.push(signal)
      return Promise.resolve()
    },
    ...overrides,
  }
}

/** Mount the notification seam on a fresh root context. */
async function mountNotification(): Promise<{ ctx: Context; notification: Notification }> {
  const ctx = new Context()
  await ctx.plugin(Notification)
  return { ctx, notification: ctx.notification as Notification }
}

describe('Notification registration', () => {
  it('fails NOTIFICATION_UNAVAILABLE on the route when no provider is registered', async () => {
    const { notification } = await mountNotification()
    await expect(notification.notify({ title: 't', body: 'b' }))
      .rejects.toThrow(expect.objectContaining({ code: 'NOTIFICATION_UNAVAILABLE' }))
  })

  it('routes notify to the reserved provider and releases on dispose', async () => {
    const { notification } = await mountNotification()
    const provider = makeProvider('p')
    const dispose = notification.registerProvider(provider)

    const request: NotificationRequest = { title: 'Build finished', body: 'All tests passed', tag: 'build' }
    await expect(notification.notify(request)).resolves.toBeUndefined()
    expect(provider.seenRequests[0]).toBe(request)

    dispose()
    await expect(notification.notify({ title: 't', body: 'b' }))
      .rejects.toThrow(expect.objectContaining({ code: 'NOTIFICATION_UNAVAILABLE' }))
  })

  it('forwards the abort signal verbatim to the provider', async () => {
    const { notification } = await mountNotification()
    const provider = makeProvider('p')
    notification.registerProvider(provider)
    const controller = new AbortController()
    await notification.notify({ title: 't', body: 'b' }, controller.signal)
    expect(provider.seenSignals[0]).toBe(controller.signal)
  })

  it('rejects an empty provider id (NOTIFICATION_INVALID_PROVIDER) and reserves nothing', async () => {
    const { notification } = await mountNotification()
    expect(() => notification.registerProvider(makeProvider('  ')))
      .toThrow(expect.objectContaining({ code: 'NOTIFICATION_INVALID_PROVIDER' }))
    await expect(notification.notify({ title: 't', body: 'b' }))
      .rejects.toThrow(expect.objectContaining({ code: 'NOTIFICATION_UNAVAILABLE' }))
  })

  it('rejects a second provider while the seam is held (NOTIFICATION_CONFLICT)', async () => {
    const { notification } = await mountNotification()
    notification.registerProvider(makeProvider('first'))
    expect(() => notification.registerProvider(makeProvider('second')))
      .toThrow(expect.objectContaining({ code: 'NOTIFICATION_CONFLICT' }))
  })

  it('allows re-registration after dispose releases the reservation', async () => {
    const { notification } = await mountNotification()
    const dispose = notification.registerProvider(makeProvider('first'))
    dispose()
    expect(() => notification.registerProvider(makeProvider('second'))).not.toThrow()
  })

  it('disposes the reservation when the contributing fiber is disposed', async () => {
    const { ctx, notification } = await mountNotification()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.notification.registerProvider(makeProvider('p'))
    }, { inject: ['notification'] }))
    await expect(notification.notify({ title: 't', body: 'b' })).resolves.toBeUndefined()
    await fiber.dispose()
    await expect(notification.notify({ title: 't', body: 'b' }))
      .rejects.toThrow(expect.objectContaining({ code: 'NOTIFICATION_UNAVAILABLE' }))
  })

  it('NotificationError carries its structured code', () => {
    expect(new NotificationError('m', 'NOTIFICATION_PROVIDER_FAILED').code).toBe('NOTIFICATION_PROVIDER_FAILED')
  })
})

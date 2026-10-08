import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NotificationRequest } from '@deepseek-ai/dsh-notification/types'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'

interface Presented {
  readonly title: string
  readonly options?: { readonly body: string; readonly tag?: string }
}

const notices: Presented[] = []

class Notice {
  static permission = 'granted'
  constructor(readonly title: string, readonly options?: { readonly body: string; readonly tag?: string }) {
    notices.push(options === undefined ? { title } : { title, options })
  }
}

interface RemoteStubInput {
  $on: (event: 'notification/raised', listener: (alert: NotificationRequest) => void) => () => void
}

// A Service preserves the associated namespace lookup used by the real Gateway.
class RemoteStub extends Service {
  constructor(ctx: Context, readonly $on: RemoteStubInput['$on']) {
    super(ctx, 'remote')
  }
}

async function baseContext(input: RemoteStubInput) {
  const ctx = new Context()
  new RemoteStub(ctx, input.$on)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

function capture() {
  let listener: ((alert: NotificationRequest) => void) | undefined
  const unsubscribe = vi.fn()
  const $on = vi.fn((_event: 'notification/raised', next: (alert: NotificationRequest) => void) => {
    listener = next
    return unsubscribe
  })
  return {
    $on,
    alert: (alert: NotificationRequest): void => { listener!(alert) },
    unsubscribe,
  }
}

afterEach(() => { notices.length = 0; vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('ui-notification browser half', () => {
  it('declares only the remote service', () => {
    expect(inject).toEqual(['remote'])
  })

  it('presents every forwarded alert through the Web Notification API and unsubscribes on dispose', async () => {
    vi.stubGlobal('Notification', Notice)
    const captured = capture()
    const { ctx, fiber } = await baseContext({ $on: captured.$on })
    expect(captured.$on).toHaveBeenCalledWith('notification/raised', expect.any(Function))
    captured.alert({ title: 'Approval waiting', body: 'A tool request awaits your approval', tag: 'approval-7', urgency: 'critical' })
    captured.alert({ title: 'Turn complete', body: 'The session finished responding' })
    expect(notices.map(notice => ({ title: notice.title, options: notice.options }))).toEqual([
      { title: 'Approval waiting', options: { body: 'A tool request awaits your approval', tag: 'approval-7' } },
      { title: 'Turn complete', options: { body: 'The session finished responding' } },
    ])
    await fiber.dispose()
    expect(captured.unsubscribe).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('drops alerts while the browser withholds permission', async () => {
    class Denied {
      static permission = 'denied'
      constructor() { throw new Error('the surface must not construct a denied notification') }
    }
    vi.stubGlobal('Notification', Denied)
    const captured = capture()
    const { ctx, fiber } = await baseContext({ $on: captured.$on })
    captured.alert({ title: 'Turn complete', body: 'The session finished responding' })
    expect(notices).toHaveLength(0)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('drops alerts when the browser has no Notification API', async () => {
    vi.stubGlobal('Notification', undefined)
    const captured = capture()
    const { ctx, fiber } = await baseContext({ $on: captured.$on })
    captured.alert({ title: 'Turn complete', body: 'The session finished responding' })
    expect(notices).toHaveLength(0)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})

describe('ui-notification node half', () => {
  it('keeps the node half inert', () => {
    expect(applyNode).not.toThrow()
  })
})

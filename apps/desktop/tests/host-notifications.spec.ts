import { afterEach, expect, it, vi } from 'vitest'
import type { DesktopAlertMessage } from '@deepseek-ai/dsh-notification-desktop'
import { DesktopHostNotifications } from '../src/host-notifications.ts'

const native = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const notices: Notice[] = []
  class Notice extends EventEmitter {
    static isSupported = vi.fn(() => true)
    show = vi.fn()
    constructor(readonly options: unknown) { super(); notices.push(this) }
  }
  return { notices, Notice }
})
vi.mock('electron', () => ({ Notification: native.Notice }))

const withUrgency: DesktopAlertMessage = {
  type: 'desktop-notification', title: 'Reminder due', body: 'Task #1 is due', tag: 'schedule-1', urgency: 'critical',
}
const plain: DesktopAlertMessage = { type: 'desktop-notification', title: 'Goal reached', body: 'Objective complete' }

afterEach(() => { native.notices.length = 0; vi.clearAllMocks(); native.Notice.isSupported.mockReturnValue(true) })

it('presents each Host alert natively and focuses the primary window on click', () => {
  const focus = vi.fn()
  const notifications = new DesktopHostNotifications(focus)
  notifications.present(withUrgency)
  notifications.present(plain)
  expect(native.notices).toHaveLength(2)
  expect(native.notices[0]!.options).toEqual({ title: 'Reminder due', body: 'Task #1 is due', silent: false })
  expect(native.notices[1]!.options).toEqual({ title: 'Goal reached', body: 'Objective complete' })
  native.notices[0]!.emit('click')
  native.notices[1]!.emit('click')
  expect(focus).toHaveBeenCalledTimes(2)
  expect(native.notices[0]!.show).toHaveBeenCalledOnce()
})

it('keeps a quiet urgency silent', () => {
  const notifications = new DesktopHostNotifications(() => {})
  notifications.present({ ...withUrgency, urgency: 'low' })
  expect(native.notices[0]!.options).toEqual({ title: 'Reminder due', body: 'Task #1 is due', silent: true })
})

it('drops alerts without native support and swallows a failing platform', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const notifications = new DesktopHostNotifications(() => {})
  native.Notice.isSupported.mockReturnValue(false)
  notifications.present(withUrgency)
  expect(native.notices).toHaveLength(0)
  native.Notice.isSupported.mockImplementation(() => { throw new Error('notification service unavailable') })
  notifications.present(withUrgency)
  expect(native.notices).toHaveLength(0)
  expect(warn).toHaveBeenCalledWith('desktop notification: unavailable', expect.any(Error))
  warn.mockRestore()
})

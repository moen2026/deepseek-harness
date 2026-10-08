/** Native presentation of alerts the Host raised; presentation failures never reach the Host. */
import { Notification, type NotificationConstructorOptions } from 'electron'
import type { DesktopAlertMessage } from '@deepseek-ai/dsh-notification-desktop'

/**
 * Presents each accepted alert as one native notification. A click brings the
 * primary window forward; a platform that cannot show notifications drops the
 * alert instead of surfacing a presentation failure to the Host.
 */
export class DesktopHostNotifications {
  /** @param focus - Brings the primary window forward when an alert is clicked. */
  constructor(private readonly focus: () => void) {}

  /**
   * Present one alert natively.
   * @param alert - the accepted alert forwarded over the Desktop Host IPC channel.
   */
  present(alert: DesktopAlertMessage): void {
    try {
      if (!Notification.isSupported()) return
      const options: NotificationConstructorOptions = {
        title: alert.title,
        body: alert.body,
        ...alert.urgency === undefined ? {} : { silent: alert.urgency === 'low' },
      }
      const notification = new Notification(options)
      notification.once('click', () => { this.focus() })
      notification.show()
    } catch (error) {
      console.warn('desktop notification: unavailable', error)
    }
  }
}

/**
 * DingTalk outbound delivery: reply through the session webhook a recent
 * callback arrived with. Session webhooks are remembered per conversation
 * until shortly before their stated expiry; there is no app-level token, so
 * outbound replies require a conversation that has spoken first.
 * @module @deepseek-ai/dsh-connector-dingtalk/client
 */

import type { ConnectorChannelId, ConnectorOutboundMessage } from '@deepseek-ai/dsh-connector'
import { DingtalkError } from './types.ts'

/** Margin subtracted from the stated expiry so a reply never races its end. */
const SESSION_EXPIRY_MARGIN_MS = 60_000

/** One usable reply address with the instant it stops being usable. */
interface CachedSession {
  readonly url: string
  readonly expiresAt: number
}

/** Outbound DingTalk client the provider hands to `ctx.connector`. */
export interface DingtalkClient {
  /** Remember the session webhook one callback arrived with. */
  remember(channel: ConnectorChannelId, url: string, expiresAt: number): void

  /**
   * Reply to a conversation through its remembered session webhook.
   * @param channel - the DingTalk conversation id.
   * @param message - the message to deliver.
   * @param signal - cancellation honored across the request.
   */
  push(channel: ConnectorChannelId, message: ConnectorOutboundMessage, signal?: AbortSignal): Promise<void>
}

/** Resolved outbound client values, validated once at plugin load. */
export interface DingtalkClientOptions {
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs: number
}

/**
 * Build a DingTalk client that replies through cached session webhooks.
 * @param options - the resolved outbound timeout.
 * @returns a client remembering session webhooks and replying in text.
 */
export function createDingtalkClient(options: DingtalkClientOptions): DingtalkClient {
  const sessions = new Map<string, CachedSession>()

  return {
    remember(channel, url, expiresAt) {
      sessions.set(channel, { url, expiresAt })
    },

    async push(channel, message, signal = new AbortController().signal) {
      const session = sessions.get(channel)
      if (session === undefined || Date.now() >= session.expiresAt - SESSION_EXPIRY_MARGIN_MS) {
        throw new DingtalkError(
          'connector-dingtalk: no usable session webhook for this conversation',
          'DINGTALK_SESSION_UNAVAILABLE',
        )
      }
      const text = message.title === undefined ? message.text : `${message.title}\n${message.text}`
      let response: Response
      try {
        response = await fetch(session.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
          signal: AbortSignal.any([AbortSignal.timeout(options.timeoutMs), signal]),
        })
      } catch (error) {
        throw new DingtalkError('connector-dingtalk: DingTalk request failed', 'DINGTALK_DELIVERY_FAILED', { cause: error })
      }
      if (!response.ok) {
        throw new DingtalkError(`connector-dingtalk: DingTalk responded ${response.status}`, 'DINGTALK_DELIVERY_FAILED')
      }
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        // response.json is the only statement in the try; a non-JSON answer is
        // exactly this refusal.
        throw new DingtalkError('connector-dingtalk: DingTalk returned a non-JSON body', 'DINGTALK_DELIVERY_FAILED')
      }
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new DingtalkError('connector-dingtalk: DingTalk returned an unexpected body', 'DINGTALK_DELIVERY_FAILED')
      }
      const errcode = (payload as Record<string, unknown>).errcode
      if (errcode !== 0) {
        throw new DingtalkError(`connector-dingtalk: DingTalk send failed with code ${String(errcode)}`, 'DINGTALK_DELIVERY_FAILED')
      }
    },
  }
}

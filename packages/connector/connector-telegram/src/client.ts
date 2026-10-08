/**
 * Telegram outbound delivery: post one message to the chat via
 * `sendMessage` — plain text by default, or an inline keyboard when the
 * message carries actions (each button carries its action id back in the
 * callback query's `callback_data`), and acknowledge each callback query so
 * the platform stops the client's spinner. The bot token is resolved from
 * credentials at each push so rotation needs no reload, and it is never
 * logged or echoed.
 * @module @deepseek-ai/dsh-connector-telegram/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectorChannelId, ConnectorOutboundMessage } from '@deepseek-ai/dsh-connector'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { TelegramError } from './types.ts'

/** Resolved outbound client values, validated once at plugin load. */
export interface TelegramClientOptions {
  /** API origin, such as `https://api.telegram.org`, without a trailing slash. */
  readonly apiBaseUrl: string
  /** Credential reference containing the bot token. */
  readonly botTokenRef: CredentialRef
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs: number
}

/** Outbound Telegram client the provider hands to `ctx.connector`. */
export interface TelegramClient {
  /**
   * Deliver one message to a chat.
   * @param channel - the Telegram chat id.
   * @param message - the message to deliver.
   * @param signal - cancellation honored across the request.
   */
  push(channel: ConnectorChannelId, message: ConnectorOutboundMessage, signal?: AbortSignal): Promise<void>

  /**
   * Acknowledge one callback query so the client's spinner stops.
   * @param callbackQueryId - the id carried by the incoming callback query.
   * @param signal - cancellation honored across the request.
   */
  answerCallbackQuery(callbackQueryId: string, signal?: AbortSignal): Promise<void>
}

/**
 * Render one action-bearing message as an inline keyboard: one button per
 * action whose `callback_data` carries the action id the callback query
 * echoes back. Called only when `actions` is present.
 * @param message - the outbound message to render.
 * @returns the `reply_markup` posted with `sendMessage`.
 */
export function inlineKeyboardOf(message: ConnectorOutboundMessage): Record<string, unknown> {
  return {
    inline_keyboard: [
      (message.actions ?? []).map(action => ({
        text: action.label,
        callback_data: action.id,
      })),
    ],
  }
}

/**
 * Build a Telegram client over one bot token credential.
 * @param ctx - the plugin context carrying credentials.
 * @param options - resolved origin, token reference, and timeout.
 * @returns a client that posts messages and answers callback queries.
 */
export function createTelegramClient(ctx: Context, options: TelegramClientOptions): TelegramClient {
  const resolveToken = async (): Promise<string> => {
    const credential = await ctx.credentials.resolve(options.botTokenRef)
    if (credential === undefined || credential.value === '') {
      throw new TelegramError('connector-telegram: Telegram bot token is unavailable', 'TELEGRAM_CREDENTIALS_UNAVAILABLE')
    }
    return credential.value
  }

  const requestJson = async (method: string, body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> => {
    const token = await resolveToken()
    let response: Response
    try {
      response = await fetch(`${options.apiBaseUrl}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any([AbortSignal.timeout(options.timeoutMs), signal]),
      })
    } catch (error) {
      throw new TelegramError(`connector-telegram: Telegram ${method} request failed`, 'TELEGRAM_DELIVERY_FAILED', { cause: error })
    }
    if (!response.ok) {
      throw new TelegramError(`connector-telegram: Telegram API responded ${response.status}`, 'TELEGRAM_DELIVERY_FAILED')
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      // response.json is the only statement in the try; a non-JSON answer is
      // exactly this refusal.
      throw new TelegramError(`connector-telegram: Telegram ${method} returned a non-JSON body`, 'TELEGRAM_DELIVERY_FAILED')
    }
    const container = payload
    if (container === null || typeof container !== 'object' || Array.isArray(container)
      || (container as Record<string, unknown>).ok !== true) {
      const description = typeof container === 'object' && container !== null && !Array.isArray(container)
        ? String((container as Record<string, unknown>).description)
        : 'unexpected body'
      throw new TelegramError(`connector-telegram: Telegram ${method} failed with ${description}`, 'TELEGRAM_DELIVERY_FAILED')
    }
    return (container as Record<string, unknown>).result
  }

  return {
    async push(channel, message, signal = new AbortController().signal) {
      const text = message.title === undefined ? message.text : `${message.title}\n${message.text}`
      await requestJson('sendMessage', {
        chat_id: channel,
        text,
        ...(message.actions === undefined ? {} : { reply_markup: inlineKeyboardOf(message) }),
      }, signal)
    },

    async answerCallbackQuery(callbackQueryId, signal = new AbortController().signal) {
      await requestJson('answerCallbackQuery', { callback_query_id: callbackQueryId }, signal)
    },
  }
}

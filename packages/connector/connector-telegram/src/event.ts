/**
 * Translation from a secret-verified Telegram update into the connector
 * seam's vocabulary: a text message or inline-keyboard callback query the
 * seam admits, or an update the connector does not consume.
 * @module @deepseek-ai/dsh-connector-telegram/event
 */

import type { ConnectorInboundMessage } from '@deepseek-ai/dsh-connector'
import { ConnectorChannelId, ConnectorMessageId } from '@deepseek-ai/dsh-connector'
import { TelegramCallbackError } from './callback.ts'
import { TELEGRAM_PROVIDER_ID } from './types.ts'

/** One translated update. */
export type TelegramCallback =
  | { readonly kind: 'message'; readonly message: ConnectorInboundMessage }
  | { readonly kind: 'ignored' }

/**
 * Read one member of an unknown JSON value without asserting its type.
 * @param value - the container to read from.
 * @param key - the member name.
 * @returns the member value, or `undefined` when the container is not a plain object.
 */
export function fieldOf(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined
}

/** Require one value as a non-empty string. */
function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TelegramCallbackError(400, `Telegram update ${name} must be a non-empty string`)
  }
  return value
}

/** Require one value as a string form of a number or a non-empty string. */
function requiredId(value: unknown, name: string): string {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  return requiredString(value, name)
}

/**
 * Translate one inline-keyboard callback query into a resolution message:
 * the chat and clicked message come from the query, the clicking user is the
 * sender, and the button's `callback_data` — which this adapter sets to the
 * action id — is the resolution the connector seam routes to the provider's
 * resolution handler. The callback query id is unique per click, so every
 * repeat click on the same button is a distinct delivery the resolution
 * handler drops once its request is no longer pending.
 * @param query - the parsed `callback_query` value.
 * @returns the translated resolution message.
 * @throws {TelegramCallbackError} when the query is structurally invalid.
 */
function callbackQueryOf(query: unknown): TelegramCallback {
  const message = fieldOf(query, 'message')
  const chat = requiredId(fieldOf(fieldOf(message, 'chat'), 'id'), 'callback_query message.chat.id')
  const actionId = requiredString(fieldOf(query, 'data'), 'callback_query.data')
  return {
    kind: 'message',
    message: {
      provider: TELEGRAM_PROVIDER_ID,
      channel: ConnectorChannelId(chat),
      messageId: ConnectorMessageId(requiredString(fieldOf(query, 'id'), 'callback_query.id')),
      sender: requiredId(fieldOf(fieldOf(query, 'from'), 'id'), 'callback_query from.id'),
      text: '',
      resolution: { actionId, value: '' },
    },
  }
}

/**
 * Translate one secret-verified update.
 * @param payload - the parsed update whose secret token was checked.
 * @returns the translated message, or `ignored` for updates the connector
 * does not consume.
 * @throws {TelegramCallbackError} when a consumed update is structurally invalid.
 */
export function translateTelegramUpdate(payload: unknown): TelegramCallback {
  const query = fieldOf(payload, 'callback_query')
  if (query !== undefined) return callbackQueryOf(query)

  const message = fieldOf(payload, 'message')
  if (message === undefined) return { kind: 'ignored' }
  const text = fieldOf(message, 'text')
  if (typeof text !== 'string' || text.trim() === '') return { kind: 'ignored' }

  return {
    kind: 'message',
    message: {
      provider: TELEGRAM_PROVIDER_ID,
      channel: ConnectorChannelId(requiredId(fieldOf(fieldOf(message, 'chat'), 'id'), 'message chat.id')),
      // The update id (monotonic across the bot's updates) is the connector
      // seam's dedup key, so one platform retry of the same update is
      // admitted once. Telegram carries it as a number.
      messageId: ConnectorMessageId(requiredId(fieldOf(payload, 'update_id'), 'update_id')),
      sender: requiredId(fieldOf(fieldOf(message, 'from'), 'id'), 'message from.id'),
      text,
    },
  }
}

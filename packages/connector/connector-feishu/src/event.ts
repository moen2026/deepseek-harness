/**
 * Translation from a decrypted-and-verified Feishu callback payload into the
 * connector seam's vocabulary: the URL-verification challenge, a text message
 * the seam admits, an interactive-card action click translated into a
 * resolution, or an acknowledged event the connector does not consume.
 * @module @deepseek-ai/dsh-connector-feishu/event
 */

import type { ConnectorInboundMessage } from '@deepseek-ai/dsh-connector'
import { ConnectorChannelId, ConnectorMessageId } from '@deepseek-ai/dsh-connector'
import { FeishuCallbackError } from './callback.ts'
import { FEISHU_PROVIDER_ID } from './types.ts'

/** One translated callback payload. */
export type FeishuCallback =
  | { readonly kind: 'challenge'; readonly challenge: string }
  | { readonly kind: 'message'; readonly message: ConnectorInboundMessage }
  | { readonly kind: 'ignored' }

/** The one event type whose text messages become Sessions. */
const MESSAGE_EVENT = 'im.message.receive_v1'

/** The one event type whose button clicks become connector resolutions. */
const CARD_ACTION_EVENT = 'card.action.trigger'

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
    throw new FeishuCallbackError(400, `Feishu callback ${name} must be a non-empty string`)
  }
  return value
}

/**
 * Extract the verification token a callback payload carries: the top-level
 * `token` of a URL-verification call, or the `header.token` of a v2 event.
 * @param payload - the decrypted-and-parsed callback payload.
 * @returns the token string, or `undefined` when the payload carries none.
 */
export function tokenOf(payload: unknown): string | undefined {
  const topLevel = fieldOf(payload, 'token')
  if (typeof topLevel === 'string') return topLevel
  const nested = fieldOf(fieldOf(payload, 'header'), 'token')
  return typeof nested === 'string' ? nested : undefined
}

/**
 * Translate one interactive-card action click into a resolution message: the
 * channel and message come from the card context, the operator is the sender,
 * and the clicked button's `value.actionId` is the resolution the connector
 * seam routes to the provider's resolution handler.
 * @param header - the callback header carrying the retried-delivery event id.
 * @param payload - the full callback payload.
 * @returns the translated resolution message.
 * @throws {FeishuCallbackError} when the click is structurally invalid.
 */
function cardActionOf(header: unknown, payload: unknown): FeishuCallback {
  const event = fieldOf(payload, 'event')
  const actionValue = fieldOf(fieldOf(event, 'action'), 'value')
  const context = fieldOf(event, 'context')
  const operator = fieldOf(event, 'operator')
  const operatorId = fieldOf(operator, 'open_id') ?? fieldOf(operator, 'user_id')
  return {
    kind: 'message',
    message: {
      provider: FEISHU_PROVIDER_ID,
      channel: ConnectorChannelId(requiredString(fieldOf(context, 'open_chat_id'), 'card action context.open_chat_id')),
      // The event id (a retried delivery repeats it) is the connector seam's
      // dedup key, so one platform retry of the same click is admitted once.
      messageId: ConnectorMessageId(requiredString(fieldOf(header, 'event_id'), 'card action header.event_id')),
      sender: requiredString(operatorId, 'card action operator id'),
      text: '',
      resolution: {
        actionId: requiredString(fieldOf(actionValue, 'actionId'), 'card action value.actionId'),
        value: '',
      },
    },
  }
}

/**
 * Translate one token-verified callback payload.
 * @param payload - the decrypted-and-parsed payload whose token was checked.
 * @returns the challenge to echo, the translated message, or `ignored` for
 * events the connector does not consume.
 * @throws {FeishuCallbackError} when a message event is structurally invalid.
 */
export function translateFeishuCallback(payload: unknown): FeishuCallback {
  if (fieldOf(payload, 'type') === 'url_verification') {
    return {
      kind: 'challenge',
      challenge: requiredString(fieldOf(payload, 'challenge'), 'challenge'),
    }
  }
  const header = fieldOf(payload, 'header')
  const eventType = fieldOf(header, 'event_type')
  if (eventType === CARD_ACTION_EVENT) return cardActionOf(header, payload)
  if (eventType !== MESSAGE_EVENT) return { kind: 'ignored' }

  const event = fieldOf(payload, 'event')
  const message = fieldOf(event, 'message')
  if (fieldOf(message, 'message_type') !== 'text') return { kind: 'ignored' }

  const contentText = requiredString(fieldOf(message, 'content'), 'message.content')
  let content: unknown
  try {
    content = JSON.parse(contentText)
  } catch {
    // JSON.parse is the only statement in the try; a message whose content
    // field is not JSON text is exactly this refusal.
    throw new FeishuCallbackError(400, 'Feishu callback message.content must be JSON text')
  }
  const sender = fieldOf(fieldOf(event, 'sender'), 'sender_id')
  const senderId = fieldOf(sender, 'open_id') ?? fieldOf(sender, 'user_id')
  return {
    kind: 'message',
    message: {
      provider: FEISHU_PROVIDER_ID,
      channel: ConnectorChannelId(requiredString(fieldOf(message, 'chat_id'), 'message.chat_id')),
      messageId: ConnectorMessageId(requiredString(fieldOf(message, 'message_id'), 'message.message_id')),
      sender: requiredString(senderId, 'message sender id'),
      text: requiredString(fieldOf(content, 'text'), 'message text'),
    },
  }
}

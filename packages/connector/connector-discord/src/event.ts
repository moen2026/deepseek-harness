/**
 * Translation from a Discord Gateway dispatch into the connector seam's
 * vocabulary: a text message, a message-component interaction the seam
 * admits as a resolution, or a dispatch the connector does not consume.
 * @module @deepseek-ai/dsh-connector-discord/event
 */

import type { ConnectorInboundMessage } from '@deepseek-ai/dsh-connector'
import { ConnectorChannelId, ConnectorMessageId } from '@deepseek-ai/dsh-connector'
import { DISCORD_PROVIDER_ID } from './types.ts'

/** One translated dispatch. */
export type DiscordDispatch =
  | { readonly kind: 'message'; readonly message: ConnectorInboundMessage }
  | {
    readonly kind: 'interaction'
    readonly interactionId: string
    readonly interactionToken: string
    readonly message: ConnectorInboundMessage
  }
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
    throw new Error(`Discord dispatch ${name} must be a non-empty string`)
  }
  return value
}

/**
 * Translate one MESSAGE_CREATE dispatch. Bot-authored messages (including
 * this application's own replies) and system messages are ignored so the
 * conversation loop cannot echo itself.
 * @param data - the dispatch payload.
 * @returns the translated message, or `ignored`.
 * @throws when a consumed message is structurally invalid.
 */
function messageOf(data: unknown): DiscordDispatch {
  const type = fieldOf(data, 'type')
  if (type !== undefined && type !== 0) return { kind: 'ignored' }
  if (fieldOf(fieldOf(data, 'author'), 'bot') === true) return { kind: 'ignored' }
  const text = fieldOf(data, 'content')
  if (typeof text !== 'string' || text.trim() === '') return { kind: 'ignored' }
  return {
    kind: 'message',
    message: {
      provider: DISCORD_PROVIDER_ID,
      channel: ConnectorChannelId(requiredString(fieldOf(data, 'channel_id'), 'message channel_id')),
      // The snowflake message id is the connector seam's dedup key; Discord
      // redelivers a create only on gateway replay, which this adapter does
      // not request.
      messageId: ConnectorMessageId(requiredString(fieldOf(data, 'id'), 'message id')),
      sender: requiredString(fieldOf(fieldOf(data, 'author'), 'id'), 'message author.id'),
      text,
    },
  }
}

/**
 * Translate one message-component interaction (a clicked button). The
 * component's `custom_id` — which this adapter sets to the action id — is
 * the resolution, and the interaction id is unique per click, so every
 * repeat click is a distinct delivery the resolution handler drops once its
 * request is no longer pending.
 * @param data - the dispatch payload.
 * @returns the translated resolution message.
 * @throws when the interaction is structurally invalid.
 */
function interactionOf(data: unknown): DiscordDispatch {
  const sender = fieldOf(fieldOf(data, 'user'), 'id') ?? fieldOf(fieldOf(fieldOf(data, 'member'), 'user'), 'id')
  return {
    kind: 'interaction',
    interactionId: requiredString(fieldOf(data, 'id'), 'interaction id'),
    interactionToken: requiredString(fieldOf(data, 'token'), 'interaction token'),
    message: {
      provider: DISCORD_PROVIDER_ID,
      channel: ConnectorChannelId(requiredString(fieldOf(fieldOf(data, 'message'), 'channel_id'), 'interaction message.channel_id')),
      messageId: ConnectorMessageId(requiredString(fieldOf(data, 'id'), 'interaction id')),
      sender: requiredString(sender, 'interaction user.id'),
      text: '',
      resolution: { actionId: requiredString(fieldOf(fieldOf(data, 'data'), 'custom_id'), 'interaction data.custom_id'), value: '' },
    },
  }
}

/**
 * Translate one dispatch event.
 * @param type - the dispatch event name (`t`).
 * @param data - the dispatch payload (`d`).
 * @returns the translated dispatch, or `ignored` for events the connector
 * does not consume.
 * @throws when a consumed dispatch is structurally invalid.
 */
export function translateDispatch(type: unknown, data: unknown): DiscordDispatch {
  if (type === 'MESSAGE_CREATE') return messageOf(data)
  if (type === 'INTERACTION_CREATE' && fieldOf(data, 'type') === 3) return interactionOf(data)
  return { kind: 'ignored' }
}

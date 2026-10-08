/**
 * Translation from a signature-verified Slack callback payload into the
 * connector seam's vocabulary: the URL-verification challenge, a text message
 * or Block Kit action click the seam admits, or an event the connector does
 * not consume.
 * @module @deepseek-ai/dsh-connector-slack/event
 */

import type { ConnectorInboundMessage } from '@deepseek-ai/dsh-connector'
import { ConnectorChannelId, ConnectorMessageId } from '@deepseek-ai/dsh-connector'
import { SlackCallbackError } from './callback.ts'
import { SLACK_PROVIDER_ID } from './types.ts'

/** One translated callback payload. */
export type SlackCallback =
  | { readonly kind: 'challenge'; readonly challenge: string }
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
    throw new SlackCallbackError(400, `Slack callback ${name} must be a non-empty string`)
  }
  return value
}

/**
 * Translate one Block Kit action click into a resolution message: the channel
 * and clicked message come from the interactive payload, the clicking user is
 * the sender, and the clicked button's `action_id` is the resolution the
 * connector seam routes to the provider's resolution handler. The message id
 * pairs the clicked message's timestamp with the action id, so one repeat
 * click on the same button is admitted once by the outbox deduplication and
 * a click on a different button of the same message is a distinct delivery.
 * @param payload - the parsed interactive payload.
 * @returns the translated resolution message.
 * @throws {SlackCallbackError} when the click is structurally invalid.
 */
function blockActionsOf(payload: unknown): SlackCallback {
  const actions = fieldOf(payload, 'actions')
  const first: unknown = Array.isArray(actions) ? actions[0] : undefined
  const message = fieldOf(payload, 'message')
  const messageTs = fieldOf(message, 'ts')
  const actionId = requiredString(fieldOf(first, 'action_id'), 'block action action_id')
  const value = fieldOf(first, 'value')
  const channel = requiredString(fieldOf(fieldOf(payload, 'channel'), 'id'), 'interactive channel.id')
  const user = requiredString(fieldOf(fieldOf(payload, 'user'), 'id'), 'interactive user.id')
  return {
    kind: 'message',
    message: {
      provider: SLACK_PROVIDER_ID,
      channel: ConnectorChannelId(channel),
      messageId: ConnectorMessageId(`${requiredString(messageTs, 'interactive message.ts')}:${actionId}`),
      sender: user,
      text: '',
      resolution: {
        actionId,
        value: typeof value === 'string' ? value : '',
      },
    },
  }
}

/**
 * Translate one signature-verified callback payload.
 * @param payload - the parsed payload whose signature was checked.
 * @returns the challenge to echo, the translated message, or `ignored` for
 * events the connector does not consume.
 * @throws {SlackCallbackError} when a consumed callback is structurally invalid.
 */
export function translateSlackPayload(payload: unknown): SlackCallback {
  const type = fieldOf(payload, 'type')
  if (type === 'url_verification') {
    return {
      kind: 'challenge',
      challenge: requiredString(fieldOf(payload, 'challenge'), 'challenge'),
    }
  }
  if (type === 'block_actions') return blockActionsOf(payload)
  if (type !== 'event_callback') return { kind: 'ignored' }

  const event = fieldOf(payload, 'event')
  // The bot's own answers come back as message events; consuming them would
  // loop every reply into a new Session prompt.
  if (fieldOf(event, 'bot_id') !== undefined) return { kind: 'ignored' }
  if (fieldOf(event, 'type') !== 'message') return { kind: 'ignored' }
  if (fieldOf(event, 'subtype') !== undefined) return { kind: 'ignored' }
  const text = fieldOf(event, 'text')
  if (typeof text !== 'string' || text.trim() === '') return { kind: 'ignored' }

  return {
    kind: 'message',
    message: {
      provider: SLACK_PROVIDER_ID,
      channel: ConnectorChannelId(requiredString(fieldOf(event, 'channel'), 'event.channel')),
      // The event id (a retried delivery repeats it) is the connector seam's
      // dedup key, so one platform retry of the same event is admitted once.
      messageId: ConnectorMessageId(requiredString(fieldOf(payload, 'event_id'), 'event_id')),
      sender: requiredString(fieldOf(event, 'user'), 'event.user'),
      text,
    },
  }
}

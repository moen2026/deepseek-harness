/**
 * Translation from a decrypted WeCom callback document into the connector
 * seam's vocabulary: a text message, a template-card button click the seam
 * admits as a resolution, or a message the connector does not consume.
 * @module @deepseek-ai/dsh-connector-wecom/event
 */

import type { ConnectorInboundMessage } from '@deepseek-ai/dsh-connector'
import { ConnectorChannelId, ConnectorMessageId } from '@deepseek-ai/dsh-connector'
import { requiredField } from './callback.ts'
import { WECOM_ACTION_PREFIX, WECOM_PROVIDER_ID } from './types.ts'

/** One translated callback document. */
export type WecomCallback =
  | { readonly kind: 'message'; readonly message: ConnectorInboundMessage }
  | { readonly kind: 'ignored' }

/**
 * Translate one text message. The sending member is both the channel and the
 * sender: WeCom application messages are one-to-one, so the reply target is
 * the member who wrote in. The platform message id is the connector seam's
 * dedup key, so one platform retry of the same message is admitted once.
 * @param fields - the decrypted callback document's leaf fields.
 * @returns the translated message, or `ignored` without text content.
 * @throws {WecomCallbackError} when a consumed message is structurally invalid.
 */
function textOf(fields: Record<string, string>): WecomCallback {
  const content = fields['Content']
  if (content === undefined || content.trim() === '') return { kind: 'ignored' }
  const sender = requiredField(fields, 'FromUserName')
  return {
    kind: 'message',
    message: {
      provider: WECOM_PROVIDER_ID,
      channel: ConnectorChannelId(sender),
      messageId: ConnectorMessageId(requiredField(fields, 'MsgId')),
      sender,
      text: content,
    },
  }
}

/**
 * Translate one template-card button click. This adapter renders every
 * button key as the action id behind {@link WECOM_ACTION_PREFIX}, so a click
 * whose key carries the prefix is the resolution and any other event key is
 * not this adapter's card. The message id pairs the card's task id with the
 * clicked key, so one platform retry of the same click is admitted once.
 * @param fields - the decrypted callback document's leaf fields.
 * @returns the translated resolution message, or `ignored` for other events.
 * @throws {WecomCallbackError} when a consumed click is structurally invalid.
 */
function cardEventOf(fields: Record<string, string>): WecomCallback {
  const eventKey = fields['EventKey']
  if (eventKey === undefined || !eventKey.startsWith(WECOM_ACTION_PREFIX)) return { kind: 'ignored' }
  const actionId = eventKey.slice(WECOM_ACTION_PREFIX.length)
  const sender = requiredField(fields, 'FromUserName')
  return {
    kind: 'message',
    message: {
      provider: WECOM_PROVIDER_ID,
      channel: ConnectorChannelId(sender),
      messageId: ConnectorMessageId(`${requiredField(fields, 'TaskId')}:${eventKey}`),
      sender,
      text: '',
      resolution: { actionId, value: '' },
    },
  }
}

/**
 * Translate one decrypted, signature-verified callback document.
 * @param fields - the leaf fields of the decrypted XML document.
 * @returns the translated message, or `ignored` for messages the connector
 * does not consume.
 * @throws {WecomCallbackError} when a consumed document is structurally invalid.
 */
export function translateWecomFields(fields: Record<string, string>): WecomCallback {
  if (fields['MsgType'] === 'text') return textOf(fields)
  if (fields['Event'] === 'template_card_event') return cardEventOf(fields)
  return { kind: 'ignored' }
}

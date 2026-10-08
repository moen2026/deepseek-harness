/** Opaque connector identities shared by provider adapters, bindings, and rules. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one channel (chat, room, or direct message) inside a provider platform. */
export type ConnectorChannelId = Branded<'ConnectorChannelId'>

/** Identifies one inbound platform message. */
export type ConnectorMessageId = Branded<'ConnectorMessageId'>

/**
 * Brand a channel id.
 * @param value - non-empty channel identifier validated by its adapter.
 * @returns the same string with its compile-time brand.
 */
export function ConnectorChannelId(value: string): ConnectorChannelId {
  return value as ConnectorChannelId
}

/**
 * Brand a platform message id.
 * @param value - non-empty message identifier validated by its adapter.
 * @returns the same string with its compile-time brand.
 */
export function ConnectorMessageId(value: string): ConnectorMessageId {
  return value as ConnectorMessageId
}

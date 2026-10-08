/**
 * DingTalk callback intake: the bounded UTF-8 request body and translation of
 * a text callback into connector vocabulary together with its reply session
 * webhook. Every refusal is an HTTP-status-bearing error that carries no
 * request data.
 * @module @deepseek-ai/dsh-connector-dingtalk/callback
 */

import type { IncomingMessage } from 'node:http'
import type { ConnectorInboundMessage } from '@deepseek-ai/dsh-connector'
import { ConnectorChannelId, ConnectorMessageId } from '@deepseek-ai/dsh-connector'
import { DINGTALK_PROVIDER_ID } from './types.ts'

/** HTTP refusal whose message is safe to return without request data. */
export class DingtalkCallbackError extends Error {
  override readonly name = 'DingtalkCallbackError'

  /**
   * @param status - the HTTP status this refusal answers with.
   * @param message - refusal detail safe to send to the callback sender.
   */
  constructor(
    readonly status: 400 | 401 | 405 | 413 | 415 | 503,
    message: string,
  ) {
    super(message)
  }
}

/** One translated text callback plus the reply address it arrived with. */
export interface DingtalkInbound {
  /** The message the connector seam admits. */
  readonly message: ConnectorInboundMessage
  /** The session webhook that replies to this conversation. */
  readonly sessionWebhook: string
  /** The instant (epoch ms) the session webhook expires. */
  readonly sessionWebhookExpiresAt: number
}

/* jscpd:ignore-start -- the sibling connector provider and the webhook ingress intentionally
   keep product-private bounded-body plumbing; each owner refuses through its own error type
   and pre-checks instead of a shared reader that would couple the three packages. */
/**
 * Read one callback request body as exact, bounded bytes and decode it as
 * UTF-8.
 * @param request - incoming request before any parser consumes it.
 * @param maxBodyBytes - positive byte ceiling.
 * @returns the decoded UTF-8 body.
 * @throws {DingtalkCallbackError} for excessive bytes, an aborted stream, or
 * undecodable bytes.
 */
export async function readUtf8Body(request: IncomingMessage, maxBodyBytes: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as string)
      size += chunk.byteLength
      if (size > maxBodyBytes) {
        request.resume()
        throw new DingtalkCallbackError(413, 'request body is too large')
      }
      chunks.push(chunk)
    }
  } catch (error: unknown) {
    if (error instanceof DingtalkCallbackError) throw error
    throw new DingtalkCallbackError(400, 'request body was aborted')
  }
  if (!request.complete) throw new DingtalkCallbackError(400, 'request body was aborted')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))
  } catch {
    // TextDecoder is the only statement in the try; undecodable bytes are
    // exactly this refusal.
    throw new DingtalkCallbackError(400, 'request body is not valid UTF-8')
  }
}
/* jscpd:ignore-end */

/* jscpd:ignore-start -- sibling connector providers intentionally keep provider-private
   translation helpers and refusal errors instead of adding a shared owner. */
/** Read one member of an unknown JSON value without asserting its type. */
function fieldOf(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined
}

/** Require one value as a non-empty string. */
function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DingtalkCallbackError(400, `DingTalk callback ${name} must be a non-empty string`)
  }
  return value
}
/* jscpd:ignore-end */

/**
 * Translate one signature-verified DingTalk callback payload.
 * @param payload - the parsed callback payload whose signature was checked.
 * @returns the translated message with its reply session webhook, or
 * `undefined` for callbacks the connector does not consume.
 * @throws {DingtalkCallbackError} when a text callback is structurally invalid.
 */
export function translateDingtalkCallback(payload: unknown): DingtalkInbound | undefined {
  const msgtype = fieldOf(payload, 'msgtype')
  if (typeof msgtype !== 'string' || msgtype === '') {
    throw new DingtalkCallbackError(400, 'DingTalk callback msgtype must be a non-empty string')
  }
  if (msgtype !== 'text') return undefined

  const sessionWebhook = requiredString(fieldOf(payload, 'sessionWebhook'), 'sessionWebhook')
  let sessionWebhookUrl: URL
  try {
    sessionWebhookUrl = new URL(sessionWebhook)
  } catch {
    // URL construction is the only statement in the try; a webhook that is
    // not an absolute URL is exactly this refusal.
    throw new DingtalkCallbackError(400, 'DingTalk callback sessionWebhook must be an absolute URL')
  }
  if (sessionWebhookUrl.protocol !== 'https:') {
    throw new DingtalkCallbackError(400, 'DingTalk callback sessionWebhook must be an https URL')
  }
  const expiresAt = fieldOf(payload, 'sessionWebhookExpiredTime')
  if (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new DingtalkCallbackError(400, 'DingTalk callback sessionWebhookExpiredTime must be a positive integer')
  }
  const conversationId = requiredString(fieldOf(payload, 'conversationId'), 'conversationId')
  const messageId = requiredString(fieldOf(payload, 'msgId'), 'msgId')
  const senderId = fieldOf(payload, 'senderStaffId') ?? fieldOf(payload, 'senderId')
  return {
    message: {
      provider: DINGTALK_PROVIDER_ID,
      channel: ConnectorChannelId(conversationId),
      messageId: ConnectorMessageId(messageId),
      sender: requiredString(senderId, 'sender id'),
      text: requiredString(fieldOf(fieldOf(payload, 'text'), 'content'), 'text content'),
    },
    sessionWebhook,
    sessionWebhookExpiresAt: expiresAt,
  }
}

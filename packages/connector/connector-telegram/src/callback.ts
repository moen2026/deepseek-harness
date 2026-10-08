/**
 * Telegram callback intake: the bounded raw request body, the
 * `X-Telegram-Bot-Api-Secret-Token` timing-safe comparison, and the UTF-8
 * bounded-body plumbing. Every refusal is an HTTP-status-bearing error that
 * carries no request data.
 * @module @deepseek-ai/dsh-connector-telegram/callback
 */

import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/** HTTP refusal whose message is safe to return without request data. */
export class TelegramCallbackError extends Error {
  override readonly name = 'TelegramCallbackError'

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

/* jscpd:ignore-start -- the sibling connector providers and the webhook ingress intentionally
   keep product-private bounded-body plumbing; each owner refuses through its own error type
   and pre-checks instead of a shared reader that would couple the packages. */
/**
 * Read one callback request body as exact, bounded raw bytes.
 * @param request - incoming request before any parser consumes it.
 * @param maxBodyBytes - positive byte ceiling.
 * @returns the raw body after EOF.
 * @throws {TelegramCallbackError} for excessive bytes or an aborted stream.
 */
export async function readRawBody(request: IncomingMessage, maxBodyBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as string)
      size += chunk.byteLength
      if (size > maxBodyBytes) {
        request.resume()
        throw new TelegramCallbackError(413, 'request body is too large')
      }
      chunks.push(chunk)
    }
  } catch (error: unknown) {
    if (error instanceof TelegramCallbackError) throw error
    throw new TelegramCallbackError(400, 'request body was aborted')
  }
  if (!request.complete) throw new TelegramCallbackError(400, 'request body was aborted')
  return Buffer.concat(chunks, size)
}
/* jscpd:ignore-end */

/**
 * Timing-safe comparison of one received webhook secret token against the
 * configured one. Telegram echoes the secret token it was registered with in
 * the `X-Telegram-Bot-Api-Secret-Token` header of every callback.
 * @param received - the header value carried by the callback, or `undefined`.
 * @param expected - the configured webhook secret token.
 * @returns whether the header matches.
 */
export function secretTokenMatches(received: string | undefined, expected: string): boolean {
  if (received === undefined) return false
  const a = Buffer.from(received, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

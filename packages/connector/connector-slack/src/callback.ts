/**
 * Slack callback intake: the bounded raw request body and the
 * `X-Slack-Signature` check over the untouched bytes. The signature is the
 * HMAC-SHA256 of `v0:<timestamp>:<body>` keyed with the app signing secret,
 * hex-encoded, compared timing-safe; timestamps outside the replay window are
 * refused before any parsing, and every refusal is an HTTP-status-bearing
 * error that carries no request data.
 * @module @deepseek-ai/dsh-connector-slack/callback
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/** Maximum age of the request timestamp Slack recommends accepting. */
export const SLACK_REPLAY_WINDOW_MS = 5 * 60_000

/** HTTP refusal whose message is safe to return without request data. */
export class SlackCallbackError extends Error {
  override readonly name = 'SlackCallbackError'

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
 * Read one callback request body as exact, bounded raw bytes. The untouched
 * bytes are what the signature covers, so they are never re-encoded.
 * @param request - incoming request before any parser consumes it.
 * @param maxBodyBytes - positive byte ceiling.
 * @returns the raw body after EOF.
 * @throws {SlackCallbackError} for excessive bytes or an aborted stream.
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
        throw new SlackCallbackError(413, 'request body is too large')
      }
      chunks.push(chunk)
    }
  } catch (error: unknown) {
    if (error instanceof SlackCallbackError) throw error
    throw new SlackCallbackError(400, 'request body was aborted')
  }
  if (!request.complete) throw new SlackCallbackError(400, 'request body was aborted')
  return Buffer.concat(chunks, size)
}
/* jscpd:ignore-end */

/**
 * Verify the `X-Slack-Signature` header over the untouched request body.
 * Slack signs the HMAC-SHA256 of `v0:<timestamp>:<raw body>` keyed with the
 * signing secret, prefixed `v0=`, hex-encoded; the comparison is timing-safe.
 * @param headers - the request's timestamp and signature header values.
 * @param signingSecret - the configured app signing secret.
 * @param rawBody - the exact received body bytes.
 * @param now - wall-clock instant enforcing the replay window.
 * @returns `'ok'`, `'stale'` for a timestamp outside the replay window, or
 * `'invalid'` for a non-verifying signature.
 */
export function verifySlackSignature(
  headers: { readonly timestamp: string; readonly signature: string },
  signingSecret: string,
  rawBody: Buffer,
  now: number,
): 'ok' | 'stale' | 'invalid' {
  const timestamp = Number(headers.timestamp)
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp * 1000) > SLACK_REPLAY_WINDOW_MS) {
    return 'stale'
  }
  const expected = createHmac('sha256', signingSecret)
    .update(`v0:${headers.timestamp}:`)
    .update(rawBody)
    .digest('hex')
  const received = headers.signature
  if (!received.startsWith('v0=')) return 'invalid'
  const expectedBytes = Buffer.from(expected, 'utf8')
  const receivedBytes = Buffer.from(received.slice('v0='.length), 'utf8')
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
    ? 'ok'
    : 'invalid'
}

/**
 * Decode the `payload` form field of an interactive-callback body.
 * Slack sends interactivity as `application/x-www-form-urlencoded` with the
 * JSON payload percent-encoded into the single `payload` field.
 * @param body - the raw body decoded as UTF-8.
 * @returns the parsed JSON payload.
 * @throws {SlackCallbackError} when the form or the JSON inside is invalid.
 */
export function parseInteractivePayload(body: string): unknown {
  let form: URLSearchParams
  try {
    form = new URLSearchParams(body)
  } catch {
    // URLSearchParams is the only statement in the try; a body it cannot
    // parse is exactly this refusal.
    throw new SlackCallbackError(400, 'interactive callback is not valid urlencoded form data')
  }
  const payload = form.get('payload')
  if (payload === null) {
    throw new SlackCallbackError(400, 'interactive callback carries no payload field')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    // JSON.parse is the only statement in the try; a payload that is not JSON
    // is exactly this refusal.
    throw new SlackCallbackError(400, 'interactive callback payload is not valid JSON')
  }
  return parsed
}

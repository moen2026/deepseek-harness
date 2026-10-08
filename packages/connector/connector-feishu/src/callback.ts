/**
 * Feishu callback intake: the bounded raw request body, the `X-Lark-Signature`
 * check over the untouched bytes, AES-256-CBC envelope decryption, and the
 * timing-safe verification-token comparison. Signature verification runs
 * before any decryption, and every refusal is an HTTP-status-bearing error
 * that carries no request data.
 * @module @deepseek-ai/dsh-connector-feishu/callback
 */

import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/** HTTP refusal whose message is safe to return without request data. */
export class FeishuCallbackError extends Error {
  override readonly name = 'FeishuCallbackError'

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

/* jscpd:ignore-start -- the sibling connector provider and the webhook ingress intentionally
   keep product-private bounded-body plumbing; each owner refuses through its own error type
   and pre-checks instead of a shared reader that would couple the three packages. */
/**
 * Read one callback request body as exact, bounded raw bytes. The untouched
 * bytes are what the signature covers, so they are never re-encoded.
 * @param request - incoming request before any parser consumes it.
 * @param maxBodyBytes - positive byte ceiling.
 * @returns the raw body after EOF.
 * @throws {FeishuCallbackError} for excessive bytes or an aborted stream.
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
        throw new FeishuCallbackError(413, 'request body is too large')
      }
      chunks.push(chunk)
    }
  } catch (error: unknown) {
    if (error instanceof FeishuCallbackError) throw error
    throw new FeishuCallbackError(400, 'request body was aborted')
  }
  if (!request.complete) throw new FeishuCallbackError(400, 'request body was aborted')
  return Buffer.concat(chunks, size)
}
/* jscpd:ignore-end */

/**
 * Verify the `X-Lark-Signature` header over the untouched request body.
 * Feishu signs the SHA-256 of timestamp, nonce, and encrypt key concatenated
 * with the raw body, hex-encoded; the comparison is timing-safe.
 * @param headers - the request's timestamp, nonce, and signature header values.
 * @param encryptKey - the configured encrypt key.
 * @param rawBody - the exact received body bytes.
 * @returns whether the signature matches.
 */
export function verifyFeishuSignature(
  headers: { readonly timestamp: string; readonly nonce: string; readonly signature: string },
  encryptKey: string,
  rawBody: Buffer,
): boolean {
  const expected = Buffer.from(
    createHash('sha256')
      .update(headers.timestamp)
      .update(headers.nonce)
      .update(encryptKey)
      .update(rawBody)
      .digest('hex'),
    'utf8',
  )
  const received = Buffer.from(headers.signature, 'utf8')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

/**
 * Decrypt one Feishu `encrypt` envelope and parse the JSON payload inside.
 * The AES key is the SHA-256 digest of the encrypt key; the base64-decoded
 * envelope carries a 16-byte IV followed by the AES-256-CBC ciphertext.
 * @param encrypt - the base64 envelope string.
 * @param encryptKey - the configured encrypt key.
 * @returns the parsed JSON payload.
 * @throws {FeishuCallbackError} when the envelope cannot be decrypted or parsed.
 */
export function decryptFeishuEnvelope(encrypt: string, encryptKey: string): unknown {
  let plaintext: Buffer
  try {
    const key = createHash('sha256').update(encryptKey).digest()
    const decoded = Buffer.from(encrypt, 'base64')
    const decipher = createDecipheriv('aes-256-cbc', key, decoded.subarray(0, 16))
    plaintext = Buffer.concat([decipher.update(decoded.subarray(16)), decipher.final()])
  } catch {
    // Every crypto failure — bad base64, short IV, bad padding — is one
    // refusal; the underlying error detail is safe to omit and adds nothing.
    throw new FeishuCallbackError(400, 'encrypted payload could not be decrypted')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext))
  } catch {
    // TextDecoder and JSON.parse are the only statements in the try; a
    // decrypted non-JSON envelope is exactly this refusal.
    throw new FeishuCallbackError(400, 'encrypted payload is not valid JSON')
  }
  return parsed
}

/**
 * Timing-safe comparison of one received verification token against the
 * configured one.
 * @param received - the token carried by the callback payload.
 * @param expected - the configured verification token.
 * @returns whether both tokens are equal.
 */
export function tokenMatches(received: string, expected: string): boolean {
  const a = Buffer.from(received, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

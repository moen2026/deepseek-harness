/**
 * DingTalk callback signature verification: the HMAC-SHA256 `sign` header over
 * `timestamp\nappSecret`, and the one-hour replay window DingTalk documents.
 * @module @deepseek-ai/dsh-connector-dingtalk/verify
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Maximum accepted age of a callback timestamp, in milliseconds. */
export const DINGTALK_MAX_CLOCK_SKEW_MS = 3_600_000

/** Outcome of one callback verification attempt. */
export type DingtalkVerification = 'verified' | 'stale' | 'invalid'

/**
 * Compute the DingTalk signature for one timestamp.
 * @param appSecret - the app secret acting as both HMAC key and suffix.
 * @param timestamp - the millisecond timestamp string sent in the request header.
 * @returns the base64 HMAC-SHA256 over `timestamp\nappSecret`.
 */
export function dingtalkSignatureOf(appSecret: string, timestamp: string): string {
  return createHmac('sha256', appSecret).update(`${timestamp}\n${appSecret}`).digest('base64')
}

/**
 * Verify one callback's `timestamp` and `sign` headers.
 * @param headers - the raw `timestamp` and `sign` header values.
 * @param appSecret - the configured app secret.
 * @param now - the current epoch milliseconds.
 * @returns `verified`, `stale` for a well-signed but expired timestamp, or
 * `invalid` for anything else.
 */
export function verifyDingtalkCallback(
  headers: { readonly timestamp: string | undefined; readonly sign: string | undefined },
  appSecret: string,
  now: number,
): DingtalkVerification {
  const { timestamp, sign } = headers
  if (timestamp === undefined || sign === undefined) return 'invalid'
  if (!/^\d+$/.test(timestamp)) return 'invalid'
  const sent = Number(timestamp)
  if (!Number.isSafeInteger(sent)) return 'invalid'
  const expected = Buffer.from(dingtalkSignatureOf(appSecret, timestamp), 'utf8')
  const received = Buffer.from(sign, 'utf8')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return 'invalid'
  if (Math.abs(now - sent) > DINGTALK_MAX_CLOCK_SKEW_MS) return 'stale'
  return 'verified'
}

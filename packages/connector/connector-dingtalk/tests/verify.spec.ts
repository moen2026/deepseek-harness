import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  DINGTALK_MAX_CLOCK_SKEW_MS,
  dingtalkSignatureOf,
  verifyDingtalkCallback,
} from '../src/verify.ts'

const SECRET = 'app-secret'
const NOW = 1_700_000_000_000

/** Independent recompute of the documented signing string. */
function sign(timestamp: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64')
}

describe('DingTalk signature computation', () => {
  it('signs the timestamp and secret concatenation as base64 HMAC-SHA256', () => {
    expect(dingtalkSignatureOf(SECRET, '1700000000000')).toBe(sign('1700000000000'))
  })
})

describe('DingTalk callback verification', () => {
  it('verifies a well-signed timestamp inside the replay window', () => {
    const timestamp = String(NOW - 1_000)
    expect(verifyDingtalkCallback({ timestamp, sign: sign(timestamp) }, SECRET, NOW)).toBe('verified')
  })

  it('accepts the exact replay-window boundary and rejects one millisecond past it', () => {
    const edge = String(NOW - DINGTALK_MAX_CLOCK_SKEW_MS)
    expect(verifyDingtalkCallback({ timestamp: edge, sign: sign(edge) }, SECRET, NOW)).toBe('verified')
    const past = String(NOW - DINGTALK_MAX_CLOCK_SKEW_MS - 1)
    expect(verifyDingtalkCallback({ timestamp: past, sign: sign(past) }, SECRET, NOW)).toBe('stale')
    const future = String(NOW + DINGTALK_MAX_CLOCK_SKEW_MS + 1)
    expect(verifyDingtalkCallback({ timestamp: future, sign: sign(future) }, SECRET, NOW)).toBe('stale')
  })

  it('marks a well-signed but expired timestamp as stale', () => {
    const old = String(NOW - 3_600_001)
    expect(verifyDingtalkCallback({ timestamp: old, sign: sign(old) }, SECRET, NOW)).toBe('stale')
  })

  it('rejects missing, non-numeric, and unsafe timestamps as invalid', () => {
    expect(verifyDingtalkCallback({ timestamp: undefined, sign: sign('1') }, SECRET, NOW)).toBe('invalid')
    expect(verifyDingtalkCallback({ timestamp: '1700000000000', sign: undefined }, SECRET, NOW)).toBe('invalid')
    expect(verifyDingtalkCallback({ timestamp: '1e3', sign: sign('1e3') }, SECRET, NOW)).toBe('invalid')
    expect(verifyDingtalkCallback({ timestamp: '99999999999999999999', sign: sign('99999999999999999999') }, SECRET, NOW))
      .toBe('invalid')
  })

  it('rejects signatures from another key or of another length as invalid', () => {
    const mismatched = sign('1700000000000', 'other-secret')
    expect(verifyDingtalkCallback({ timestamp: '1700000000000', sign: mismatched }, SECRET, NOW)).toBe('invalid')
    expect(verifyDingtalkCallback({ timestamp: '1700000000000', sign: 'abc' }, SECRET, NOW)).toBe('invalid')
  })
})

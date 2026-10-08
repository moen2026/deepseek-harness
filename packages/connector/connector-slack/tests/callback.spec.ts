import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseInteractivePayload, verifySlackSignature } from '../src/callback.ts'

const SECRET = 'fixture-signing-secret'
const BODY = '{"type":"event_callback"}'

/** Independent recompute of the documented v0 signature concatenation. */
function signOf(timestamp: string, body: string): string {
  return `v0=${createHmac('sha256', SECRET).update(`v0:${timestamp}:`).update(body).digest('hex')}`
}

describe('verifySlackSignature', () => {
  const now = 1_700_000_000_000
  const fresh = String(Math.floor(now / 1000))

  it('accepts a fresh signature over the exact body bytes', () => {
    expect(verifySlackSignature({ timestamp: fresh, signature: signOf(fresh, BODY) }, SECRET, Buffer.from(BODY), now))
      .toBe('ok')
  })

  it('refuses a timestamp outside the replay window', () => {
    const stale = String(Math.floor(now / 1000) - 600)
    expect(verifySlackSignature({ timestamp: stale, signature: signOf(stale, BODY) }, SECRET, Buffer.from(BODY), now))
      .toBe('stale')
  })

  it('refuses a non-numeric timestamp', () => {
    expect(verifySlackSignature({ timestamp: 'soon', signature: 'v0=x' }, SECRET, Buffer.from(BODY), now)).toBe('stale')
  })

  it('refuses a signature without the v0 prefix', () => {
    expect(verifySlackSignature({ timestamp: fresh, signature: signOf(fresh, BODY).slice(3) }, SECRET, Buffer.from(BODY), now))
      .toBe('invalid')
  })

  it('refuses a signature over different bytes', () => {
    expect(verifySlackSignature({ timestamp: fresh, signature: signOf(fresh, '{"other":true}') }, SECRET, Buffer.from(BODY), now))
      .toBe('invalid')
  })
})

describe('parseInteractivePayload', () => {
  it('parses the percent-encoded JSON payload field', () => {
    const payload = { type: 'block_actions', channel: { id: 'C1' } }
    const form = `payload=${encodeURIComponent(JSON.stringify(payload))}`
    expect(parseInteractivePayload(form)).toEqual(payload)
  })

  it.each([
    ['no payload', 'text=hello', /no payload field/],
    ['payload is not JSON', 'payload=%7Bnot-json', /not valid JSON/],
  ] as const)('refuses a form with %s', (_name, body, message) => {
    expect(() => parseInteractivePayload(body)).toThrow(message)
  })
})

import { describe, expect, it } from 'vitest'
import { secretTokenMatches } from '../src/callback.ts'

describe('secretTokenMatches', () => {
  it('accepts the exact secret token', () => {
    expect(secretTokenMatches('fixture-secret-token', 'fixture-secret-token')).toBe(true)
  })

  it.each([
    ['a missing header', undefined],
    ['a different token', 'another-token'],
    ['a partial token', 'fixture-secret'],
  ] as const)('refuses %s', (_name, received) => {
    expect(secretTokenMatches(received, 'fixture-secret-token')).toBe(false)
  })
})

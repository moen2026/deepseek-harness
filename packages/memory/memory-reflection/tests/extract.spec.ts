import { describe, expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import {
  DEFAULT_REFLECTION_CONFIDENCE,
  MAX_REFLECTION_CANDIDATES,
  buildReflectionSystem,
  clampReflectionMessages,
  finishFailure,
  frameReflectionInput,
  parseReflectionCandidates,
  resolveReflectionRoute,
} from '@deepseek-ai/dsh-memory-reflection'
import type { ReflectionTurnEntry } from '@deepseek-ai/dsh-memory-reflection'

function entry(seq: number, role: 'user' | 'assistant', text: string): ReflectionTurnEntry {
  return { seq: SessionSeq(seq), role, text }
}

describe('parseReflectionCandidates', () => {
  it('parses a bare JSON answer into validated candidates', () => {
    expect(parseReflectionCandidates(
      '{"memories":[{"text":"  prefers tabs  ","namespace":"style","confidence":0.9}]}',
    )).toEqual([{ text: 'prefers tabs', namespace: 'style', confidence: 0.9 }])
  })

  it('tolerates prose around the JSON object', () => {
    expect(parseReflectionCandidates(
      'Here you go: {"memories":[{"text":"uses pnpm"}]} hope this helps',
    )).toEqual([{ text: 'uses pnpm', namespace: 'fact', confidence: DEFAULT_REFLECTION_CONFIDENCE }])
  })

  it('returns nothing for an answer with no object or invalid JSON', () => {
    expect(parseReflectionCandidates('no object here')).toEqual([])
    expect(parseReflectionCandidates('{not json}')).toEqual([])
  })

  it('returns nothing when the memories field is missing or not an array', () => {
    expect(parseReflectionCandidates('{"other":[]}')).toEqual([])
    expect(parseReflectionCandidates('{"memories":5}')).toEqual([])
    expect(parseReflectionCandidates('[{"text":"x"}]')).toEqual([])
  })

  it('skips non-object items and blank text', () => {
    expect(parseReflectionCandidates('{"memories":[7,{"text":"   "},{"text":"kept"}]}'))
      .toEqual([{ text: 'kept', namespace: 'fact', confidence: DEFAULT_REFLECTION_CONFIDENCE }])
  })

  it('defaults an unknown namespace and an invalid confidence', () => {
    expect(parseReflectionCandidates(
      '{"memories":[{"text":"a","namespace":"mood","confidence":2},{"text":"b","confidence":"high"}]}',
    )).toEqual([
      { text: 'a', namespace: 'fact', confidence: DEFAULT_REFLECTION_CONFIDENCE },
      { text: 'b', namespace: 'fact', confidence: DEFAULT_REFLECTION_CONFIDENCE },
    ])
  })

  it('keeps a valid namespace and boundary confidences', () => {
    expect(parseReflectionCandidates(
      '{"memories":[{"text":"a","namespace":"preference","confidence":0},{"text":"b","namespace":"style","confidence":1}]}',
    )).toEqual([
      { text: 'a', namespace: 'preference', confidence: 0 },
      { text: 'b', namespace: 'style', confidence: 1 },
    ])
  })

  it('stops at the candidate cap', () => {
    const memories = Array.from({ length: MAX_REFLECTION_CANDIDATES + 1 }, (_, index) => ({ text: `m${index}` }))
    const parsed = parseReflectionCandidates(JSON.stringify({ memories }))
    expect(parsed).toHaveLength(MAX_REFLECTION_CANDIDATES)
    expect(parsed.at(-1)?.text).toBe(`m${MAX_REFLECTION_CANDIDATES - 1}`)
  })
})

describe('clampReflectionMessages', () => {
  it('returns every message when the complete framed input fits', () => {
    const messages = [entry(3, 'user', 'question'), entry(4, 'assistant', 'answer')]
    expect(clampReflectionMessages(messages, 10_000)).toEqual(messages)
  })

  it('returns nothing for an empty turn or a cap below the empty frame', () => {
    expect(clampReflectionMessages([], 1_000)).toEqual([])
    expect(clampReflectionMessages([entry(1, 'user', 'x')], 1)).toEqual([])
  })

  it('keeps the most recent messages that fit whole', () => {
    const head = entry(1, 'user', 'h'.repeat(200))
    const tail = entry(2, 'assistant', 'ok')
    const cap = Buffer.byteLength(frameReflectionInput([tail]), 'utf8')
    expect(clampReflectionMessages([head, tail], cap)).toEqual([tail])
  })

  it('truncates an oversized final message instead of dropping it', () => {
    const last = entry(5, 'user', '你'.repeat(50))
    const cap = Buffer.byteLength(frameReflectionInput([{ ...last, text: '' }]), 'utf8') + 10
    const clamped = clampReflectionMessages([last], cap)
    expect(clamped).toHaveLength(1)
    const kept = clamped[0]
    if (kept === undefined) throw new Error('expected one clamped entry')
    // 10 bytes of room fit exactly three 3-byte characters without splitting one.
    expect(kept.text).toBe('你'.repeat(3))
    expect(last.text.startsWith(kept.text)).toBe(true)
    expect(Buffer.byteLength(frameReflectionInput(clamped), 'utf8')).toBeLessThanOrEqual(cap)
  })
})

describe('resolveReflectionRoute', () => {
  it('prefers a complete explicit pair', () => {
    expect(resolveReflectionRoute({ provider: 'p', model: 'm' }, { provider: 's', model: 'sm' }))
      .toEqual({ provider: 'p', model: 'm' })
  })

  it('falls back to the session route for an absent or incomplete pair', () => {
    expect(resolveReflectionRoute({}, { provider: 's', model: 'sm' }))
      .toEqual({ provider: 's', model: 'sm' })
    expect(resolveReflectionRoute({ provider: 'p' }, { provider: 's', model: 'sm' }))
      .toEqual({ provider: 's', model: 'sm' })
  })

  it('returns nothing when neither source provides a route', () => {
    expect(resolveReflectionRoute({}, undefined)).toBeUndefined()
  })
})

describe('finishFailure', () => {
  it('returns nothing for a clean stop', () => {
    expect(finishFailure({ kind: 'stop' })).toBeUndefined()
  })

  it('preserves a terminal failure message and code', () => {
    expect(finishFailure({ kind: 'error', failure: { message: 'provider failed', code: 'SERVER' } }))
      .toMatchObject({ message: 'provider failed', code: 'SERVER' })
    expect(finishFailure({ kind: 'aborted', failure: { message: 'provider aborted', code: 'ABORTED' } }))
      .toMatchObject({ message: 'provider aborted', code: 'ABORTED' })
  })

  it('translates the remaining known finishes and an unknown kind', () => {
    expect(finishFailure({ kind: 'max-tokens' })?.message).toMatch(/reached maxOutputTokens/)
    expect(finishFailure({ kind: 'tool-calls' })?.message).toMatch(/unexpectedly requested a tool/)
    expect(finishFailure({ kind: 'future-finish' } as never)?.message)
      .toMatch(/unsupported finish reason "future-finish"/)
  })
})

describe('prompt construction', () => {
  it('states the JSON extraction contract', () => {
    const system = buildReflectionSystem()
    expect(system).toContain('JSON')
    expect(system).toContain('{"memories":[]}')
  })

  it('frames messages as JSON without the entry seqs', () => {
    const framed = frameReflectionInput([entry(7, 'user', 'hello')])
    expect(framed).toContain('"role":"user"')
    expect(framed).toContain('"text":"hello"')
    expect(framed).not.toContain('"seq"')
  })
})

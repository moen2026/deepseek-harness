import { describe, expect, it } from 'vitest'
import { MEMORY_NAMESPACES } from '@deepseek-ai/dsh-memory'
import type { MemoryErrorCode } from '@deepseek-ai/dsh-memory'
import {
  cosineSimilarity,
  decodeVector,
  encodeVector,
  fuseOrder,
  normalizeConfidence,
  normalizeDraft,
  normalizeNamespace,
  normalizeQuery,
  normalizeRecall,
  normalizeTags,
  normalizeTtl,
  quoteFtsData,
  reciprocalRankFusion,
  RECALL_POOL_FACTOR,
  RRF_K,
  sanitizeFtsText,
  FTS_HIGHLIGHT_END,
  FTS_HIGHLIGHT_START,
} from '../src/query.ts'

const limits = { defaultLimit: 2, maxLimit: 8 }

function expectCode(code: MemoryErrorCode): Error {
  return expect.objectContaining({ code }) as Error
}

describe('sanitizeFtsText', () => {
  it('maps NUL and reserved highlight markers to replacement characters', () => {
    const replacement = '\uFFFD'
    expect(sanitizeFtsText(`a\0b${FTS_HIGHLIGHT_START}c${FTS_HIGHLIGHT_END}d`))
      .toBe(`a${replacement}b${replacement}c${replacement}d`)
  })
})

describe('quoteFtsData', () => {
  it('quotes caller text as one escaped phrase so query syntax stays inert data', () => {
    expect(quoteFtsData('say "note" OR *')).toBe('"say ""note"" OR *"')
  })
})

describe('normalizeQuery', () => {
  it('collapses whitespace and wraps the result as an inert phrase', () => {
    expect(normalizeQuery('  alpha\n beta  ')).toBe('"alpha beta"')
  })

  it('rejects blank and NUL-bearing queries', () => {
    expect(() => normalizeQuery(' \n ')).toThrow(expectCode('MEMORY_INVALID_REQUEST'))
    expect(() => normalizeQuery('bad\0query')).toThrow(expectCode('MEMORY_INVALID_REQUEST'))
  })

  it('rejects a non-string query', () => {
    // @ts-expect-error -- an untyped caller can pass a non-string query
    expect(() => normalizeQuery(42)).toThrow(expectCode('MEMORY_INVALID_REQUEST'))
  })
})

describe('normalizeTags', () => {
  it('trims, de-duplicates, and drops empty tags in first-seen order', () => {
    expect(normalizeTags([' a ', 'a', '', 'b', '  '])).toEqual(['a', 'b'])
    expect(normalizeTags(undefined)).toEqual([])
  })

  it('rejects a non-string element', () => {
    // @ts-expect-error -- an untyped caller can pass a non-string element
    expect(() => normalizeTags(['ok', 5])).toThrow(expectCode('MEMORY_INVALID_REQUEST'))
  })
})

describe('normalizeNamespace', () => {
  it('accepts every declared namespace and rejects an unrecognized value', () => {
    for (const namespace of MEMORY_NAMESPACES) expect(normalizeNamespace(namespace)).toBe(namespace)
    expect(normalizeNamespace(undefined)).toBeUndefined()
    // @ts-expect-error -- an untyped caller can pass a value outside the vocabulary
    expect(() => normalizeNamespace('mood')).toThrow(expectCode('MEMORY_INVALID_REQUEST'))
  })
})

describe('normalizeConfidence', () => {
  it('accepts the closed 0..1 range and rejects anything outside it', () => {
    expect(normalizeConfidence(0, 'memory confidence')).toBe(0)
    expect(normalizeConfidence(1, 'memory confidence')).toBe(1)
    expect(normalizeConfidence(undefined, 'memory confidence')).toBeUndefined()
    for (const invalid of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => normalizeConfidence(invalid, 'memory minConfidence')).toThrow(/memory minConfidence/)
    }
  })
})

describe('normalizeTtl', () => {
  it('accepts positive integers and rejects non-positive or unsafe values', () => {
    expect(normalizeTtl(1)).toBe(1)
    expect(normalizeTtl(undefined)).toBeUndefined()
    for (const invalid of [0, -5, 1.5, Number.NaN, Number.MAX_VALUE]) {
      expect(() => normalizeTtl(invalid)).toThrow(expectCode('MEMORY_INVALID_REQUEST'))
    }
  })
})

describe('normalizeDraft', () => {
  it('trims text, normalizes tags, and only sets a present scope', () => {
    expect(normalizeDraft({ text: '  likes tests  ', tags: ['pref', 'pref', ''] }, 100))
      .toEqual({ text: 'likes tests', tags: ['pref'] })
    expect(normalizeDraft({ text: 'x', scope: ' proj ' }, 100))
      .toEqual({ text: 'x', tags: [], scope: 'proj' })
  })

  it('rejects blank text and text beyond the byte ceiling', () => {
    expect(() => normalizeDraft({ text: '   ' }, 100)).toThrow(expectCode('MEMORY_INVALID_REQUEST'))
    expect(() => normalizeDraft({ text: 'aé'.repeat(60) }, 50)).toThrow(expectCode('MEMORY_INVALID_REQUEST'))
  })

  it('rejects non-string text', () => {
    // @ts-expect-error -- an untyped caller can pass non-string text
    expect(() => normalizeDraft({ text: 42 }, 100)).toThrow(expectCode('MEMORY_INVALID_REQUEST'))
  })

  it('carries validated namespace, confidence, and ttl only when present', () => {
    expect(normalizeDraft({ text: 'x', namespace: 'style', confidence: 0.5, ttlMs: 60_000 }, 100))
      .toEqual({ text: 'x', tags: [], namespace: 'style', confidence: 0.5, ttlMs: 60_000 })
    // @ts-expect-error -- an untyped caller can pass a value outside the vocabulary
    expect(() => normalizeDraft({ text: 'x', namespace: 'mood' }, 100)).toThrow(expectCode('MEMORY_INVALID_REQUEST'))
    expect(() => normalizeDraft({ text: 'x', confidence: 2 }, 100)).toThrow(expectCode('MEMORY_INVALID_REQUEST'))
    expect(() => normalizeDraft({ text: 'x', ttlMs: 0 }, 100)).toThrow(expectCode('MEMORY_INVALID_REQUEST'))
  })
})

describe('normalizeRecall', () => {
  it('applies the default limit and prefetches a bounded pool', () => {
    const result = normalizeRecall({ query: 'note' }, limits)
    expect(result.match).toBe('"note"')
    expect(result.limit).toBe(2)
    expect(result.pool).toBe(Math.min(8, 2 * RECALL_POOL_FACTOR))
  })

  it('carries normalized tags and scope only when present', () => {
    expect(normalizeRecall({ query: 'x', tags: ['a', 'a', ' '], scope: ' proj ' }, limits))
      .toMatchObject({ tags: ['a'], scope: 'proj' })
    expect(normalizeRecall({ query: 'x', tags: [' '] }, limits).tags).toBeUndefined()
  })

  it('caps the pool at maxLimit for a large page', () => {
    const big = normalizeRecall({ query: 'x', limit: 8 }, limits)
    expect(big.pool).toBe(8)
  })

  it('rejects a limit beyond the configured maximum or a non-integer', () => {
    expect(() => normalizeRecall({ query: 'x', limit: 9 }, limits)).toThrow(expectCode('MEMORY_INVALID_REQUEST'))
    expect(() => normalizeRecall({ query: 'x', limit: 0 }, limits)).toThrow(expectCode('MEMORY_INVALID_REQUEST'))
    expect(() => normalizeRecall({ query: 'x', limit: 1.5 }, limits)).toThrow(expectCode('MEMORY_INVALID_REQUEST'))
  })

  it('carries a namespace filter and a minimum confidence only when present', () => {
    expect(normalizeRecall({ query: 'x', namespace: 'preference', minConfidence: 0.4 }, limits))
      .toMatchObject({ namespace: 'preference', minConfidence: 0.4 })
    // @ts-expect-error -- an untyped caller can pass a value outside the vocabulary
    expect(() => normalizeRecall({ query: 'x', namespace: 'mood' }, limits)).toThrow(expectCode('MEMORY_INVALID_REQUEST'))
    expect(() => normalizeRecall({ query: 'x', minConfidence: 1.5 }, limits)).toThrow(expectCode('MEMORY_INVALID_REQUEST'))
  })
})

describe('vector encoding', () => {
  it('round-trips a vector through Float32 bytes', () => {
    expect(decodeVector(encodeVector([1, 2.5, -3]))).toEqual([1, 2.5, -3])
  })
})

describe('cosineSimilarity', () => {
  it('is 1 for identical directions, 0 for orthogonal, 0 for a zero vector', () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6)
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

describe('reciprocalRankFusion', () => {
  it('contributes 1/(RRF_K+rank) per list and sums shared ids', () => {
    const scores = reciprocalRankFusion([['a', 'b'], ['b', 'a']])
    expect(scores.get('a')).toBeCloseTo(1 / (RRF_K + 1) + 1 / (RRF_K + 2), 12)
    expect(scores.get('b')).toBeCloseTo(1 / (RRF_K + 2) + 1 / (RRF_K + 1), 12)
  })

  it('returns an empty map for no rankings', () => {
    expect(reciprocalRankFusion([]).size).toBe(0)
  })
})

describe('fuseOrder', () => {
  it('orders by descending fused score, breaking ties by seed order', () => {
    const scores = new Map([['a', 1], ['b', 2], ['c', 1]])
    expect(fuseOrder(scores, ['c', 'a', 'b'])).toEqual(['b', 'c', 'a'])
  })
})

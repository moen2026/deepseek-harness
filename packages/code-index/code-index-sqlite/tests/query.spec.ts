import { describe, expect, it } from 'vitest'
import type { CodeIndexErrorCode } from '@deepseek-ai/dsh-code-index'
import {
  FTS_HIGHLIGHT_END,
  FTS_HIGHLIGHT_START,
  globToLike,
  makeSnippet,
  normalizeQuery,
  normalizeSearch,
  quoteFtsData,
  sanitizeFtsText,
} from '../src/query.ts'

const limits = { defaultLimit: 2, maxLimit: 3 }

function expectCode(code: CodeIndexErrorCode): Error {
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
    expect(quoteFtsData('say "needle" OR *')).toBe('"say ""needle"" OR *"')
  })
})

describe('normalizeQuery', () => {
  it('collapses whitespace and wraps the result as an inert phrase', () => {
    expect(normalizeQuery('  alpha\n beta  ')).toBe('"alpha beta"')
  })

  it('rejects blank and NUL-bearing queries', () => {
    expect(() => normalizeQuery(' \n ')).toThrow(expectCode('CODE_INDEX_INVALID_REQUEST'))
    expect(() => normalizeQuery('bad\0query')).toThrow(expectCode('CODE_INDEX_INVALID_REQUEST'))
  })

  it('rejects a non-string query at the untyped boundary', () => {
    // @ts-expect-error a non-string query reaches this guard only from an untyped caller boundary.
    expect(() => normalizeQuery(42)).toThrow(expectCode('CODE_INDEX_INVALID_REQUEST'))
  })
})

describe('globToLike', () => {
  it('returns undefined for an absent or blank glob', () => {
    expect(globToLike(undefined)).toBeUndefined()
    expect(globToLike('   ')).toBeUndefined()
  })

  it('translates `*` and `?`, normalizes separators, and escapes LIKE wildcards', () => {
    expect(globToLike('src/*.ts')).toBe('src/%.ts')
    expect(globToLike('a/**/b')).toBe('a/%%/b')
    expect(globToLike('a?b')).toBe('a_b')
    expect(globToLike('win\\path')).toBe('win/path')
    expect(globToLike('50%_off')).toBe('50\\%\\_off')
  })
})

describe('normalizeSearch', () => {
  it('applies the default limit and only sets present refinements', () => {
    expect(normalizeSearch({ query: 'needle' }, limits)).toEqual({ match: '"needle"', limit: 2 })
    expect(normalizeSearch({ query: 'needle', glob: 'src/*.ts', language: ' typescript ', limit: 3 }, limits)).toEqual({
      match: '"needle"',
      pathLike: 'src/%.ts',
      language: 'typescript',
      limit: 3,
    })
  })

  it('drops a whitespace-only language and glob', () => {
    expect(normalizeSearch({ query: 'x', glob: '  ', language: ' ' }, limits)).toEqual({ match: '"x"', limit: 2 })
  })

  it('rejects a limit beyond the configured maximum', () => {
    expect(() => normalizeSearch({ query: 'x', limit: 4 }, limits)).toThrow(expectCode('CODE_INDEX_INVALID_REQUEST'))
    expect(() => normalizeSearch({ query: 'x', limit: 0 }, limits)).toThrow(expectCode('CODE_INDEX_INVALID_REQUEST'))
    expect(() => normalizeSearch({ query: 'x', limit: 1.5 }, limits)).toThrow(expectCode('CODE_INDEX_INVALID_REQUEST'))
  })
})

describe('makeSnippet', () => {
  it('strips markers and collapses whitespace', () => {
    expect(makeSnippet('  short\ntext  ', 20)).toBe('short text')
    expect(makeSnippet(`ab${FTS_HIGHLIGHT_START}cd${FTS_HIGHLIGHT_END}ef`, 20)).toBe('abcdef')
  })

  it('bounds to maxChars with an ellipsis', () => {
    expect(makeSnippet('abcdefghij', 5)).toBe('abcd…')
    expect(makeSnippet('ab', 1)).toBe('…')
    expect(makeSnippet('abc', 0)).toBe('…')
  })
})

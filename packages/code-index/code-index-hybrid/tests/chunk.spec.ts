import { describe, expect, it } from 'vitest'
import { chunkFile } from '../src/chunk.ts'

describe('chunkFile', () => {
  it('returns no chunks for empty or all-blank text', () => {
    expect(chunkFile('', 40, 4)).toEqual([])
    expect(chunkFile('\n\n  \n\n', 40, 4)).toEqual([])
  })

  it('keeps a short file as one chunk with one-based line numbers', () => {
    expect(chunkFile('a\nb\nc', 40, 4)).toEqual([{ text: 'a\nb\nc', startLine: 1, endLine: 3 }])
  })

  it('packs whole blocks and cuts only at block boundaries within the budget', () => {
    const text = ['h1', 'l1', 'l2', '', 'h2', 'm1', 'm2', '', 'h3', 'n1'].join('\n')
    const chunks = chunkFile(text, 4, 0)
    expect(chunks.map(chunk => [chunk.startLine, chunk.endLine])).toEqual([[1, 3], [4, 7], [8, 10]])
    for (const chunk of chunks) {
      const lines = chunk.text.split('\n')
      expect(lines).toHaveLength(chunk.endLine - chunk.startLine + 1)
      // Every chunk ends inside a block: its last line has content.
      expect(lines[lines.length - 1]?.trim().length).toBeGreaterThan(0)
    }
  })

  it('hard-splits a single block longer than the line budget', () => {
    const text = Array.from({ length: 10 }, (_, index) => `line${index + 1}`).join('\n')
    const chunks = chunkFile(text, 4, 0)
    expect(chunks.map(chunk => [chunk.startLine, chunk.endLine])).toEqual([[1, 4], [5, 8], [9, 10]])
  })

  it('re-opens the trailing overlap lines in the next chunk', () => {
    const text = ['b1', 'b2', 'b3', 'b4', 'b5', '', 'c1', 'c2', 'c3', 'c4', 'c5'].join('\n')
    const chunks = chunkFile(text, 5, 3)
    expect(chunks.map(chunk => [chunk.startLine, chunk.endLine])).toEqual([[1, 5], [3, 7], [5, 9], [7, 11]])
    for (let i = 1; i < chunks.length; i += 1) {
      // Consecutive chunks share the overlap window.
      expect(chunks[i - 1]?.endLine).toBeGreaterThanOrEqual(chunks[i]?.startLine ?? 0)
    }
  })

  it('keeps consecutive chunks disjoint when overlap is zero', () => {
    const text = ['b1', 'b2', 'b3', 'b4', 'b5', '', 'c1', 'c2', 'c3', 'c4', 'c5'].join('\n')
    const chunks = chunkFile(text, 5, 0)
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]?.startLine).toBe((chunks[i - 1]?.endLine ?? 0) + 1)
    }
  })

  it('skips an all-blank window without losing line alignment', () => {
    const chunks = chunkFile('\n\nabc', 2, 0)
    expect(chunks).toEqual([{ text: 'abc', startLine: 3, endLine: 3 }])
  })

  it('ignores the trailing-newline split artifact', () => {
    expect(chunkFile('a\nb\n', 40, 4)).toEqual([{ text: 'a\nb', startLine: 1, endLine: 2 }])
  })
})

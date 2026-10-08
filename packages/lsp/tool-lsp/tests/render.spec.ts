import { describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import {
  DEFAULT_MAX_LOCATIONS,
  DEFAULT_MAX_RESULT_CHARS,
  formatDiagnostics,
  formatHover,
  formatLocations,
  LSP_OPERATIONS,
  parseLspArgs,
  presentLspCall,
  renderUri,
} from '@deepseek-ai/dsh-tool-lsp'
import type { LspDiagnostic, LspLocation } from '@deepseek-ai/dsh-lsp'

const WS = resolve('/home/u/proj')
const WS_URI = pathToFileURL(WS).href

function loc(uri: string, line: number, character = 0): LspLocation {
  return { uri, range: { start: { line, character }, end: { line, character: character + 1 } } }
}

describe('parseLspArgs', () => {
  it('accepts the cursor operations and converts one-based to zero-based', () => {
    for (const operation of LSP_OPERATIONS) {
      if (operation === 'diagnostics') continue
      const input = parseLspArgs({ operation, file_path: 'a.ts', line: 3, character: 5 })
      expect(input.operation).toBe(operation)
      expect(input.position).toEqual({ line: 2, character: 4 })
    }
  })

  it('treats diagnostics as file-level and drops any coordinates', () => {
    const input = parseLspArgs({ operation: 'diagnostics', file_path: 'a.ts' })
    expect(input.operation).toBe('diagnostics')
    expect(input.position).toBeUndefined()
    // Coordinates sent alongside diagnostics are ignored, not validated.
    expect(parseLspArgs({ operation: 'diagnostics', file_path: 'a.ts', line: 0, character: -3 }).position).toBeUndefined()
  })

  it('rejects an unknown operation', () => {
    expect(() => parseLspArgs({ operation: 'rename', file_path: 'a.ts', line: 1, character: 1 }))
      .toThrow(/operation must be one of/)
  })

  it('rejects a blank file_path', () => {
    expect(() => parseLspArgs({ operation: 'hover', file_path: '   ', line: 1, character: 1 }))
      .toThrow(/file_path/)
  })

  it('rejects non-positive or non-integer coordinates', () => {
    expect(() => parseLspArgs({ operation: 'hover', file_path: 'a.ts', line: 0, character: 1 })).toThrow(/line/)
    expect(() => parseLspArgs({ operation: 'hover', file_path: 'a.ts', line: 1, character: 0 })).toThrow(/character/)
    expect(() => parseLspArgs({ operation: 'hover', file_path: 'a.ts', line: 1.5, character: 1 })).toThrow(/line/)
  })
})

describe('renderUri', () => {
  it('relativizes a file: URI inside the workspace with forward slashes', () => {
    const uri = pathToFileURL(join(WS, 'src', 'a.ts')).href
    expect(renderUri(uri, WS_URI)).toBe('src/a.ts')
  })

  it('returns an absolute path for a file: URI outside the workspace', () => {
    const outside = resolve(WS, '..', 'other', 'lib', 'b.ts')
    const uri = pathToFileURL(outside).href
    expect(renderUri(uri, WS_URI)).toBe(outside.replaceAll('\\', '/'))
  })

  it('renders the workspace root itself as "."', () => {
    expect(renderUri(WS_URI, WS_URI)).toBe('.')
  })

  it('keeps an in-workspace path whose first segment starts with dots relative', () => {
    // `..generated` is a real in-workspace dir, not a parent escape; only a `..` segment is external.
    const uri = pathToFileURL(join(WS, '..generated', 'a.ts')).href
    expect(renderUri(uri, WS_URI)).toBe('..generated/a.ts')
  })

  it('relativizes Windows execution-world URIs on a non-Windows host', () => {
    expect(renderUri('file:///C:/WORKSPACE/src/a.ts', 'file:///c:/workspace')).toBe('src/a.ts')
    expect(renderUri('file:///D:/lib/b.ts', 'file:///C:/workspace')).toBe('D:/lib/b.ts')
  })

  it('renders remote file authorities without host path conversion', () => {
    expect(renderUri('file://server/share/workspace/a.ts', 'file://server/share/workspace')).toBe('a.ts')
    expect(renderUri('file://SERVER/share/workspace/src/A.ts', 'file://server/Share/Workspace')).toBe('src/A.ts')
    expect(renderUri('file://other/share/b.ts', 'file://server/share/workspace')).toBe('//other/share/b.ts')
    expect(renderUri('file:///D:/lib/a.ts', 'file://server/share/workspace')).toBe('D:/lib/a.ts')
    expect(renderUri('file:///a.ts', 'file://server/')).toBe('/a.ts')
    expect(renderUri('file:///a.ts', 'file:///')).toBe('a.ts')
  })

  it('preserves backslashes as ordinary POSIX filename characters', () => {
    expect(renderUri('file:///home/u/proj/dir%5Cname/a.ts', 'file:///home/u/proj')).toBe('dir\\name/a.ts')
  })

  it('keeps malformed or mismatched URI coordinates verbatim', () => {
    expect(renderUri('file://[', WS_URI)).toBe('file://[')
    expect(renderUri('file:///a.ts', 'https://example.com/workspace')).toBe('file:///a.ts')
    expect(renderUri('file:///a.ts', 'file:///bad%ZZ')).toBe('file:///a.ts')
    expect(renderUri('file:///C:/workspace/bad%5Cpath', 'file:///C:/workspace')).toBe('file:///C:/workspace/bad%5Cpath')
    expect(renderUri('file:///short', 'file:///short/deeper')).toBe('/short')
    expect(renderUri('file:///', 'file:///C:/workspace')).toBe('/')
  })

  it('keeps a non-file URI verbatim', () => {
    expect(renderUri('untitled:Untitled-1', WS_URI)).toBe('untitled:Untitled-1')
    expect(renderUri('jdt://contents/Foo.class', WS_URI)).toBe('jdt://contents/Foo.class')
  })

  it('keeps a malformed file: URI verbatim when it cannot be parsed to a path', () => {
    // An encoded path separator is invalid on every platform and must remain verbatim.
    expect(renderUri('file:///bad%2Fpath', WS_URI)).toBe('file:///bad%2Fpath')
    expect(renderUri('file:///bad%00path', WS_URI)).toBe('file:///bad%00path')
  })
})

describe('formatLocations', () => {
  it('renders a no-result line for an empty list', () => {
    expect(formatLocations([], WS_URI, DEFAULT_MAX_LOCATIONS, DEFAULT_MAX_RESULT_CHARS)).toBe('No results.')
  })

  it('renders one-based path:line:character grouped by file', () => {
    const a = pathToFileURL(join(WS, 'a.ts')).href
    const text = formatLocations([loc(a, 0, 0), loc(a, 4, 2)], WS_URI, DEFAULT_MAX_LOCATIONS, DEFAULT_MAX_RESULT_CHARS)
    expect(text).toBe('a.ts:1:1\na.ts:5:3')
  })

  it('caps at maxLocations and marks the omission', () => {
    const a = pathToFileURL(join(WS, 'a.ts')).href
    const many = Array.from({ length: 5 }, (_, i) => loc(a, i))
    const text = formatLocations(many, WS_URI, 2, DEFAULT_MAX_RESULT_CHARS)
    expect(text).toContain('a.ts:1:1')
    expect(text).toContain('3 more locations omitted (limit 2).')
  })

  it('uses the singular omission marker for exactly one extra', () => {
    const a = pathToFileURL(join(WS, 'a.ts')).href
    const text = formatLocations([loc(a, 0), loc(a, 1)], WS_URI, 1, DEFAULT_MAX_RESULT_CHARS)
    expect(text).toContain('1 more location omitted (limit 1).')
  })

  it('caps the complete location text even when one URI is enormous', () => {
    const maxResultChars = 80
    const text = formatLocations([loc(`custom:${'x'.repeat(1_000_000)}`, 0)], WS_URI, 1, maxResultChars)
    expect(text).toHaveLength(maxResultChars)
    expect(text).toContain('locations truncated')
  })
})

describe('formatHover', () => {
  it('renders a no-result line for null', () => {
    expect(formatHover(null, DEFAULT_MAX_RESULT_CHARS)).toBe('No hover information.')
  })

  it('returns short hover verbatim', () => {
    expect(formatHover({ contents: '```ts\nx: number\n```' }, DEFAULT_MAX_RESULT_CHARS)).toBe('```ts\nx: number\n```')
  })

  it('caps the complete hover text including its truncation marker', () => {
    const text = formatHover({ contents: 'a'.repeat(100) }, 60)
    expect(text).toHaveLength(60)
    expect(text).toContain('hover truncated (limit 60 characters).')
  })

  it('still honors a cap smaller than the truncation marker', () => {
    expect(formatHover({ contents: 'a'.repeat(100) }, 10)).toHaveLength(10)
  })
})

describe('formatDiagnostics', () => {
  function diag(severity: LspDiagnostic['severity'], message: string, extra: Partial<LspDiagnostic> = {}): LspDiagnostic {
    return { range: { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } }, severity, message, ...extra }
  }

  it('renders a no-problems line for an empty list', () => {
    expect(formatDiagnostics([], 'a.ts', DEFAULT_MAX_LOCATIONS, DEFAULT_MAX_RESULT_CHARS)).toBe('No problems reported.')
  })

  it('renders one-based coordinates, severity, source/code label, and message', () => {
    const text = formatDiagnostics([diag('error', 'boom', { source: 'ts', code: '2345' })], 'src/a.ts', DEFAULT_MAX_LOCATIONS, DEFAULT_MAX_RESULT_CHARS)
    expect(text).toBe('src/a.ts:5:3 error: [ts(2345)] boom')
  })

  it('omits the label when there is no source or code', () => {
    const text = formatDiagnostics([diag('warning', 'hmm')], 'a.ts', DEFAULT_MAX_LOCATIONS, DEFAULT_MAX_RESULT_CHARS)
    expect(text).toBe('a.ts:5:3 warning: hmm')
  })

  it('closes the label without a code when only a source is present', () => {
    const text = formatDiagnostics([diag('error', 'x', { source: 'ts' })], 'a.ts', DEFAULT_MAX_LOCATIONS, DEFAULT_MAX_RESULT_CHARS)
    expect(text).toBe('a.ts:5:3 error: [ts] x')
  })

  it('caps at maxDiagnostics and marks the omission', () => {
    const many = [diag('error', 'a'), diag('error', 'b'), diag('error', 'c')]
    const text = formatDiagnostics(many, 'a.ts', 2, DEFAULT_MAX_RESULT_CHARS)
    expect(text).toContain('a.ts:5:3 error: a')
    expect(text).toContain('a.ts:5:3 error: b')
    expect(text).not.toContain(' error: c')
    expect(text).toContain('1 more problem omitted (limit 2).')
  })

  it('pluralizes the omission marker when more than one problem is omitted', () => {
    const many = [diag('error', 'a'), diag('error', 'b'), diag('error', 'c'), diag('error', 'd')]
    const text = formatDiagnostics(many, 'a.ts', 2, DEFAULT_MAX_RESULT_CHARS)
    expect(text).toContain('2 more problems omitted (limit 2).')
  })
})

describe('presentLspCall', () => {
  it('renders a diagnostics card without a cursor', () => {
    expect(presentLspCall({ operation: 'diagnostics', file_path: 'a.ts' })).toEqual({
      card: 'generic',
      kind: 'search',
      title: 'LSP diagnostics a.ts',
      locations: [{ path: 'a.ts' }],
    })
  })

  it('is a generic search card with an operation/cursor title and a line location', () => {
    expect(presentLspCall({ operation: 'findReferences', file_path: 'a.ts', line: 3, character: 7 })).toEqual({
      card: 'generic',
      kind: 'search',
      title: 'LSP findReferences a.ts:3:7',
      locations: [{ path: 'a.ts', line: 3 }],
    })
  })

  it('omits the line when a cursor operation carries no coordinates', () => {
    // Cursor operations require coordinates by schema; the guard keeps the location exact-optional.
    expect(presentLspCall({ operation: 'hover', file_path: 'a.ts' })).toEqual({
      card: 'generic',
      kind: 'search',
      title: 'LSP hover a.ts:undefined:undefined',
      locations: [{ path: 'a.ts' }],
    })
  })
})

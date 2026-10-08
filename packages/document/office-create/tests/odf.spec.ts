/** Pure OpenDocument builder tests: family routing, block markup, escaping, determinism. */
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildOdfPackage, escapeXml, INTERMEDIATE_SUFFIX } from '../src/odf.ts'

function contentXml(format: 'docx' | 'xlsx' | 'pptx', blocks: Parameters<typeof buildOdfPackage>[0]['blocks'], title = 'T'): string {
  return Buffer.from(unzipSync(buildOdfPackage({ format, title, blocks }))['content.xml']!).toString()
}

describe('ODF builders', () => {
  it('routes every format to its documented intermediate suffix', () => {
    expect(INTERMEDIATE_SUFFIX).toEqual({ docx: 'odt', xlsx: 'ods', pptx: 'odp' })
  })

  it('escapes XML-significant characters in text content', () => {
    expect(escapeXml('a<b>&"c\'d')).toBe('a&lt;b&gt;&amp;&quot;c&apos;d')
    const xml = contentXml('docx', [{ kind: 'text', text: '<tag> & "quote"' }])
    expect(xml).toContain('<text:p>&lt;tag&gt; &amp; &quot;quote&quot;</text:p>')
  })

  it('renders text blocks as headings, paragraphs, lists, tables, and chart placeholders', () => {
    const xml = contentXml('docx', [
      { kind: 'heading', text: 'Section', level: 2 },
      { kind: 'text', text: 'Body' },
      { kind: 'bullets', items: ['one', 'two'] },
      { kind: 'table', rows: [['H1', 'H2'], ['a', 'b']] },
      { kind: 'chartPlaceholder', label: 'Trend' },
    ])
    expect(xml).toContain('<text:h text:outline-level="2">Section</text:h>')
    expect(xml).toContain('<text:p>Body</text:p>')
    expect(xml).toContain('<text:list><text:list-item><text:p>one</text:p></text:list-item><text:list-item><text:p>two</text:p></text:list-item></text:list>')
    expect(xml).toContain('table:number-columns-repeated="2"')
    expect(xml).toContain('<table:table-cell office:value-type="string"><text:p>H1</text:p></table:table-cell>')
    expect(xml).toContain('<text:p>[Chart: Trend]</text:p>')
  })

  it('numbers successive text tables uniquely', () => {
    const xml = contentXml('docx', [
      { kind: 'table', rows: [['a']] },
      { kind: 'table', rows: [['b']] },
    ])
    expect(xml).toContain('table:name="Table1"')
    expect(xml).toContain('table:name="Table2"')
  })

  it('renders spreadsheet blocks as row-major string cells', () => {
    const xml = contentXml('xlsx', [
      { kind: 'heading', text: 'Plan' },
      { kind: 'bullets', items: ['x', 'y'] },
      { kind: 'table', rows: [['H'], ['v']] },
    ])
    expect(xml).toContain('<table:table table:name="Sheet1">')
    expect(xml).toContain('<table:table-cell office:value-type="string"><text:p>Plan</text:p></table:table-cell>')
    expect(xml).toContain('<text:p>x</text:p>')
    expect(xml).toContain('<text:p>v</text:p>')
  })

  it('renders presentations as a title slide plus one slide per heading group', () => {
    const xml = contentXml('pptx', [
      { kind: 'heading', text: 'Overview' },
      { kind: 'bullets', items: ['point'] },
      { kind: 'heading', text: 'Next' },
      { kind: 'chartPlaceholder', label: 'Chart' },
    ], 'Deck')
    expect(xml).toContain('presentation:class="title"')
    expect(xml).toContain('<text:p>Deck</text:p>')
    expect(xml).toContain('<draw:page draw:name="page1">')
    expect(xml).toContain('<draw:page draw:name="page2">')
    expect(xml).toContain('<draw:page draw:name="page3">')
    expect(xml).toContain('• point')
    expect(xml).toContain('[Chart: Chart]')
  })

  it('produces identical bytes for identical requests', () => {
    const request = { format: 'docx' as const, title: 'Same', blocks: [{ kind: 'text' as const, text: 'body' }] }
    expect(Buffer.from(buildOdfPackage(request)).equals(Buffer.from(buildOdfPackage(request)))).toBe(true)
  })

  it('keeps the caller heading when it already equals the title instead of duplicating it', () => {
    const xml = contentXml('docx', [{ kind: 'heading', text: 'Same' }], 'Same')
    expect(xml.match(/<text:h /g)).toHaveLength(1)
  })

  it('rejects malformed blocks before any markup is built', () => {
    expect(() => contentXml('docx', [{ kind: 'heading', text: ' ' }])).toThrow('a heading must have non-empty text')
    expect(() => contentXml('docx', [{ kind: 'heading', text: 'H', level: 0 }])).toThrow('a heading level must be an integer between 1 and 9')
    expect(() => contentXml('docx', [{ kind: 'text', text: '' }])).toThrow('a text block must have non-empty text')
    expect(() => contentXml('docx', [{ kind: 'bullets', items: [] }])).toThrow('a bullets block must have at least one non-empty item')
    expect(() => contentXml('docx', [{ kind: 'bullets', items: ['ok', ' '] }])).toThrow('a bullets block must have at least one non-empty item')
    expect(() => contentXml('docx', [{ kind: 'chartPlaceholder', label: '' }])).toThrow('a chart placeholder must have a non-empty label')
  })

  it('renders a presentation whose first block precedes any heading and whose trailing heading is empty', () => {
    const xml = contentXml('pptx', [
      { kind: 'text', text: 'Intro' },
      { kind: 'table', rows: [['H'], ['v']] },
      { kind: 'heading', text: 'Tail' },
    ], 'Deck')
    expect(xml).toContain('<text:p>Intro</text:p>')
    expect(xml).toContain('<text:p>H</text:p>')
    expect(xml).toContain('<text:p>v</text:p>')
    expect(xml).toContain('<text:p>Tail</text:p>')
    expect(xml).toContain('<draw:page draw:name="page3">')
  })
})

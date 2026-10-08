/** ODF intermediates, format routing, scratch cleanup, and error mapping around the external kit. */
import { access, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Converter, ConverterOptions } from '@deepseek-ai/libreoffice-kit'
import { unzipSync } from 'fflate'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Documents, { type DocumentBlock } from '@deepseek-ai/dsh-documents'
import * as OfficeCreate from '../src/index.ts'

const kit = vi.hoisted(() => ({ create: vi.fn<(options?: ConverterOptions) => Promise<Converter>>() }))
vi.mock('@deepseek-ai/libreoffice-kit', () => ({ createConverter: kit.create }))

const blocks: readonly DocumentBlock[] = [
  { kind: 'heading', text: 'Summary' },
  { kind: 'text', text: 'One paragraph.' },
  { kind: 'bullets', items: ['first', 'second'] },
  { kind: 'table', rows: [['Name', 'Qty'], ['Bolt', '12']] },
  { kind: 'chartPlaceholder', label: 'Quarterly revenue' },
]

const pdfDocx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01])

let ctx: Context
let convert: ReturnType<typeof vi.fn<Converter['convert']>>
let dispose: ReturnType<typeof vi.fn<Converter['dispose']>>

beforeEach(() => {
  ctx = new Context()
  convert = vi.fn<Converter['convert']>().mockImplementation(async ({ outputPath }) => {
    await writeFile(outputPath, pdfDocx)
    return { backend: 'native', missingFonts: [] }
  })
  dispose = vi.fn<Converter['dispose']>().mockResolvedValue(undefined)
  const converter: Converter = {
    backend: 'native', convert, dispose,
    render: vi.fn<Converter['render']>().mockRejectedValue(new Error('Unexpected Converter.render call')),
    renderImages: vi.fn<Converter['renderImages']>().mockRejectedValue(new Error('Unexpected Converter.renderImages call')),
    recalculate: vi.fn<Converter['recalculate']>().mockRejectedValue(new Error('Unexpected Converter.recalculate call')),
  }
  kit.create.mockReset().mockImplementation(async () => ({ ...converter }))
})
afterEach(async () => { await ctx.fiber.dispose() })

/** Mount the documents seam and the office-create provider with the mocked kit. */
async function mount(config: Partial<OfficeCreate.Config> = {}): Promise<void> {
  await ctx.plugin(Documents)
  await ctx.plugin(OfficeCreate, config)
}

it.each([
  ['docx' as const, 'odt', 'application/vnd.oasis.opendocument.text',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['xlsx' as const, 'ods', 'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['pptx' as const, 'odp', 'application/vnd.oasis.opendocument.presentation',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
])('creates a %s from a %s intermediate and reports its media type', async (format, suffix, inputMime, mediaType) => {
  await mount()
  let inputBytes: Uint8Array | undefined
  convert.mockImplementation(async ({ inputPath, outputPath }) => {
    inputBytes = await readFile(inputPath)
    expect(inputPath.endsWith(`.${suffix}`)).toBe(true)
    await writeFile(outputPath, pdfDocx)
    return { backend: 'native', missingFonts: [] }
  })
  const result = await ctx.documents.create({ format, title: 'Quarterly plan', blocks })
  expect(result.mediaType).toBe(mediaType)
  expect(Buffer.from(result.data)).toEqual(pdfDocx)
  // The ODF spec requires the uncompressed mimetype entry first in the package.
  const zip = unzipSync(inputBytes!)
  expect(Buffer.from(zip['mimetype']!).toString()).toBe(inputMime)
  const content = Buffer.from(zip['content.xml']!).toString()
  expect(content).toContain('Quarterly plan')
  if (format === 'docx') {
    expect(content).toContain('<text:h text:outline-level="1">Summary</text:h>')
    expect(content).toContain('[Chart: Quarterly revenue]')
  }
})

it('reuses one converter across calls, removes scratch, and disposes with the fiber', async () => {
  await mount()
  const scratches: string[] = []
  convert.mockImplementation(async ({ inputPath, outputPath }) => {
    scratches.push(dirname(inputPath))
    await writeFile(outputPath, pdfDocx)
    return { backend: 'native', missingFonts: [] }
  })
  await ctx.documents.create({ format: 'docx', title: 'A', blocks: [{ kind: 'text', text: 'a' }] }, new AbortController().signal)
  await ctx.documents.create({ format: 'docx', title: 'B', blocks: [{ kind: 'text', text: 'b' }] })
  expect(kit.create).toHaveBeenCalledTimes(1)
  for (const scratch of scratches) await expect(access(scratch)).rejects.toMatchObject({ code: 'ENOENT' })
  await ctx.fiber.dispose()
  expect(dispose).toHaveBeenCalledTimes(1)
})

it('retries converter creation after a failed kit factory', async () => {
  await mount()
  kit.create.mockImplementationOnce(async () => { throw new Error('engine unavailable') })
  await expect(ctx.documents.create({ format: 'docx', title: 'T', blocks: [] }))
    .rejects.toMatchObject({ code: 'DOCUMENTS_PROVIDER_FAILED' })
  const mediaType: unknown = expect.stringContaining('openxmlformats')
  await expect(ctx.documents.create({ format: 'docx', title: 'T', blocks: [] }))
    .resolves.toMatchObject({ mediaType })
  expect(kit.create).toHaveBeenCalledTimes(2)
})

it('lets caller cancellation surface unwrapped, aborting before the engine runs', async () => {
  await mount()
  const controller = new AbortController()
  controller.abort()
  await expect(ctx.documents.create({ format: 'docx', title: 'T', blocks: [] }, controller.signal))
    .rejects.toSatisfy((error: unknown) => !(error instanceof Object && 'code' in error && (error as { code: string }).code === 'DOCUMENTS_PROVIDER_FAILED'))
  expect(kit.create).toHaveBeenCalledTimes(1)
})

it('rejects an invalid request before any engine work', async () => {
  await mount()
  await expect(ctx.documents.create({ format: 'docx', title: '  ', blocks: [] }))
    .rejects.toMatchObject({ code: 'DOCUMENTS_INVALID_REQUEST' })
  await expect(ctx.documents.create({
    format: 'xlsx', title: 'T',
    blocks: [{ kind: 'table', rows: [['a', 'b'], ['c']] }],
  })).rejects.toMatchObject({ code: 'DOCUMENTS_INVALID_REQUEST' })
  expect(kit.create).not.toHaveBeenCalled()
})

it('maps engine failures to DOCUMENTS_PROVIDER_FAILED and removes scratch', async () => {
  await mount()
  let scratch = ''
  convert.mockImplementation(async ({ inputPath }) => {
    scratch = dirname(inputPath)
    throw new Error('engine diagnostic')
  })
  const message: unknown = expect.stringContaining('engine diagnostic')
  await expect(ctx.documents.create({ format: 'docx', title: 'T', blocks: [] }))
    .rejects.toMatchObject({ code: 'DOCUMENTS_PROVIDER_FAILED', message })
  await expect(access(scratch)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('stringifies non-Error engine failures into the provider-failed message', async () => {
  await mount()
  convert.mockImplementation(async () => { throw 'boom' })
  const message: unknown = expect.stringContaining('boom')
  await expect(ctx.documents.create({ format: 'docx', title: 'T', blocks: [] }))
    .rejects.toMatchObject({ code: 'DOCUMENTS_PROVIDER_FAILED', message })
})

it('refuses oversized engine output and removes scratch', async () => {
  await mount({ maxOutputBytes: pdfDocx.length - 1 })
  let scratch = ''
  convert.mockImplementation(async ({ inputPath, outputPath }) => {
    scratch = dirname(inputPath)
    await writeFile(outputPath, pdfDocx)
    return { backend: 'native', missingFonts: [] }
  })
  await expect(ctx.documents.create({ format: 'docx', title: 'T', blocks: [] }))
    .rejects.toMatchObject({ code: 'DOCUMENTS_PROVIDER_FAILED' })
  await expect(access(scratch)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('passes the configured timeout to the kit and honors config defaults', async () => {
  await mount({ timeoutMs: 321 })
  await ctx.documents.create({ format: 'docx', title: 'T', blocks: [] })
  expect(kit.create).toHaveBeenCalledExactlyOnceWith({ timeoutMs: 321 })
  expect(OfficeCreate.Config({}).timeoutMs).toBe(OfficeCreate.OFFICE_CREATE_DEFAULT_TIMEOUT_MS)
  expect(OfficeCreate.Config({}).maxOutputBytes).toBe(OfficeCreate.OFFICE_CREATE_DEFAULT_MAX_OUTPUT_BYTES)
})

/** Created documents commit to the workspace and declare their delivery after a successful result. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import Documents, { type DocumentCreateRequest, type DocumentsProvider } from '@deepseek-ai/dsh-documents'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolDocument from '../src/index.ts'

const DOC_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x0a])
const DOC_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const cleanups: Array<() => Promise<unknown>> = []
let callNumber = 0
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
  vi.restoreAllMocks()
})

async function agent(ctx: Context, cwd: string | undefined): Promise<Agent> {
  const id = SessionId(`document-owner-${++callNumber}`)
  let scope: Scope
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0, ...cwd === undefined ? {} : { cwd }, isSeeded: false,
  })
  const value: Agent = {
    id,
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    get ctx() { return scope.ctx },
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, value) }, { inject: ['tools'] }))
  await ctx.agents.register(value)
  return value
}

/** Mount the harness with the documents seam and a scripted provider (or none). */
async function setup(provider?: DocumentsProvider) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-document-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(Documents)
  if (provider !== undefined) ctx.documents.registerProvider(provider)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
  await ctx.plugin(ToolDocument, {})
  const owner = await agent(ctx, root)
  owner.session.append('turn/start', { turn: 1 })
  const execute = (args: unknown) => ctx.tools.execute({
    signal: new AbortController().signal, callId: ToolCallId(`call-${++callNumber}`),
    name: 'create_document', arguments: args, agent: owner,
  })
  return { ctx, owner, root, execute }
}

function makeProvider(overrides: Partial<DocumentsProvider> = {}): DocumentsProvider & { seenRequests: DocumentCreateRequest[] } {
  const seenRequests: DocumentCreateRequest[] = []
  return {
    id: 'scripted',
    seenRequests,
    create: (request) => { seenRequests.push(request); return Promise.resolve({ data: DOC_BYTES, mediaType: DOC_MEDIA_TYPE }) },
    ...overrides,
  }
}

const args = {
  format: 'docx',
  title: 'Quarterly plan',
  file_path: 'report.docx',
  blocks: [{ kind: 'heading', text: 'Summary', level: 2 }, { kind: 'text', text: 'Body' }],
}

describe('create_document', () => {
  it('creates a document, writes it to the workspace, and records one delivery', async () => {
    const provider = makeProvider()
    const { owner, root, execute } = await setup(provider)
    const result = await execute(args)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('create_document failed')
    expect(result.value).toEqual({ status: 'ok', path: join(root, 'report.docx'), mediaType: DOC_MEDIA_TYPE, bytes: DOC_BYTES.byteLength })
    expect(provider.seenRequests[0]).toMatchObject({ format: 'docx', title: 'Quarterly plan' })
    expect(await readFile(join(root, 'report.docx'))).toEqual(Buffer.from(DOC_BYTES))
    const deliveries = owner.session.snapshotEvents().filter(event => event.type === 'deliverables/presented')
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]?.data.files).toEqual([{ path: join(root, 'report.docx'), description: 'Quarterly plan' }])
  })

  it('returns an actionable unavailable answer when no provider is mounted', async () => {
    const { root, execute } = await setup()
    const result = await execute(args)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('create_document failed')
    expect(result.value).toEqual({ status: 'unavailable' })
    await expect(readFile(join(root, 'report.docx'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never overwrites an existing file at the requested path', async () => {
    const { root, execute, owner } = await setup(makeProvider())
    await writeFile(join(root, 'report.docx'), 'existing')
    const result = await execute(args)
    expect(result.isError).toBe(true)
    expect(await readFile(join(root, 'report.docx'), 'utf8')).toBe('existing')
    expect(owner.session.snapshotEvents().some(event => event.type === 'deliverables/presented')).toBe(false)
  })

  it.each([
    [{ ...args, format: 'pdf' }],
    [{ ...args, title: '   ' }],
    [{ ...args, file_path: '' }],
    [{ ...args, blocks: 'nope' }],
    [{ ...args, blocks: [{ kind: 'table', rows: [['a', 'b'], ['c']] }] }],
    [{ ...args, blocks: [{ kind: 'chartPlaceholder', label: ' ' }] }],
    [{ ...args, blocks: ['plain'] }],
    [{ ...args, blocks: [{ kind: 'heading', text: '  ' }] }],
    [{ ...args, blocks: [{ kind: 'heading', text: 'H', level: 0 }] }],
    [{ ...args, blocks: [{ kind: 'text', text: ' ' }] }],
    [{ ...args, blocks: [{ kind: 'bullets', items: ['x', '  '] }] }],
  ])('rejects invalid arguments %j', async (bad) => {
    const { execute, owner } = await setup(makeProvider())
    expect((await execute(bad)).isError).toBe(true)
    expect(owner.session.snapshotEvents().some(event => event.type === 'deliverables/presented')).toBe(false)
  })

  it('rethrows provider failures the model can read instead of reporting unavailable', async () => {
    const failing: DocumentsProvider = {
      id: 'failing',
      create: () => Promise.reject(new Error('engine exploded')),
    }
    const { execute, owner } = await setup(failing)
    expect((await execute(args)).isError).toBe(true)
    expect(owner.session.snapshotEvents().some(event => event.type === 'deliverables/presented')).toBe(false)
  })

  it('requires an agent, an open turn, and a workspace', async () => {
    const { ctx, owner, execute } = await setup(makeProvider())
    const detached = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('detached'), name: 'create_document', arguments: args })
    expect(detached.isError).toBe(true)
    owner.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect((await execute(args)).isError).toBe(true)
    const noWorkspace = await agent(ctx, undefined)
    noWorkspace.session.append('turn/start', { turn: 1 })
    const absent = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('no-workspace'), name: 'create_document', arguments: args, agent: noWorkspace })
    expect(absent.isError).toBe(true)
  })
})

describe('parseCreateDocumentArgs', () => {
  const base = { format: 'docx', title: 'T', file_path: 'a.docx', blocks: [] as unknown[] }

  it('rejects malformed top-level arguments', () => {
    expect(() => ToolDocument.parseCreateDocumentArgs(null)).toThrow('arguments must be an object')
    expect(() => ToolDocument.parseCreateDocumentArgs(7)).toThrow('arguments must be an object')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, format: 'pdf' })).toThrow('format must be docx, xlsx, or pptx')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, title: ' ' })).toThrow('title must be a non-empty string')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, file_path: '' })).toThrow('file_path must be a non-empty string')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, blocks: 'nope' })).toThrow('blocks must be an array')
  })

  it('rejects malformed blocks with an actionable field name', () => {
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, blocks: ['plain'] })).toThrow('blocks[0] must be an object')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, blocks: [{ kind: 'diagram' }] }))
      .toThrow('blocks[0].kind must be heading, text, bullets, table, or chartPlaceholder')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, blocks: [{ kind: 'text', text: ' ' }] })).toThrow('blocks[0] text requires non-empty text')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, blocks: [{ kind: 'heading', text: ' ' }] })).toThrow('blocks[0] heading requires non-empty text')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, blocks: [{ kind: 'heading', text: 'H', level: 0 }] })).toThrow('blocks[0] heading level must be an integer between 1 and 9')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, blocks: [{ kind: 'heading', text: 'H', level: 1.5 }] })).toThrow('blocks[0] heading level must be an integer between 1 and 9')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, blocks: [{ kind: 'bullets', items: 'nope' }] })).toThrow('blocks[0] bullets requires a non-empty items array')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, blocks: [{ kind: 'bullets', items: [] }] })).toThrow('blocks[0] bullets requires a non-empty items array')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, blocks: [{ kind: 'bullets', items: ['ok', ' '] }] })).toThrow('blocks[0] bullets requires a non-empty items array')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, blocks: [{ kind: 'table', rows: 'nope' }] })).toThrow('blocks[0] table requires a non-empty rectangular rows array')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, blocks: [{ kind: 'table', rows: [] }] })).toThrow('blocks[0] table requires a non-empty rectangular rows array')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, blocks: [{ kind: 'table', rows: ['nope'] }] })).toThrow('blocks[0] table requires a non-empty rectangular rows array')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, blocks: [{ kind: 'table', rows: [[]] }] })).toThrow('blocks[0] table requires a non-empty rectangular rows array')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, blocks: [{ kind: 'table', rows: [['a', 'b'], ['c']] }] })).toThrow('blocks[0] table requires a non-empty rectangular rows array')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, blocks: [{ kind: 'table', rows: [['a', ''], ['b', 'c']] }] })).toThrow('blocks[0] table requires a non-empty rectangular rows array')
    expect(() => ToolDocument.parseCreateDocumentArgs({ ...base, blocks: [{ kind: 'chartPlaceholder', label: 7 }] })).toThrow('blocks[0] chartPlaceholder requires a non-empty label')
  })

  it('normalizes trimmed scalars and optional heading levels', () => {
    const parsed = ToolDocument.parseCreateDocumentArgs({
      format: 'docx', title: ' T ', file_path: ' a.docx ',
      blocks: [
        { kind: 'heading', text: 'H' },
        { kind: 'heading', text: 'H2', level: 3 },
        { kind: 'text', text: 'Body' },
        { kind: 'bullets', items: ['x'] },
        { kind: 'table', rows: [['a'], ['b']] },
        { kind: 'chartPlaceholder', label: 'C' },
      ],
    })
    expect(parsed.title).toBe('T')
    expect(parsed.filePath).toBe('a.docx')
    expect(parsed.blocks).toEqual([
      { kind: 'heading', text: 'H' },
      { kind: 'heading', text: 'H2', level: 3 },
      { kind: 'text', text: 'Body' },
      { kind: 'bullets', items: ['x'] },
      { kind: 'table', rows: [['a'], ['b']] },
      { kind: 'chartPlaceholder', label: 'C' },
    ])
  })
})

it('validates the timeout budget before registering the tool', () => {
  expect(() => { ToolDocument.apply(new Context(), { timeoutMs: 0 }) }).toThrow('timeoutMs')
  expect(() => { ToolDocument.apply(new Context(), { timeoutMs: Number.POSITIVE_INFINITY }) }).toThrow('timeoutMs')
})

it('renders the created-document envelope and call presentation', async () => {
  expect(ToolDocument.formatCreatedDocument('report.docx', DOC_MEDIA_TYPE, 5))
    .toBe(`<path>report.docx</path>\n<type>document</type>\n<meta>${DOC_MEDIA_TYPE}, 5 bytes</meta>\n<content>\nCreated document; it has been presented as a deliverable.\n</content>`)
  expect(ToolDocument.presentCreateDocumentCall({ file_path: 'a/b/report.docx' }))
    .toEqual({ card: 'generic', kind: 'other', title: 'Create document: report.docx' })
  expect(ToolDocument.parseCreateDocumentArgs(args).blocks).toEqual(args.blocks)
})

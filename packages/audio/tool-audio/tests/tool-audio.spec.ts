import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { FileSystem, FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsDirEntry, FsEditOutcome, FsEditRequest, FsInfo, FsPathInfo, FsTarget, FsWriteIntent, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import Audio, { AudioError, type AudioProvider, type AudioTranscript } from '@deepseek-ai/dsh-audio'
import * as ToolAudio from '@deepseek-ai/dsh-tool-audio'
import { AUDIO_PROMPT_TEXT, DEFAULT_AUDIO_TOOL_TIMEOUT_MS } from '@deepseek-ai/dsh-tool-audio'
import { formatTranscript, parseTranscribeArgs, presentTranscribeCall } from '@deepseek-ai/dsh-tool-audio'

describe('parseTranscribeArgs', () => {
  it('normalizes the path and keeps non-blank refinements', () => {
    expect(parseTranscribeArgs({ file_path: '  a.mp3 ' })).toEqual({ filePath: 'a.mp3' })
    expect(parseTranscribeArgs({ file_path: 'a.mp3', language: ' en ', prompt: 'terms' }))
      .toEqual({ filePath: 'a.mp3', language: 'en', prompt: 'terms' })
  })

  it('rejects a blank path and non-string refinements', () => {
    expect(() => parseTranscribeArgs({ file_path: '   ' })).toThrow(/non-empty/)
    expect(() => parseTranscribeArgs({ file_path: 'a.mp3', language: 3 })).toThrow(/language/)
    expect(() => parseTranscribeArgs('nope')).toThrow(/object/)
  })
})

describe('formatTranscript', () => {
  it('renders the envelope with metadata and bounds long transcripts', () => {
    const text = formatTranscript('/abs/a.mp3', { text: 'hello', language: 'en', durationSec: 2.5 }, 8_000)
    expect(text).toContain('<path>/abs/a.mp3</path>')
    expect(text).toContain('<meta>language en, 2.5s</meta>')
    expect(text).toContain('hello')

    const long = formatTranscript('/abs/a.mp3', { text: 'y'.repeat(500) }, 120)
    expect(long.length).toBeLessThanOrEqual(120)
    expect(long).toContain('truncated')
  })
})

describe('presentTranscribeCall', () => {
  it('titles the card by the file name', () => {
    expect(presentTranscribeCall({ file_path: 'dir/meeting.mp3' }))
      .toEqual({ card: 'generic', kind: 'other', title: 'Transcribe: meeting.mp3' })
  })
})

/** A scripted transcription provider recording its last request. */
function stubProvider(): AudioProvider & { lastRequest?: unknown; transcript: AudioTranscript } {
  const provider: AudioProvider & { lastRequest?: unknown; transcript: AudioTranscript } = {
    id: 'stub',
    transcript: { text: 'hello world', language: 'en', durationSec: 2.5 },
    transcribe(request: unknown) {
      provider.lastRequest = request
      return Promise.resolve(provider.transcript)
    },
  }
  return provider
}

/** An in-memory fake filesystem with the primitives the tool uses. */
class FakeFs extends FileSystem {
  override watch(): never { throw new Error('Fixture does not support watching') }
  files = new Map<string, Uint8Array>()

  override async resolve(path: string): Promise<FsTarget> {
    return { targetKey: FsTargetKey(`key:${path}`), displayPath: `/abs/${path}` }
  }
  override processPath(target: FsTarget): string { return String(target.targetKey) }
  override fileUrl(target: FsTarget): string { return `file://${target.targetKey}` }
  override contains(parent: FsTarget, child: FsTarget): boolean {
    return child.targetKey === parent.targetKey || String(child.targetKey).startsWith(`${parent.targetKey}/`)
  }
  override async stat(target: FsTarget): Promise<FsInfo | undefined> {
    const content = this.files.get(target.targetKey)
    if (content === undefined) return undefined
    return { version: FsVersion('v1'), type: 'file', size: content.length }
  }
  override async lstat(path: string): Promise<FsPathInfo | undefined> {
    return this.stat({ targetKey: FsTargetKey(`key:${path}`), displayPath: path })
  }
  override async readText(target: FsTarget): Promise<string> {
    return new TextDecoder().decode(this.files.get(target.targetKey) ?? new Uint8Array())
  }
  override async streamText(target: FsTarget): Promise<AsyncIterable<string>> {
    const content = await this.readText(target)
    return (async function* () { yield content })()
  }
  override async readBytes(target: FsTarget, _signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    const bytes = this.files.get(target.targetKey) ?? new Uint8Array()
    if (bytes.length > maxBytes) {
      throw new FsError(`too large: ${target.displayPath}`, 'FS_TOO_LARGE')
    }
    return bytes
  }
  override async readByteRange(target: FsTarget, range: { offset: number; length: number }): Promise<Uint8Array> {
    return (await this.readBytes(target, undefined, Number.MAX_SAFE_INTEGER)).subarray(range.offset, range.offset + range.length)
  }
  override async listDir(_target: FsTarget): Promise<FsDirEntry[]> { return [] }
  override async writeText(target: FsTarget, content: string, expected?: FsWriteIntent): Promise<FsWriteOutcome> {
    void expected
    this.files.set(target.targetKey, new TextEncoder().encode(content))
    return { operation: 'create', version: FsVersion('v2'), before: null, after: content }
  }
  override async editText(target: FsTarget, edit: FsEditRequest, expected?: { version: FsVersion }): Promise<FsEditOutcome> {
    void expected
    const before = await this.readText(target)
    const after = before.split(edit.oldString).join(edit.newString)
    this.files.set(target.targetKey, new TextEncoder().encode(after))
    return { version: FsVersion('v3'), before, after }
  }
}

async function mountTool(provider?: AudioProvider): Promise<{ ctx: Context; fs: FakeFs }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Audio)
  await ctx.plugin(FakeFs)
  if (provider) ctx.audio.registerProvider(provider)
  await ctx.plugin(ToolAudio)
  return { ctx, fs: ctx.fs as FakeFs }
}

let seq = 0
const signal = new AbortController().signal
function execute(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({ signal, callId: `c-${++seq}` as never, name, arguments: args })
}
const asText = (blocks: Array<{ type: string; text?: string }>) => blocks.map(b => b.text ?? '').join('\n')

describe('transcribe_audio tool', () => {
  it('registers the tool and the prompt section with the default timeout', async () => {
    const { ctx } = await mountTool()
    expect(ctx.tools.get('transcribe_audio')).toBeDefined()
    expect(ctx.tools.get('transcribe_audio')?.timeoutMs).toBe(DEFAULT_AUDIO_TOOL_TIMEOUT_MS)
    const prompt = await ctx.systemPrompt.assemble()
    expect(prompt.sections.map(section => section.text).join('\n')).toContain(AUDIO_PROMPT_TEXT)
  })

  it('transcribes a workspace file through the provider with its file name', async () => {
    const provider = stubProvider()
    const { ctx, fs } = await mountTool(provider)
    fs.files.set('key:meeting.mp3', new Uint8Array([1, 2, 3]))

    const result = await execute(ctx, 'transcribe_audio', { file_path: 'meeting.mp3', language: 'en' })
    expect(result.isError).toBe(false)
    expect(asText(result.content)).toContain('hello world')
    expect(asText(result.content)).toContain('/abs/meeting.mp3')
    const request = provider.lastRequest as { fileName?: string; language?: string; data: Uint8Array }
    expect(request.fileName).toBe('meeting.mp3')
    expect(request.language).toBe('en')
    expect([...request.data]).toEqual([1, 2, 3])
  })

  it('rejects an absent path with FS_NOT_FOUND without reaching the provider', async () => {
    const { ctx } = await mountTool(stubProvider())
    const result = await execute(ctx, 'transcribe_audio', { file_path: 'missing.mp3' })
    expect(result.isError).toBe(true)
  })

  it('returns an actionable unavailable answer with no provider, without failing the session', async () => {
    const { ctx, fs } = await mountTool()
    fs.files.set('key:meeting.mp3', new Uint8Array([1]))
    const result = await execute(ctx, 'transcribe_audio', { file_path: 'meeting.mp3' })
    expect(result.isError).toBe(false)
    expect(asText(result.content)).toMatch(/not available/i)
  })

  it('propagates provider failures as tool errors', async () => {
    const failing: AudioProvider = {
      id: 'failing',
      transcribe() {
        return Promise.reject(new AudioError('endpoint down', 'AUDIO_PROVIDER_FAILED'))
      },
    }
    const { ctx, fs } = await mountTool(failing)
    fs.files.set('key:meeting.mp3', new Uint8Array([1]))
    const result = await execute(ctx, 'transcribe_audio', { file_path: 'meeting.mp3' })
    expect(result.isError).toBe(true)
  })
})

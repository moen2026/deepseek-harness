import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {
  AttachmentId,
  AttachmentStore,
  type FileAttachmentRef,
  type ImageAttachmentLimits,
  type ImageAttachmentRef,
  type SaveFileAttachment,
  type StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import Video, { VideoError, type VideoProvider, type VideoResult } from '@deepseek-ai/dsh-video'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import * as ToolVideo from '@deepseek-ai/dsh-tool-video'
import {
  DEFAULT_VIDEO_TOOL_TIMEOUT_MS,
  VIDEO_PROMPT_TEXT,
  formatGeneratedVideo,
  parseGenerateVideoArgs,
  presentGenerateVideoCall,
} from '@deepseek-ai/dsh-tool-video'

describe('parseGenerateVideoArgs', () => {
  it('normalizes the prompt and keeps non-blank refinements', () => {
    expect(parseGenerateVideoArgs({ prompt: '  a cat ' })).toEqual({ prompt: 'a cat' })
    expect(parseGenerateVideoArgs({
      prompt: 'a cat',
      size: ' 1280x720 ',
      duration: 10,
      referenceImage: ' https://ref.example/a.png ',
      referenceVideo: ' https://ref.example/v.mp4 ',
      firstFrame: ' https://ref.example/f.png ',
      lastFrame: ' https://ref.example/l.png ',
      referenceAudio: ' https://ref.example/a.mp3 ',
      aspectRatio: ' 16:9 ',
    })).toEqual({
      prompt: 'a cat',
      size: '1280x720',
      duration: 10,
      referenceImage: 'https://ref.example/a.png',
      referenceVideo: 'https://ref.example/v.mp4',
      firstFrame: 'https://ref.example/f.png',
      lastFrame: 'https://ref.example/l.png',
      referenceAudio: 'https://ref.example/a.mp3',
      aspectRatio: '16:9',
    })
  })

  it('rejects a blank prompt and malformed refinements', () => {
    expect(() => parseGenerateVideoArgs({ prompt: '   ' })).toThrow(/non-empty/)
    expect(() => parseGenerateVideoArgs('nope')).toThrow(/object/)
    expect(() => parseGenerateVideoArgs({ prompt: 'a cat', size: 3 })).toThrow(/size/)
    expect(() => parseGenerateVideoArgs({ prompt: 'a cat', size: ' ' })).toThrow(/size/)
    expect(() => parseGenerateVideoArgs({ prompt: 'a cat', duration: '10' })).toThrow(/duration/)
    expect(() => parseGenerateVideoArgs({ prompt: 'a cat', duration: 0 })).toThrow(/duration/)
    expect(() => parseGenerateVideoArgs({ prompt: 'a cat', duration: 1.5 })).toThrow(/duration/)
    expect(() => parseGenerateVideoArgs({ prompt: 'a cat', referenceImage: '  ' })).toThrow(/referenceImage/)
    expect(() => parseGenerateVideoArgs({ prompt: 'a cat', referenceImage: 7 })).toThrow(/referenceImage/)
    expect(() => parseGenerateVideoArgs({ prompt: 'a cat', referenceVideo: '' })).toThrow(/referenceVideo/)
    expect(() => parseGenerateVideoArgs({ prompt: 'a cat', firstFrame: ' ' })).toThrow(/firstFrame/)
    expect(() => parseGenerateVideoArgs({ prompt: 'a cat', lastFrame: 9 })).toThrow(/lastFrame/)
    expect(() => parseGenerateVideoArgs({ prompt: 'a cat', referenceAudio: '' })).toThrow(/referenceAudio/)
    expect(() => parseGenerateVideoArgs({ prompt: 'a cat', aspectRatio: ' ' })).toThrow(/aspectRatio/)
    expect(() => parseGenerateVideoArgs({ prompt: 'a cat', aspectRatio: 7 })).toThrow(/aspectRatio/)
  })

  it('omits absent refinements', () => {
    expect(parseGenerateVideoArgs({ prompt: 'a cat' })).toEqual({ prompt: 'a cat' })
  })
})

describe('formatGeneratedVideo', () => {
  it('renders the envelope with video metadata', () => {
    const text = formatGeneratedVideo({
      status: 'ok',
      video: { attachmentId: 'sha256:a', name: 'generated.mp4', bytes: 100, mediaType: 'video/mp4' },
    }, 8_000)
    expect(text).toContain('video/mp4 video generated, 100 bytes')
    expect(text).toContain('attached above this envelope')

    const long = formatGeneratedVideo({
      status: 'ok',
      video: { attachmentId: 'sha256:a', name: 'generated.mp4', bytes: 100, mediaType: 'video/mp4' },
    }, 60)
    expect(long.length).toBeLessThanOrEqual(61)
  })

  it('renders the actionable unavailable answer without an envelope', () => {
    const text = formatGeneratedVideo({ status: 'unavailable' }, 8_000)
    expect(text).toMatch(/not available/i)
    // An ok status without a committed video has nothing to render either.
    expect(formatGeneratedVideo({ status: 'ok' }, 8_000)).toMatch(/not available/i)
  })
})

describe('presentGenerateVideoCall', () => {
  it('titles the card with a bounded prompt label', () => {
    expect(presentGenerateVideoCall({ prompt: 'a cat' }))
      .toEqual({ card: 'generic', kind: 'other', title: 'Generate video: a cat' })
    expect(presentGenerateVideoCall({ prompt: 'x'.repeat(80) }).title.length).toBeLessThanOrEqual(60)
  })

  it('notes size, duration, and reference media within the title bound', () => {
    expect(presentGenerateVideoCall({ prompt: 'a cat', size: '1280x720', duration: 10 }).title)
      .toBe('Generate video: a cat (1280x720, 10s)')
    expect(presentGenerateVideoCall({ prompt: 'a cat', referenceImage: 'x', referenceVideo: 'y' }).title)
      .toBe('Generate video: a cat (+image, +video)')
    expect(presentGenerateVideoCall({
      prompt: 'a cat', aspectRatio: '9:16', referenceAudio: 'a', firstFrame: 'f', lastFrame: 'l',
    }).title).toBe('Generate video: a cat (9:16, +audio, +frames)')
    const long = presentGenerateVideoCall({
      prompt: 'x'.repeat(80), size: '1280x720', duration: 600, referenceImage: 'a', referenceVideo: 'b',
    })
    expect(long.title.length).toBeLessThanOrEqual(60)
  })
})

/** A scripted generation provider recording its last request. */
function stubProvider(): VideoProvider & { lastRequest?: unknown; result: VideoResult } {
  const provider: VideoProvider & { lastRequest?: unknown; result: VideoResult } = {
    id: 'stub',
    result: { data: new Uint8Array([0, 0, 0, 24]), mediaType: 'video/mp4' },
    generate(request: unknown) {
      provider.lastRequest = request
      return Promise.resolve(provider.result)
    },
  }
  return provider
}

const LIMITS: ImageAttachmentLimits = {
  maxImageBytes: 1024 * 1024, maxImagesPerMessage: 4, maxMessageImageBytes: 1024 * 1024,
  maxImagePixels: 1_000_000, maxImageDimension: 4096, mediaTypes: ['image/png', 'image/jpeg'],
}

/** An in-memory fake attachment store recording the files the tool commits. */
class FakeStore extends AttachmentStore {
  override readonly imageLimits = LIMITS
  saved: SaveFileAttachment[] = []

  override validateImage(): Promise<void> {
    return Promise.resolve()
  }

  override saveImage(): Promise<ImageAttachmentRef> {
    return Promise.reject(new Error('image storage is not used by the video tests'))
  }

  override readImage(): Promise<StoredImageAttachment> {
    return Promise.reject(new Error('image reads are not used by the video tests'))
  }

  override saveFile(input: SaveFileAttachment): Promise<FileAttachmentRef> {
    this.saved.push(input)
    return Promise.resolve({
      attachmentId: AttachmentId(`sha256:${String(this.saved.length).padStart(64, '0')}`),
      name: input.name ?? 'unnamed',
      bytes: input.data.byteLength,
    })
  }
}

async function mountTool(provider?: VideoProvider, withStore = true): Promise<{ ctx: Context; store: FakeStore | undefined }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Video)
  if (provider) ctx.video.registerProvider(provider)
  // The constructor itself provides the 'attachments' service on the context,
  // so "no store mounted" is expressed by never constructing one.
  const store = withStore ? new FakeStore(ctx) : undefined
  await ctx.plugin(ToolVideo)
  return { ctx, store }
}

let seq = 0
const signal = new AbortController().signal
function execute(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({ signal, callId: `c-${++seq}` as never, name, arguments: args })
}
const asText = (blocks: Array<{ type: string; text?: string }>) => blocks.map(b => b.text ?? '').join('\n')

describe('generate_video tool', () => {
  it('registers the tool and the prompt section with the default timeout', async () => {
    const { ctx } = await mountTool()
    expect(ctx.tools.get('generate_video')).toBeDefined()
    expect(ctx.tools.get('generate_video')?.timeoutMs).toBe(DEFAULT_VIDEO_TOOL_TIMEOUT_MS)
    const prompt = await ctx.systemPrompt.assemble()
    expect(prompt.sections.map(section => section.text).join('\n')).toContain(VIDEO_PROMPT_TEXT)
  })

  it('generates through the provider, commits the file, and returns the file handle', async () => {
    const provider = stubProvider()
    const { ctx, store } = await mountTool(provider)

    const result = await execute(ctx, 'generate_video', {
      prompt: 'a cat',
      size: '1280x720',
      duration: 10,
      referenceImage: 'https://ref.example/a.png',
      referenceVideo: 'https://ref.example/v.mp4',
      firstFrame: 'https://ref.example/f.png',
      lastFrame: 'https://ref.example/l.png',
      referenceAudio: 'https://ref.example/a.mp3',
      aspectRatio: '16:9',
    })
    expect(result.isError).toBe(false)
    const text = asText(result.content)
    expect(text).toContain('video/mp4 video generated, 4 bytes')

    const request = provider.lastRequest as {
      prompt?: string
      size?: string
      duration?: number
      referenceImage?: string
      referenceVideo?: string
      firstFrame?: string
      lastFrame?: string
      referenceAudio?: string
      aspectRatio?: string
    }
    expect(request.prompt).toBe('a cat')
    expect(request.size).toBe('1280x720')
    expect(request.duration).toBe(10)
    expect(request.referenceImage).toBe('https://ref.example/a.png')
    expect(request.referenceVideo).toBe('https://ref.example/v.mp4')
    expect(request.firstFrame).toBe('https://ref.example/f.png')
    expect(request.lastFrame).toBe('https://ref.example/l.png')
    expect(request.referenceAudio).toBe('https://ref.example/a.mp3')
    expect(request.aspectRatio).toBe('16:9')
    expect(store?.saved).toHaveLength(1)
    expect(store?.saved[0]?.name).toBe('generated.mp4')

    // The settled content carries the file block with the durable reference.
    const fileBlock = result.content.find(block => block.type === 'file')
    expect(fileBlock?.attachment).toEqual({
      attachmentId: `sha256:${'1'.padStart(64, '0')}`,
      name: 'generated.mp4',
      bytes: 4,
    })
  })

  it('returns an actionable unavailable answer with no provider, without failing the session', async () => {
    const { ctx } = await mountTool()
    const result = await execute(ctx, 'generate_video', { prompt: 'a cat' })
    expect(result.isError).toBe(false)
    expect(asText(result.content)).toMatch(/not available/i)
  })

  it('returns the unavailable answer before spending provider budget when no store is mounted', async () => {
    const provider = stubProvider()
    const { ctx } = await mountTool(provider, false)
    const result = await execute(ctx, 'generate_video', { prompt: 'a cat' })
    expect(result.isError).toBe(false)
    expect(asText(result.content)).toMatch(/not available/i)
    expect(provider.lastRequest).toBeUndefined()
  })

  it('propagates provider failures as tool errors', async () => {
    const failing: VideoProvider = {
      id: 'failing',
      generate() {
        return Promise.reject(new VideoError('endpoint down', 'VIDEO_PROVIDER_FAILED'))
      },
    }
    const { ctx } = await mountTool(failing)
    const result = await execute(ctx, 'generate_video', { prompt: 'a cat' })
    expect(result.isError).toBe(true)
  })

  it('refuses a media type the deployment cannot store', async () => {
    const provider = stubProvider()
    provider.result = { data: new Uint8Array([1, 2]), mediaType: 'video/x-matroska' }
    const { ctx } = await mountTool(provider)
    const result = await execute(ctx, 'generate_video', { prompt: 'a cat' })
    expect(result.isError).toBe(true)
    expect(asText(result.content)).toContain('cannot store')
  })

  it('marks generate_video parallel-safe', async () => {
    const { ctx } = await mountTool()
    expect(ctx.tools.get('generate_video')?.isConcurrencySafe?.({ prompt: 'a cat' })).toBe(true)
  })

  it('names the stored file for webm and mov media types', async () => {
    for (const [mediaType, name] of [['video/webm', 'generated.webm'], ['video/quicktime', 'generated.mov']] as const) {
      const provider = stubProvider()
      provider.result = { data: new Uint8Array([1]), mediaType }
      const { ctx, store } = await mountTool(provider)
      const result = await execute(ctx, 'generate_video', { prompt: 'a cat' })
      expect(result.isError).toBe(false)
      expect(store?.saved[0]?.name).toBe(name)
    }
  })

  it('fails loud at load for tunables it cannot honor', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Video)
    await expect(ctx.plugin(ToolVideo, { maxResultChars: 0 })).rejects.toThrow(/maxResultChars must be a positive integer/)
    await expect(ctx.plugin(ToolVideo, { maxResultChars: 1.5 })).rejects.toThrow(/maxResultChars must be a positive integer/)
    await expect(ctx.plugin(ToolVideo, { timeoutMs: 0 })).rejects.toThrow(/timeoutMs must be a positive integer/)
    await expect(ctx.plugin(ToolVideo, { timeoutMs: 1.5 })).rejects.toThrow(/timeoutMs must be a positive integer/)
    // The schema already caps timeoutMs at the same ceiling, so only a direct apply reaches the range check.
    expect(() => {
      ToolVideo.apply(ctx, { maxResultChars: 8_000, timeoutMs: MAX_TIMER_DELAY_MS + 1 })
    }).toThrow(/no greater than/)
  })
})

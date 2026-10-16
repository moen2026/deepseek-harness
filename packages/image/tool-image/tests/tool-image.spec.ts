import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { AttachmentId, AttachmentStore, type ImageAttachmentRef, type ImageAttachmentLimits, type SaveImageAttachment, type StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import Image, { ImageError, type ImageProvider, type ImageResult } from '@deepseek-ai/dsh-image'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import * as ToolImage from '@deepseek-ai/dsh-tool-image'
import { DEFAULT_IMAGE_TOOL_TIMEOUT_MS, IMAGE_PROMPT_TEXT } from '@deepseek-ai/dsh-tool-image'
import { formatGeneratedImage, parseGenerateImageArgs, presentGenerateImageCall } from '@deepseek-ai/dsh-tool-image'

describe('parseGenerateImageArgs', () => {
  it('normalizes the prompt and keeps non-blank refinements', () => {
    expect(parseGenerateImageArgs({ prompt: '  a cat ' })).toEqual({ prompt: 'a cat' })
    expect(parseGenerateImageArgs({ prompt: 'a cat', size: ' 1024x1024 ' }))
      .toEqual({ prompt: 'a cat', size: '1024x1024' })
  })

  it('rejects a blank prompt and non-string refinements', () => {
    expect(() => parseGenerateImageArgs({ prompt: '   ' })).toThrow(/non-empty/)
    expect(() => parseGenerateImageArgs({ prompt: 'a cat', size: 3 })).toThrow(/size/)
    expect(() => parseGenerateImageArgs('nope')).toThrow(/object/)
  })

  it('trims reference-image URLs and omits an absent list', () => {
    expect(parseGenerateImageArgs({ prompt: 'a cat', referenceImages: [' https://a.example/x.png '] }))
      .toEqual({ prompt: 'a cat', referenceImages: ['https://a.example/x.png'] })
    expect(parseGenerateImageArgs({ prompt: 'a cat' }).referenceImages).toBeUndefined()
  })

  it('rejects a malformed reference-image list', () => {
    expect(() => parseGenerateImageArgs({ prompt: 'a cat', referenceImages: [] })).toThrow(/non-empty array/)
    expect(() => parseGenerateImageArgs({ prompt: 'a cat', referenceImages: 'https://a.example/x.png' }))
      .toThrow(/non-empty array/)
    expect(() => parseGenerateImageArgs({ prompt: 'a cat', referenceImages: [3] })).toThrow(/non-empty strings/)
    expect(() => parseGenerateImageArgs({ prompt: 'a cat', referenceImages: ['  '] })).toThrow(/non-empty strings/)
  })
})

describe('formatGeneratedImage', () => {
  it('renders the envelope with image metadata and the revised prompt', () => {
    const text = formatGeneratedImage({
      status: 'ok',
      image: { attachmentId: 'sha256:a', mediaType: 'image/png', bytes: 100, width: 1024, height: 1024, name: 'generated.png' },
      revisedPrompt: 'a red cat',
    }, 8_000)
    expect(text).toContain('image/png image generated, 1024x1024 px, 100 bytes')
    expect(text).toContain('<revisedPrompt>a red cat</revisedPrompt>')
    expect(text).toContain('attached above this envelope')

    const long = formatGeneratedImage({
      status: 'ok',
      image: { attachmentId: 'sha256:a', mediaType: 'image/png', bytes: 100, width: 1, height: 1 },
    }, 120)
    expect(long.length).toBeLessThanOrEqual(121)
  })

  it('lists decomposed layers in the envelope and notes their attachments', () => {
    const text = formatGeneratedImage({
      status: 'ok',
      image: { attachmentId: 'sha256:a', mediaType: 'image/png', bytes: 900, width: 2048, height: 2048 },
      layers: [
        { attachmentId: 'sha256:b', mediaType: 'image/png', bytes: 100, width: 1273, height: 265, zIndex: 1, name: '标题文字', description: '黄色大号衬线字体', boundingBox: [383, 120, 1655, 384] },
        { attachmentId: 'sha256:c', mediaType: 'image/jpeg', bytes: 50, width: 2048, height: 2048, zIndex: 0 },
      ],
    }, 8_000)
    expect(text).toContain('<layer z="1">image/png 1273x265 px at [383, 120, 1655, 384] "标题文字": 黄色大号衬线字体</layer>')
    expect(text).toContain('<layer z="0">image/jpeg 2048x2048 px</layer>')
    expect(text).toContain('2 decomposed layers')
    expect(text).toContain('bottom-up by z')
  })

  it('renders the actionable unavailable answer without an envelope', () => {
    const text = formatGeneratedImage({ status: 'unavailable' }, 8_000)
    expect(text).toMatch(/not available/i)
    // An ok status without a committed image has nothing to render either.
    expect(formatGeneratedImage({ status: 'ok' }, 8_000)).toMatch(/not available/i)
  })
})

describe('presentGenerateImageCall', () => {
  it('titles the card with a bounded prompt label', () => {
    expect(presentGenerateImageCall({ prompt: 'a cat' }))
      .toEqual({ card: 'generic', kind: 'other', title: 'Generate image: a cat' })
    expect(presentGenerateImageCall({ prompt: 'x'.repeat(80) }).title.length).toBeLessThanOrEqual(60)
  })

  it('appends the reference-image count within the title bound', () => {
    expect(presentGenerateImageCall({ prompt: 'a cat', referenceImages: ['https://a.example/x.png'] }).title)
      .toBe('Generate image: a cat (+1 reference image)')
    expect(presentGenerateImageCall({ prompt: 'a cat', referenceImages: ['a', 'b', 'c'] }).title)
      .toBe('Generate image: a cat (+3 reference images)')
    expect(presentGenerateImageCall({ prompt: 'x'.repeat(80), referenceImages: ['a', 'b'] }).title.length)
      .toBeLessThanOrEqual(60)
  })
})

/** A scripted generation provider recording its last request. */
function stubProvider(): ImageProvider & { lastRequest?: unknown; result: ImageResult } {
  const provider: ImageProvider & { lastRequest?: unknown; result: ImageResult } = {
    id: 'stub',
    result: { data: new Uint8Array([137, 80, 78, 71]), mediaType: 'image/png', revisedPrompt: 'a red cat' },
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

/** An in-memory fake attachment store recording what the tool commits. */
class FakeStore extends AttachmentStore {
  override readonly imageLimits = LIMITS
  saved: SaveImageAttachment[] = []

  override validateImage(): Promise<void> {
    return Promise.resolve()
  }

  override saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    this.saved.push(input)
    return Promise.resolve({
      attachmentId: AttachmentId(`sha256:${String(this.saved.length).padStart(64, '0')}`),
      mediaType: input.mediaType, bytes: input.data.byteLength, width: 1, height: 1,
      ...input.name === undefined ? {} : { name: input.name },
    })
  }

  override readImage(ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    return Promise.resolve({ ref, data: new Uint8Array() })
  }
}

/** A store whose committed references carry no optional name. */
class NamelessStore extends FakeStore {
  override saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    this.saved.push(input)
    return Promise.resolve({
      attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
      mediaType: input.mediaType, bytes: input.data.byteLength, width: 1, height: 1,
    })
  }
}

async function mountTool(provider?: ImageProvider, withStore = true): Promise<{ ctx: Context; store: FakeStore | undefined }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Image)
  if (provider) ctx.image.registerProvider(provider)
  // The constructor itself provides the 'attachments' service on the context,
  // so "no store mounted" is expressed by never constructing one.
  const store = withStore ? new FakeStore(ctx) : undefined
  await ctx.plugin(ToolImage)
  return { ctx, store }
}

let seq = 0
const signal = new AbortController().signal
function execute(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({ signal, callId: `c-${++seq}` as never, name, arguments: args })
}
const asText = (blocks: Array<{ type: string; text?: string }>) => blocks.map(b => b.text ?? '').join('\n')

describe('generate_image tool', () => {
  it('registers the tool and the prompt section with the default timeout', async () => {
    const { ctx } = await mountTool()
    expect(ctx.tools.get('generate_image')).toBeDefined()
    expect(ctx.tools.get('generate_image')?.timeoutMs).toBe(DEFAULT_IMAGE_TOOL_TIMEOUT_MS)
    const prompt = await ctx.systemPrompt.assemble()
    expect(prompt.sections.map(section => section.text).join('\n')).toContain(IMAGE_PROMPT_TEXT)
  })

  it('generates through the provider, commits the attachment, and returns the image', async () => {
    const provider = stubProvider()
    const { ctx, store } = await mountTool(provider)

    const referenceImages = ['https://ref.example/a.png']
    const result = await execute(ctx, 'generate_image', { prompt: 'a cat', size: '1024x1024', referenceImages })
    expect(result.isError).toBe(false)
    const text = asText(result.content)
    expect(text).toContain('image/png image generated')
    expect(text).toContain('a red cat')

    const request = provider.lastRequest as { prompt?: string; size?: string; referenceImages?: readonly string[] }
    expect(request.prompt).toBe('a cat')
    expect(request.size).toBe('1024x1024')
    expect(request.referenceImages).toEqual(referenceImages)
    expect(store?.saved).toHaveLength(1)
    expect(store?.saved[0]?.name).toBe('generated.png')

    // The settled content carries the image block with the durable reference.
    const imageBlock = result.content.find(block => block.type === 'image')
    expect(imageBlock?.attachment.mediaType).toBe('image/png')
    expect(imageBlock?.attachment.name).toBe('generated.png')
  })

  it('commits decomposed layers as attachments and returns them beside the composed image', async () => {
    const provider = stubProvider()
    provider.result = {
      data: new Uint8Array([1]),
      mediaType: 'image/png',
      layers: [
        { zIndex: 0, data: new Uint8Array([2]), mediaType: 'image/png', width: 4, height: 4 },
        { zIndex: 1, data: new Uint8Array([3]), mediaType: 'image/jpeg', width: 2, height: 1, name: '标题', description: '文字', boundingBox: [0, 0, 2, 1] },
      ],
    }
    const { ctx, store } = await mountTool(provider)

    const result = await execute(ctx, 'generate_image', { prompt: 'a cat' })
    expect(result.isError).toBe(false)
    expect(store?.saved.map(saved => saved.name)).toEqual(['generated.png', 'generated-layer-0.png', 'generated-layer-1.png'])
    const imageBlocks = result.content.filter(block => block.type === 'image')
    expect(imageBlocks).toHaveLength(3)
    expect(asText(result.content)).toContain('<layer z="1">image/jpeg 2x1 px at [0, 0, 2, 1] "标题": 文字</layer>')
  })

  it('returns an actionable unavailable answer with no provider, without failing the session', async () => {
    const { ctx } = await mountTool()
    const result = await execute(ctx, 'generate_image', { prompt: 'a cat' })
    expect(result.isError).toBe(false)
    expect(asText(result.content)).toMatch(/not available/i)
  })

  it('returns the unavailable answer before spending provider budget when no store is mounted', async () => {
    const provider = stubProvider()
    const { ctx } = await mountTool(provider, false)
    const result = await execute(ctx, 'generate_image', { prompt: 'a cat' })
    expect(result.isError).toBe(false)
    expect(asText(result.content)).toMatch(/not available/i)
    expect(provider.lastRequest).toBeUndefined()
  })

  it('propagates provider failures as tool errors', async () => {
    const failing: ImageProvider = {
      id: 'failing',
      generate() {
        return Promise.reject(new ImageError('endpoint down', 'IMAGE_PROVIDER_FAILED'))
      },
    }
    const { ctx } = await mountTool(failing)
    const result = await execute(ctx, 'generate_image', { prompt: 'a cat' })
    expect(result.isError).toBe(true)
  })

  it('refuses a media type the deployment cannot store', async () => {
    const provider = stubProvider()
    provider.result = { data: new Uint8Array([1, 2]), mediaType: 'image/svg+xml' }
    const { ctx } = await mountTool(provider)
    const result = await execute(ctx, 'generate_image', { prompt: 'a cat' })
    expect(result.isError).toBe(true)
    expect(asText(result.content)).toContain('cannot store')
  })

  it('marks generate_image parallel-safe', async () => {
    const { ctx } = await mountTool()
    expect(ctx.tools.get('generate_image')?.isConcurrencySafe?.({ prompt: 'a cat' })).toBe(true)
  })

  it('omits the revised prompt when the provider returns none', async () => {
    const provider = stubProvider()
    provider.result = { data: new Uint8Array([137, 80, 78, 71]), mediaType: 'image/png' }
    const { ctx } = await mountTool(provider)
    const result = await execute(ctx, 'generate_image', { prompt: 'a cat' })
    expect(result.isError).toBe(false)
    expect(asText(result.content)).not.toContain('<revisedPrompt>')
  })

  it('projects a committed reference that carries no optional name', async () => {
    const provider = stubProvider()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Image)
    ctx.image.registerProvider(provider)
    const store = new NamelessStore(ctx)
    await ctx.plugin(ToolImage)

    const result = await execute(ctx, 'generate_image', { prompt: 'a cat' })
    expect(result.isError).toBe(false)
    expect(store.saved).toHaveLength(1)
    const imageBlock = result.content.find(block => block.type === 'image')
    expect(imageBlock?.attachment).toEqual({
      attachmentId: `sha256:${'a'.repeat(64)}`, mediaType: 'image/png', bytes: 4, width: 1, height: 1,
    })
  })

  it('fails loud at load for tunables it cannot honor', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Image)
    await expect(ctx.plugin(ToolImage, { maxResultChars: 0 })).rejects.toThrow(/maxResultChars must be a positive integer/)
    await expect(ctx.plugin(ToolImage, { maxResultChars: 1.5 })).rejects.toThrow(/maxResultChars must be a positive integer/)
    await expect(ctx.plugin(ToolImage, { timeoutMs: 0 })).rejects.toThrow(/timeoutMs must be a positive integer/)
    await expect(ctx.plugin(ToolImage, { timeoutMs: 1.5 })).rejects.toThrow(/timeoutMs must be a positive integer/)
    // The schema already caps timeoutMs at the same ceiling, so only a direct apply reaches the range check.
    expect(() => {
      ToolImage.apply(ctx, { maxResultChars: 8_000, timeoutMs: MAX_TIMER_DELAY_MS + 1 })
    }).toThrow(/no greater than/)
  })
})

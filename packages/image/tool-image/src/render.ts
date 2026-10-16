/**
 * Model-facing presentation for `generate_image`: argument normalization, the
 * generated-image envelope, and the bounded rendering shared by the tool and its
 * tests.
 * @module @deepseek-ai/dsh-tool-image/render
 */

/** Default largest complete rendered result in characters, including truncation metadata. */
export const DEFAULT_MAX_RESULT_CHARS = 8_000

/** Normalized `generate_image` arguments: a non-empty prompt plus optional refinements. */
export interface GenerateImageArgs {
  /** The text prompt describing the image to generate. */
  readonly prompt: string
  /** Optional requested image size (for example `1024x1024`). */
  readonly size?: string
  /** Optional publicly reachable reference-image URLs passed through to the provider. */
  readonly referenceImages?: readonly string[]
}

/** One serializable decomposed layer projected into the tool's output schema. */
export interface GeneratedLayerItem {
  attachmentId: string
  mediaType: string
  bytes: number
  width: number
  height: number
  zIndex: number
  name?: string
  description?: string
  boundingBox?: number[]
}

/** One serializable generated-image item projected into the tool's output schema. */
export interface GeneratedImageItem {
  status: 'ok' | 'unavailable'
  image?: {
    attachmentId: string
    mediaType: string
    bytes: number
    width: number
    height: number
    name?: string
  }
  /** Decomposed layers, bottom-up by `zIndex`; present only when the provider decomposes. */
  layers?: readonly GeneratedLayerItem[]
  revisedPrompt?: string
}

/**
 * Normalize the raw `generate_image` arguments, rejecting shapes the schema already
 * narrows but defensive callers (nested dispatches) can still send.
 * @param args - the raw tool arguments.
 * @returns the normalized arguments.
 */
export function parseGenerateImageArgs(args: unknown): GenerateImageArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('generate_image: arguments must be an object')
  }
  const raw = args as { prompt?: unknown; size?: unknown; referenceImages?: unknown }
  if (typeof raw.prompt !== 'string' || raw.prompt.trim() === '') {
    throw new Error('generate_image: prompt must be a non-empty string')
  }
  if (raw.size !== undefined && (typeof raw.size !== 'string' || raw.size.trim() === '')) {
    throw new Error('generate_image: size must be a non-empty string when provided')
  }
  const referenceImages = parseReferenceImages(raw.referenceImages)
  return {
    prompt: raw.prompt.trim(),
    ...typeof raw.size === 'string' ? { size: raw.size.trim() } : {},
    ...referenceImages === undefined ? {} : { referenceImages },
  }
}

/**
 * Normalize the raw `referenceImages` argument under the same rule as `size`: a
 * provided value must be a non-empty array of non-empty strings.
 * @param value - the raw argument value.
 * @returns the trimmed URLs, or `undefined` when the argument is absent.
 */
function parseReferenceImages(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('generate_image: referenceImages must be a non-empty array of URL strings when provided')
  }
  return value.map((item: unknown): string => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error('generate_image: referenceImages must contain only non-empty strings')
    }
    return item.trim()
  })
}

/**
 * Render one generated image as the model-facing envelope, bounded to `maxChars`.
 * @param item - the generation outcome to render.
 * @param maxChars - the inclusive character ceiling on the returned text.
 * @returns the envelope text; the image itself rides the adjacent image block.
 */
export function formatGeneratedImage(item: GeneratedImageItem, maxChars: number): string {
  if (item.status === 'unavailable') {
    return UNAVAILABLE_TEXT
  }
  const image = item.image
  if (image === undefined) {
    return UNAVAILABLE_TEXT
  }
  const revised = item.revisedPrompt === undefined ? '' : `<revisedPrompt>${item.revisedPrompt}</revisedPrompt>\n`
  const layers = item.layers ?? []
  const layerLines = layers.map((layer) => {
    const box = layer.boundingBox === undefined ? '' : ` at [${layer.boundingBox.join(', ')}]`
    const name = layer.name === undefined ? '' : ` "${layer.name}"`
    const description = layer.description === undefined ? '' : `: ${layer.description}`
    return `<layer z="${layer.zIndex}">${layer.mediaType} ${layer.width}x${layer.height} px${box}${name}${description}</layer>`
  })
  const contentLines = [
    `${image.mediaType} image generated, ${image.width}x${image.height} px, ${image.bytes} bytes`,
    ...layerLines,
  ]
  const attached = layers.length === 0
    ? 'The generated image is attached above this envelope.'
    : `The composed image is attached above this envelope; its ${layers.length} decomposed layers are attached after it, bottom-up by z.`
  const body = `<type>image</type>\n<content>\n${contentLines.join('\n')}\n</content>\n${revised}${attached}`
  if (body.length <= maxChars) return body
  const keep = Math.max(0, maxChars - 1)
  return `${body.slice(0, keep)}…`
}

/** Actionable answer returned when image generation cannot run in this deployment. */
export const UNAVAILABLE_TEXT =
  'Image generation is not available: no provider is configured. Configure a generation endpoint (an OpenAI-compatible /images/generations service) to generate images; otherwise continue without image generation.'

/** Longest recorded total title `presentGenerateImageCall` emits, in characters. */
const MAX_CALL_TITLE_CHARS = 60

/**
 * Render the `presentCall` summary for a generation request.
 * @param args - the raw tool arguments, carrying the prompt and any reference images.
 * @returns the user-facing call presentation.
 */
export function presentGenerateImageCall(
  args: { prompt: string; referenceImages?: readonly string[] },
): { card: 'generic'; kind: 'other'; title: string } {
  const references = args.referenceImages?.length ?? 0
  const suffix = references === 0 ? '' : ` (+${references} reference image${references === 1 ? '' : 's'})`
  const budget = MAX_CALL_TITLE_CHARS - 'Generate image: '.length - suffix.length
  const label = args.prompt.length > budget ? `${args.prompt.slice(0, budget - 1)}…` : args.prompt
  return { card: 'generic', kind: 'other', title: `Generate image: ${label}${suffix}` }
}

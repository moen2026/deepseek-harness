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
  const raw = args as { prompt?: unknown; size?: unknown }
  if (typeof raw.prompt !== 'string' || raw.prompt.trim() === '') {
    throw new Error('generate_image: prompt must be a non-empty string')
  }
  if (raw.size !== undefined && (typeof raw.size !== 'string' || raw.size.trim() === '')) {
    throw new Error('generate_image: size must be a non-empty string when provided')
  }
  return {
    prompt: raw.prompt.trim(),
    ...typeof raw.size === 'string' ? { size: raw.size.trim() } : {},
  }
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
  const body = `<type>image</type>\n<content>\n${image.mediaType} image generated, ${image.width}x${image.height} px, ${image.bytes} bytes\n</content>\n${revised}The generated image is attached above this envelope.`
  if (body.length <= maxChars) return body
  const keep = Math.max(0, maxChars - 1)
  return `${body.slice(0, keep)}…`
}

/** Actionable answer returned when image generation cannot run in this deployment. */
export const UNAVAILABLE_TEXT =
  'Image generation is not available: no provider is configured. Configure a generation endpoint (an OpenAI-compatible /images/generations service) to generate images; otherwise continue without image generation.'

/**
 * Render the `presentCall` summary for a generation request.
 * @param args - the raw tool arguments, carrying the prompt.
 * @returns the user-facing call presentation.
 */
export function presentGenerateImageCall(args: { prompt: string }): { card: 'generic'; kind: 'other'; title: string } {
  const label = args.prompt.length > 40 ? `${args.prompt.slice(0, 40)}…` : args.prompt
  return { card: 'generic', kind: 'other', title: `Generate image: ${label}` }
}

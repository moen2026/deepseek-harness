/**
 * Model-facing presentation for `generate_video`: argument normalization, the
 * generated-video envelope, and the bounded rendering shared by the tool and its
 * tests.
 * @module @deepseek-ai/dsh-tool-video/render
 */

/** Default largest complete rendered result in characters, including truncation metadata. */
export const DEFAULT_MAX_RESULT_CHARS = 8_000

/** Normalized `generate_video` arguments: a non-empty prompt plus optional refinements. */
export interface GenerateVideoArgs {
  /** The text prompt describing the video to generate. */
  readonly prompt: string
  /** Optional requested video size (for example `1280x720`). */
  readonly size?: string
  /** Optional requested duration in seconds. */
  readonly duration?: number
  /** Optional publicly reachable reference-image URL passed through to the provider. */
  readonly referenceImage?: string
  /** Optional publicly reachable reference-video URL passed through to the provider. */
  readonly referenceVideo?: string
  /** Optional publicly reachable first-frame conditioning image URL passed through to the provider. */
  readonly firstFrame?: string
  /** Optional publicly reachable last-frame conditioning image URL passed through to the provider. */
  readonly lastFrame?: string
  /** Optional publicly reachable reference-audio URL passed through to the provider. */
  readonly referenceAudio?: string
  /** Optional requested aspect-ratio hint passed through to the provider. */
  readonly aspectRatio?: string
}

/** One serializable generated-video item projected into the tool's output schema. */
export interface GeneratedVideoItem {
  status: 'ok' | 'unavailable'
  video?: {
    attachmentId: string
    name: string
    bytes: number
    mediaType: string
  }
}

/**
 * Normalize the raw `generate_video` arguments, rejecting shapes the schema already
 * narrows but defensive callers (nested dispatches) can still send.
 * @param args - the raw tool arguments.
 * @returns the normalized arguments.
 */
export function parseGenerateVideoArgs(args: unknown): GenerateVideoArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('generate_video: arguments must be an object')
  }
  const raw = args as {
    prompt?: unknown
    size?: unknown
    duration?: unknown
    referenceImage?: unknown
    referenceVideo?: unknown
    firstFrame?: unknown
    lastFrame?: unknown
    referenceAudio?: unknown
    aspectRatio?: unknown
  }
  if (typeof raw.prompt !== 'string' || raw.prompt.trim() === '') {
    throw new Error('generate_video: prompt must be a non-empty string')
  }
  if (raw.size !== undefined && (typeof raw.size !== 'string' || raw.size.trim() === '')) {
    throw new Error('generate_video: size must be a non-empty string when provided')
  }
  const duration = parseDuration(raw.duration)
  const referenceImage = parseReferenceUrl(raw.referenceImage, 'referenceImage')
  const referenceVideo = parseReferenceUrl(raw.referenceVideo, 'referenceVideo')
  const firstFrame = parseReferenceUrl(raw.firstFrame, 'firstFrame')
  const lastFrame = parseReferenceUrl(raw.lastFrame, 'lastFrame')
  const referenceAudio = parseReferenceUrl(raw.referenceAudio, 'referenceAudio')
  const aspectRatio = parseAspectRatio(raw.aspectRatio)
  return {
    prompt: raw.prompt.trim(),
    ...typeof raw.size === 'string' ? { size: raw.size.trim() } : {},
    ...duration === undefined ? {} : { duration },
    ...referenceImage === undefined ? {} : { referenceImage },
    ...referenceVideo === undefined ? {} : { referenceVideo },
    ...firstFrame === undefined ? {} : { firstFrame },
    ...lastFrame === undefined ? {} : { lastFrame },
    ...referenceAudio === undefined ? {} : { referenceAudio },
    ...aspectRatio === undefined ? {} : { aspectRatio },
  }
}

/**
 * Normalize the raw `duration` argument under the same rule as `size`: a provided
 * value must be a positive integer number of seconds.
 * @param value - the raw argument value.
 * @returns the duration in seconds, or `undefined` when the argument is absent.
 */
function parseDuration(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('generate_video: duration must be a positive integer of seconds when provided')
  }
  return value
}

/**
 * Normalize one raw reference-URL argument under the same rule as `size`: a
 * provided value must be a non-empty string.
 * @param value - the raw argument value.
 * @param name - the argument name used in the rejection message.
 * @returns the trimmed URL, or `undefined` when the argument is absent.
 */
function parseReferenceUrl(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`generate_video: ${name} must be a non-empty URL string when provided`)
  }
  return value.trim()
}

/**
 * Normalize the raw `aspectRatio` argument under the same rule as the reference
 * URLs: a provided value must be a non-empty string.
 * @param value - the raw argument value.
 * @returns the trimmed aspect ratio, or `undefined` when the argument is absent.
 */
function parseAspectRatio(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('generate_video: aspectRatio must be a non-empty string when provided')
  }
  return value.trim()
}

/**
 * Render one generated video as the model-facing envelope, bounded to `maxChars`.
 * @param item - the generation outcome to render.
 * @param maxChars - the inclusive character ceiling on the returned text.
 * @returns the envelope text; the file handle rides the adjacent file block.
 */
export function formatGeneratedVideo(item: GeneratedVideoItem, maxChars: number): string {
  if (item.status === 'unavailable') {
    return UNAVAILABLE_TEXT
  }
  const video = item.video
  if (video === undefined) {
    return UNAVAILABLE_TEXT
  }
  const body = `<type>video</type>\n<content>\n${video.mediaType} video generated, ${video.bytes} bytes\n</content>\nThe generated video is attached above this envelope.`
  if (body.length <= maxChars) return body
  const keep = Math.max(0, maxChars - 1)
  return `${body.slice(0, keep)}…`
}

/** Actionable answer returned when video generation cannot run in this deployment. */
export const UNAVAILABLE_TEXT =
  'Video generation is not available: no provider is configured. Configure a generation endpoint (an async video-task service) to generate videos; otherwise continue without video generation.'

/** Longest recorded total title `presentGenerateVideoCall` emits, in characters. */
const MAX_CALL_TITLE_CHARS = 60

/**
 * Render the `presentCall` summary for a generation request.
 * @param args - the raw tool arguments, carrying the prompt and any refinements.
 * @returns the user-facing call presentation.
 */
export function presentGenerateVideoCall(
  args: {
    prompt: string
    size?: string
    duration?: number
    referenceImage?: string
    referenceVideo?: string
    firstFrame?: string
    lastFrame?: string
    referenceAudio?: string
    aspectRatio?: string
  },
): { card: 'generic'; kind: 'other'; title: string } {
  const notes: string[] = []
  if (args.size !== undefined) notes.push(args.size)
  if (args.duration !== undefined) notes.push(`${args.duration}s`)
  if (args.aspectRatio !== undefined) notes.push(args.aspectRatio)
  if (args.referenceImage !== undefined) notes.push('+image')
  if (args.referenceVideo !== undefined) notes.push('+video')
  if (args.referenceAudio !== undefined) notes.push('+audio')
  if (args.firstFrame !== undefined || args.lastFrame !== undefined) notes.push('+frames')
  const suffix = notes.length === 0 ? '' : ` (${notes.join(', ')})`
  const budget = MAX_CALL_TITLE_CHARS - 'Generate video: '.length - suffix.length
  const label = args.prompt.length > budget ? `${args.prompt.slice(0, Math.max(0, budget - 1))}…` : args.prompt
  return { card: 'generic', kind: 'other', title: `Generate video: ${label}${suffix}` }
}

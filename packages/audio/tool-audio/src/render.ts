/**
 * Model-facing presentation for `transcribe_audio`: argument normalization, the
 * transcript envelope, and the bounded rendering shared by the tool and its tests.
 * @module @deepseek-ai/dsh-tool-audio/render
 */

/** Default largest complete rendered result in characters, including truncation metadata. */
export const DEFAULT_MAX_RESULT_CHARS = 8_000

/** Normalized `transcribe_audio` arguments: a non-empty path plus optional refinements. */
export interface TranscribeArgs {
  /** The path to transcribe, as supplied to the tool. */
  readonly filePath: string
  /** Optional ISO 639-1 language hint. */
  readonly language?: string
  /** Optional free-text hint steering the transcription. */
  readonly prompt?: string
}

/** One serializable transcript item projected into the tool's output schema. */
export interface TranscriptItem {
  /** The recognized text. */
  readonly text: string
  /** Optional ISO 639-1 language the provider reported. */
  readonly language?: string
  /** Optional audio duration in seconds as the provider reported it. */
  readonly durationSec?: number
}

/**
 * Normalize the raw `transcribe_audio` arguments, rejecting shapes the schema already
 * narrows but defensive callers (nested dispatches) can still send.
 * @param args - the raw tool arguments.
 * @returns the normalized arguments.
 */
export function parseTranscribeArgs(args: unknown): TranscribeArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('transcribe_audio: arguments must be an object')
  }
  const raw = args as { file_path?: unknown; language?: unknown; prompt?: unknown }
  if (typeof raw.file_path !== 'string' || raw.file_path.trim() === '') {
    throw new Error('transcribe_audio: file_path must be a non-empty string')
  }
  for (const key of ['language', 'prompt'] as const) {
    const value = raw[key]
    if (value !== undefined && typeof value !== 'string') {
      throw new Error(`transcribe_audio: ${key} must be a string when provided`)
    }
  }
  return {
    filePath: raw.file_path.trim(),
    ...typeof raw.language === 'string' && raw.language.trim() !== '' ? { language: raw.language.trim() } : {},
    ...typeof raw.prompt === 'string' && raw.prompt.trim() !== '' ? { prompt: raw.prompt.trim() } : {},
  }
}

/**
 * Render one transcript as the model-facing envelope, bounded to `maxChars`.
 * @param displayPath - the backend-resolved path rendered in the `<path>` element.
 * @param item - the transcript to render.
 * @param maxChars - the inclusive character ceiling on the returned text.
 * @returns the envelope text.
 */
export function formatTranscript(displayPath: string, item: TranscriptItem, maxChars: number): string {
  const metadata: string[] = []
  if (item.language !== undefined) metadata.push(`language ${item.language}`)
  if (item.durationSec !== undefined) metadata.push(`${item.durationSec}s`)
  const meta = metadata.length > 0 ? `<meta>${metadata.join(', ')}</meta>\n` : ''
  const body = `<path>${displayPath}</path>\n<type>transcript</type>\n${meta}<content>\n${item.text}\n</content>`
  if (body.length <= maxChars) return body
  const suffix = `\n<truncated ${body.length} chars omitted>`
  const keep = Math.max(0, maxChars - suffix.length)
  return `${body.slice(0, keep)}\n<truncated ${body.length - keep} chars omitted>`
}

/**
 * Render the `presentCall` summary for a transcription request.
 * @param args - the raw tool arguments, carrying the requested path.
 * @returns the user-facing call presentation.
 */
export function presentTranscribeCall(args: { file_path: string }): { card: 'generic'; kind: 'other'; title: string } {
  const name = args.file_path.split(/[\\/]/).pop() ?? args.file_path
  return { card: 'generic', kind: 'other', title: `Transcribe: ${name}` }
}

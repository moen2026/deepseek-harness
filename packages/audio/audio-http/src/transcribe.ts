/**
 * HTTP transcription client for the audio-http provider. It posts raw audio bytes as
 * `multipart/form-data` to an OpenAI-compatible `/audio/transcriptions` shape and maps the
 * JSON answer onto the seam's transcript vocabulary. The credential is read from an
 * *environment variable name* (`authEnv`) at call time so the secret never enters
 * configuration files or logs; this module never logs the credential.
 * @module @deepseek-ai/dsh-audio-http/transcribe
 */

import { AudioError } from '@deepseek-ai/dsh-audio'
import type { AudioTranscribeRequest, AudioTranscript } from '@deepseek-ai/dsh-audio'

/** Deployment-supplied transcription endpoint description. */
export interface HttpTranscriptionConfig {
  /** Full transcription endpoint URL (an OpenAI-compatible `/audio/transcriptions` shape). */
  readonly url: string
  /** Model name sent to the endpoint. */
  readonly model: string
  /** Name of the environment variable holding the bearer token; never the token itself. */
  readonly authEnv: string
  /** Per-request timeout in milliseconds. Defaults to 60000. */
  readonly timeoutMs?: number
}

/** A transcription function the provider registers on the seam and tests can fake. */
export type HttpTranscriber = (
  request: AudioTranscribeRequest,
  signal?: AbortSignal,
) => Promise<AudioTranscript>

const DEFAULT_TIMEOUT_MS = 60_000

/** File extensions the endpoint hint accepts, mapped to the media type sent with the upload. */
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
}

/**
 * Resolve the media type an upload carries, preferring the declared media type and falling
 * back to the file name's extension.
 * @param request - the transcription request.
 * @returns the media type, or `application/octet-stream` when neither source declares one.
 */
export function uploadMediaType(request: AudioTranscribeRequest): string {
  if (request.mediaType !== undefined && request.mediaType.trim() !== '') return request.mediaType
  const name = request.fileName ?? ''
  const dot = name.lastIndexOf('.')
  if (dot >= 0) {
    const mediaType = MEDIA_TYPES[name.slice(dot).toLowerCase()]
    if (mediaType !== undefined) return mediaType
  }
  return 'application/octet-stream'
}

/**
 * Build an {@link HttpTranscriber} over an OpenAI-compatible transcription endpoint.
 * @param config - the endpoint description.
 * @returns a transcriber that uploads the audio bytes and maps the JSON answer.
 */
export function createHttpTranscriber(config: HttpTranscriptionConfig): HttpTranscriber {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return async (request, signal) => {
    const key = process.env[config.authEnv]
    if (key === undefined || key.trim() === '') {
      throw new AudioError(
        `audio-http: environment variable "${config.authEnv}" is not set`,
        'AUDIO_PROVIDER_FAILED',
      )
    }
    const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)]
    if (signal !== undefined) signals.push(signal)
    const composed = AbortSignal.any(signals)

    const form = new FormData()
    // The defensive copy gives the Blob a standalone ArrayBuffer, matching the BlobPart face.
    form.append('file', new Blob([request.data.slice()], { type: uploadMediaType(request) }), request.fileName ?? 'audio')
    form.append('model', config.model)
    if (request.language !== undefined && request.language.trim() !== '') form.append('language', request.language)
    if (request.prompt !== undefined && request.prompt.trim() !== '') form.append('prompt', request.prompt)

    let response: Response
    try {
      response = await fetch(config.url, {
        method: 'POST',
        signal: composed,
        headers: { authorization: `Bearer ${key}` },
        // The credential is sent only as a header; it is never part of the request body or any log.
        body: form,
      })
    } catch (error) {
      throw new AudioError(`audio-http: transcription request failed: ${String(error)}`, 'AUDIO_PROVIDER_FAILED', { cause: error })
    }
    if (!response.ok) {
      throw new AudioError(`audio-http: transcription endpoint responded ${response.status}`, 'AUDIO_PROVIDER_FAILED')
    }
    let payload: { text?: unknown; language?: unknown; duration?: unknown }
    try {
      payload = await response.json() as typeof payload
    } catch (error) {
      throw new AudioError('audio-http: transcription endpoint returned a non-JSON body', 'AUDIO_PROVIDER_FAILED', { cause: error })
    }
    if (typeof payload.text !== 'string') {
      throw new AudioError('audio-http: transcription endpoint returned an unexpected shape', 'AUDIO_PROVIDER_FAILED')
    }
    return {
      text: payload.text,
      ...typeof payload.language === 'string' && payload.language !== '' ? { language: payload.language } : {},
      ...typeof payload.duration === 'number' && Number.isFinite(payload.duration) ? { durationSec: payload.duration } : {},
    }
  }
}

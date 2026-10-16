/**
 * Async generation client for the video-wuyinkeji provider. Wuyinkeji's video
 * API is task-based and hosts several models; the configured model fixes the
 * submission endpoint and the request-field mapping. One submission call
 * answers with a task id, result-detail polls report the task's settlement, and
 * a settled task names the generated video's URL, which this client downloads
 * into raw bytes. The credential is read from an *environment variable name*
 * (`authEnv`) at call time so the secret never enters configuration files or
 * logs; this module never logs the credential.
 * @module @deepseek-ai/dsh-video-wuyinkeji/generate
 */

import { VideoError } from '@deepseek-ai/dsh-video'
import type { VideoGenerateRequest, VideoResult } from '@deepseek-ai/dsh-video'

/** Base URL of the public Wuyinkeji API. */
export const WUYINKEJI_DEFAULT_BASE_URL = 'https://api.wuyinkeji.com'

/** Submission path of the Google-Omni video model. */
export const WUYINKEJI_VIDEO_GOOGLE_OMNI_PATH = '/api/async/video_google_omni'

/** Submission path of the MiniMax H3 video model. */
export const WUYINKEJI_VIDEO_MINIMAX_H3_PATH = '/api/async/video_minimax_h3'

/** Submission path of the Grok Imagine video model. */
export const WUYINKEJI_VIDEO_GROK_IMAGINE_PATH = '/api/async/video_grok_imagine'

/** Model identifiers the provider accepts; each fixes a submission endpoint and request-field mapping. */
export const WUYINKEJI_VIDEO_MODELS = ['google-omni', 'minimax-h3', 'grok-imagine'] as const

/** One supported Wuyinkeji video model. */
export type WuyinkejiVideoModel = typeof WUYINKEJI_VIDEO_MODELS[number]

/** Result-detail path reporting one generation task's settlement. */
const DETAIL_PATH = '/api/async/detail'

/** Result-detail status of a task that settled successfully. */
const STATUS_DONE = 2

/** Result-detail status of a task that settled with a failure. */
const STATUS_FAILED = 3

/** Deployment-supplied async generation endpoint description. */
export interface WuyinkejiVideoGenerationConfig {
  /** Endpoint base URL; the submit and detail paths are appended. Defaults to the public API. */
  readonly baseURL?: string
  /** Model selecting the submission endpoint and request-field mapping. Defaults to `google-omni`. */
  readonly model?: WuyinkejiVideoModel
  /** Name of the environment variable holding the API key; never the key itself. */
  readonly authEnv: string
  /** Delay between result-detail polls in milliseconds. Defaults to 10000. */
  readonly pollIntervalMs?: number
  /** Overall timeout covering submission, polling, and download in milliseconds. Defaults to 600000. */
  readonly timeoutMs?: number
}

/** A generation function the provider registers on the seam and tests can fake. */
export type WuyinkejiVideoGenerator = (
  request: VideoGenerateRequest,
  signal?: AbortSignal,
) => Promise<VideoResult>

const DEFAULT_POLL_INTERVAL_MS = 10_000
const DEFAULT_TIMEOUT_MS = 600_000
const DEFAULT_MODEL: WuyinkejiVideoModel = 'google-omni'

/** Aspect ratios the MiniMax H3 endpoint accepts. */
const MINIMAX_H3_RATIOS = ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const

/** Inclusive duration bounds, in seconds, of the MiniMax H3 endpoint. */
const MINIMAX_H3_MIN_DURATION_S = 4
const MINIMAX_H3_MAX_DURATION_S = 15

/** Shorter-side pixel count at or above which a pixel-pair size hint maps to the 2K tier. */
const MINIMAX_H3_2K_SHORTER_SIDE_PX = 1080

/** Aspect ratios the Grok Imagine endpoint accepts. */
const GROK_IMAGINE_RATIOS = ['16:9', '9:16'] as const

/** Inclusive duration bounds, in seconds, of the Grok Imagine endpoint. */
const GROK_IMAGINE_MIN_DURATION_S = 6
const GROK_IMAGINE_MAX_DURATION_S = 10

/** One MiniMax H3 resolution tier and, when the hint fixes it, a pixel-pair aspect ratio. */
interface MiniMaxSizeHint {
  readonly resolution: '768P' | '2K'
  readonly ratio?: string
}

/**
 * Wire description of one model: the submission path plus the translation of
 * the seam's request into the endpoint's body fields.
 */
interface VideoModelSpec {
  /** Submission path appended to the base URL. */
  readonly submitPath: string
  /** The endpoint body for one request; throws `VIDEO_INVALID_REQUEST` for hints the endpoint cannot accept. */
  readonly bodyFor: (request: VideoGenerateRequest) => Record<string, unknown>
}

/** Build the Google-Omni body: the size, duration, and reference-media hints pass through mechanically. */
function googleOmniBody(request: VideoGenerateRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { prompt: request.prompt }
  if (request.size !== undefined) body.size = request.size.replaceAll('×', 'x')
  if (request.duration !== undefined) body.duration = String(request.duration)
  if (request.referenceImage !== undefined) body.images = request.referenceImage
  if (request.referenceVideo !== undefined) body.video = request.referenceVideo
  return body
}

/**
 * Build the MiniMax H3 body. First- and last-frame conditioning is mutually
 * exclusive with reference media, so a request carrying both fails before any
 * I/O; the size and duration hints are validated locally, because the endpoint
 * has no equivalent pass-through fields.
 */
function minimaxH3Body(request: VideoGenerateRequest): Record<string, unknown> {
  const frameConditioned = request.firstFrame !== undefined || request.lastFrame !== undefined
  const mediaReferenced = request.referenceImage !== undefined
    || request.referenceVideo !== undefined
    || request.referenceAudio !== undefined
  if (frameConditioned && mediaReferenced) {
    throw new VideoError(
      'video-wuyinkeji: the MiniMax H3 endpoint accepts first/last frame images or reference media, not both',
      'VIDEO_INVALID_REQUEST',
    )
  }
  const body: Record<string, unknown> = { prompt: request.prompt }
  if (request.firstFrame !== undefined) body.first_frame = request.firstFrame
  if (request.lastFrame !== undefined) body.last_frame = request.lastFrame
  if (request.referenceImage !== undefined) body.images = request.referenceImage
  if (request.referenceVideo !== undefined) body.videos = request.referenceVideo
  if (request.referenceAudio !== undefined) body.audios = request.referenceAudio
  if (request.duration !== undefined) {
    if (!Number.isInteger(request.duration) || request.duration < MINIMAX_H3_MIN_DURATION_S
      || request.duration > MINIMAX_H3_MAX_DURATION_S) {
      throw new VideoError(
        `video-wuyinkeji: MiniMax H3 duration must be an integer of ${MINIMAX_H3_MIN_DURATION_S}-${MINIMAX_H3_MAX_DURATION_S} seconds`,
        'VIDEO_INVALID_REQUEST',
      )
    }
    body.duration = String(request.duration)
  }
  if (request.aspectRatio !== undefined) {
    const ratio = acceptedRatio(request.aspectRatio)
    if (ratio === undefined) {
      throw new VideoError(
        `video-wuyinkeji: MiniMax H3 ratio "${request.aspectRatio}" is not one of ${MINIMAX_H3_RATIOS.join(', ')}`,
        'VIDEO_INVALID_REQUEST',
      )
    }
    body.ratio = ratio
  }
  if (request.size !== undefined) {
    const hint = miniMaxSizeHint(request.size)
    if (hint === undefined) {
      throw new VideoError(
        `video-wuyinkeji: MiniMax H3 size "${request.size}" is neither a pixel pair (for example 1280x720) nor a resolution token (768P, 2K)`,
        'VIDEO_INVALID_REQUEST',
      )
    }
    body.resolution = hint.resolution
    // An explicit aspect-ratio hint wins over one derived from the size hint.
    if (hint.ratio !== undefined && request.aspectRatio === undefined) body.ratio = hint.ratio
  }
  return body
}

/**
 * Build the Grok Imagine body. Duration and the aspect ratio are validated
 * against the endpoint's own vocabularies, the one reference image becomes a
 * one-entry `image_urls` array, and hints the endpoint has no fields for
 * (frame conditioning, reference video, reference audio) are dropped.
 */
function grokImagineBody(request: VideoGenerateRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { prompt: request.prompt }
  if (request.duration !== undefined) {
    if (!Number.isInteger(request.duration) || request.duration < GROK_IMAGINE_MIN_DURATION_S
      || request.duration > GROK_IMAGINE_MAX_DURATION_S) {
      throw new VideoError(
        `video-wuyinkeji: Grok Imagine duration must be an integer of ${GROK_IMAGINE_MIN_DURATION_S}-${GROK_IMAGINE_MAX_DURATION_S} seconds`,
        'VIDEO_INVALID_REQUEST',
      )
    }
    body.duration = String(request.duration)
  }
  if (request.aspectRatio !== undefined) {
    const ratio = request.aspectRatio.trim().toLowerCase()
    if (!(GROK_IMAGINE_RATIOS as readonly string[]).includes(ratio)) {
      throw new VideoError(
        `video-wuyinkeji: Grok Imagine ratio "${request.aspectRatio}" is not one of ${GROK_IMAGINE_RATIOS.join(', ')}`,
        'VIDEO_INVALID_REQUEST',
      )
    }
    body.aspect_ratio = ratio
  }
  if (request.referenceImage !== undefined) body.image_urls = [request.referenceImage]
  return body
}

/** Translate one aspect-ratio hint, or `undefined` when it names no accepted ratio. */
function acceptedRatio(hint: string): string | undefined {
  const normalized = hint.trim().toLowerCase()
  return (MINIMAX_H3_RATIOS as readonly string[]).includes(normalized) ? normalized : undefined
}

/** Translate one size hint into the MiniMax resolution tiers, or `undefined` when it is uninterpretable. */
function miniMaxSizeHint(hint: string): MiniMaxSizeHint | undefined {
  const token = hint.trim().toLowerCase()
  if (token === '768p') return { resolution: '768P' }
  if (token === '2k') return { resolution: '2K' }
  const pair = /^([1-9]\d*)\s*[x×]\s*([1-9]\d*)$/.exec(token)
  if (pair === null) return undefined
  const width = Number(pair[1])
  const height = Number(pair[2])
  const resolution = Math.min(width, height) >= MINIMAX_H3_2K_SHORTER_SIDE_PX ? '2K' : '768P'
  const divisor = greatestCommonDivisor(width, height)
  const ratio = `${width / divisor}:${height / divisor}`
  return (MINIMAX_H3_RATIOS as readonly string[]).includes(ratio) ? { resolution, ratio } : { resolution }
}

/** Greatest common divisor of two positive integers, by Euclid's algorithm. */
function greatestCommonDivisor(first: number, second: number): number {
  return second === 0 ? first : greatestCommonDivisor(second, first % second)
}

/**
 * Per-model wire descriptions. Google-Omni passes the size, duration, and
 * reference-media hints through mechanically; MiniMax H3 carries frame
 * conditioning, richer reference media, and its own resolution and ratio
 * vocabulary; Grok Imagine carries its own duration and ratio vocabulary and a
 * single reference image. The latter two validate their hints locally.
 */
const MODEL_SPECS: Record<WuyinkejiVideoModel, VideoModelSpec> = {
  'google-omni': {
    submitPath: WUYINKEJI_VIDEO_GOOGLE_OMNI_PATH,
    bodyFor: googleOmniBody,
  },
  'minimax-h3': {
    submitPath: WUYINKEJI_VIDEO_MINIMAX_H3_PATH,
    bodyFor: minimaxH3Body,
  },
  'grok-imagine': {
    submitPath: WUYINKEJI_VIDEO_GROK_IMAGINE_PATH,
    bodyFor: grokImagineBody,
  },
}

/**
 * Build a {@link WuyinkejiVideoGenerator} over the public async task API.
 * @param config - the endpoint description.
 * @returns a generator that submits the prompt, polls the task, and downloads the video.
 */
export function createWuyinkejiVideoGenerator(config: WuyinkejiVideoGenerationConfig): WuyinkejiVideoGenerator {
  const baseURL = (config.baseURL ?? WUYINKEJI_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const spec = MODEL_SPECS[config.model ?? DEFAULT_MODEL]
  return async (request, signal) => {
    const key = process.env[config.authEnv]
    if (key === undefined || key.trim() === '') {
      throw new VideoError(
        `video-wuyinkeji: environment variable "${config.authEnv}" is not set`,
        'VIDEO_PROVIDER_FAILED',
      )
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const composed = signal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, signal])
    const taskId = await submit(baseURL, key, request, spec, composed, timeoutSignal)
    const videoUrl = await poll(baseURL, key, taskId, pollIntervalMs, composed, timeoutSignal)
    return download(videoUrl, key, composed, timeoutSignal)
  }
}

/** Submit one prompt and return the task id the endpoint assigns. */
async function submit(
  baseURL: string,
  key: string,
  request: VideoGenerateRequest,
  spec: VideoModelSpec,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<string> {
  const body = spec.bodyFor(request)

  let response: Response
  try {
    response = await fetch(`${baseURL}${spec.submitPath}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      signal,
      headers: {
        authorization: key,
        'content-type': 'application/json',
      },
      // The credential rides only in the query string and the header; it is never part of the body or any log.
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw toProviderFailure(error, timeoutSignal, 'submission request failed', key)
  }
  if (!response.ok) {
    throw new VideoError(`video-wuyinkeji: submission endpoint responded ${response.status}`, 'VIDEO_PROVIDER_FAILED')
  }
  const payload = await readJson(response, 'submission endpoint', timeoutSignal, key)
  if (payload.code !== 200) {
    throw new VideoError(`video-wuyinkeji: submission was rejected: ${describeMessage(payload.msg)}`, 'VIDEO_PROVIDER_FAILED')
  }
  const data = payload.data
  const id = isRecord(data) ? data.id : undefined
  if (typeof id !== 'string' || id === '') {
    throw new VideoError('video-wuyinkeji: submission response carried no task id', 'VIDEO_PROVIDER_FAILED')
  }
  return id
}

/** Poll the result-detail endpoint until the task settles and return the video URL. */
async function poll(
  baseURL: string,
  key: string,
  taskId: string,
  pollIntervalMs: number,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<string> {
  const url = `${baseURL}${DETAIL_PATH}?key=${encodeURIComponent(key)}&id=${encodeURIComponent(taskId)}`
  for (;;) {
    let response: Response
    try {
      response = await fetch(url, { signal, headers: { authorization: key } })
    } catch (error) {
      throw toProviderFailure(error, timeoutSignal, 'result-detail request failed', key)
    }
    if (!response.ok) {
      throw new VideoError(`video-wuyinkeji: result-detail endpoint responded ${response.status}`, 'VIDEO_PROVIDER_FAILED')
    }
    const payload = await readJson(response, 'result-detail endpoint', timeoutSignal, key)
    if (payload.code !== 200) {
      throw new VideoError(`video-wuyinkeji: result-detail was rejected: ${describeMessage(payload.msg)}`, 'VIDEO_PROVIDER_FAILED')
    }
    const data = payload.data
    if (!isRecord(data)) {
      throw new VideoError('video-wuyinkeji: result-detail response carried no task data', 'VIDEO_PROVIDER_FAILED')
    }
    if (data.status === STATUS_DONE) {
      const first: unknown = Array.isArray(data.result) ? data.result[0] : undefined
      if (typeof first !== 'string' || first === '') {
        throw new VideoError('video-wuyinkeji: settled task carried no video URL', 'VIDEO_PROVIDER_FAILED')
      }
      return first
    }
    if (data.status === STATUS_FAILED) {
      throw new VideoError(`video-wuyinkeji: generation failed: ${describeMessage(data.message)}`, 'VIDEO_PROVIDER_FAILED')
    }
    if (data.status !== 0 && data.status !== 1) {
      throw new VideoError(`video-wuyinkeji: result-detail reported an unknown status ${String(data.status)}`, 'VIDEO_PROVIDER_FAILED')
    }
    try {
      await sleep(pollIntervalMs, signal)
    } catch (error) {
      throw toProviderFailure(error, timeoutSignal, 'polling was interrupted', key)
    }
  }
}

/** Download the settled video URL into its raw bytes and media type. */
async function download(
  url: string,
  key: string,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<VideoResult> {
  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch (error) {
    throw toProviderFailure(error, timeoutSignal, 'video download failed', key)
  }
  if (!response.ok) {
    throw new VideoError(`video-wuyinkeji: video download responded ${response.status}`, 'VIDEO_PROVIDER_FAILED')
  }
  let bytes: ArrayBuffer
  try {
    bytes = await response.arrayBuffer()
  } catch (error) {
    throw toProviderFailure(error, timeoutSignal, 'video download body read failed', key)
  }
  return { data: new Uint8Array(bytes), mediaType: mediaTypeOf(response, url) }
}

/** Read one JSON object body, mapping any deviation onto a typed provider failure. */
async function readJson(
  response: Response,
  stage: string,
  timeoutSignal: AbortSignal,
  key: string,
): Promise<Record<string, unknown>> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    // Only a parse failure is a body-content problem; anything else interrupted the read.
    if (error instanceof SyntaxError) {
      throw new VideoError(`video-wuyinkeji: ${stage} returned a non-JSON body`, 'VIDEO_PROVIDER_FAILED', { cause: error })
    }
    throw toProviderFailure(error, timeoutSignal, `${stage} body read failed`, key)
  }
  if (!isRecord(payload)) {
    throw new VideoError(`video-wuyinkeji: ${stage} returned a non-JSON body`, 'VIDEO_PROVIDER_FAILED')
  }
  return payload
}

/** Wait one poll interval, rejecting with the abort reason as soon as the signal aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('aborted', { cause: signal.reason }))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Map one transport failure onto a typed provider error, naming an elapsed overall timeout. */
function toProviderFailure(error: unknown, timeoutSignal: AbortSignal, activity: string, key: string): VideoError {
  const detail = timeoutSignal.aborted ? 'timed out' : redact(String(error), key)
  return new VideoError(`video-wuyinkeji: ${activity}: ${detail}`, 'VIDEO_PROVIDER_FAILED', { cause: error })
}

/** Replace the credential wherever a transport diagnostic embeds it, raw or URL-encoded. */
function redact(text: string, key: string): string {
  return text.replaceAll(key, '***').replaceAll(encodeURIComponent(key), '***')
}

/** Resolve the media type from the download's content type, falling back to the URL extension. */
function mediaTypeOf(response: Response, url: string): string {
  const header = response.headers.get('content-type')?.split(';', 1)[0]?.trim()
  if (header !== undefined && header.startsWith('video/')) return header
  const extension = url.split('?', 1)[0]?.split('.').pop()?.toLowerCase()
  if (extension === 'webm') return 'video/webm'
  if (extension === 'mov') return 'video/quicktime'
  return 'video/mp4'
}

/** Narrow one parsed JSON value to an object with unknown fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A human-readable rendering of an endpoint message field. */
function describeMessage(value: unknown): string {
  return typeof value === 'string' && value !== '' ? value : 'unknown error'
}

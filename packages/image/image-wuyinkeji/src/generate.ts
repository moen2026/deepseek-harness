/**
 * Async generation client for the image-wuyinkeji provider. Wuyinkeji's image
 * API is task-based and hosts several models; the configured model fixes the
 * submission endpoint, the wire ratio vocabulary, and whether reference-image
 * URLs are forwarded. One submission call
 * answers with a task id, result-detail polls report the task's settlement,
 * and a settled task names the generated image's URL, which this client
 * downloads into raw bytes. The credential is read from an *environment
 * variable name* (`authEnv`) at call time so the secret never enters
 * configuration files or logs; this module never logs the credential.
 * @module @deepseek-ai/dsh-image-wuyinkeji/generate
 */

import { ImageError } from '@deepseek-ai/dsh-image'
import type { ImageGenerateRequest, ImageResult } from '@deepseek-ai/dsh-image'

/** Base URL of the public Wuyinkeji API. */
export const WUYINKEJI_DEFAULT_BASE_URL = 'https://api.wuyinkeji.com'

/** Model identifiers the provider accepts; each fixes a submission endpoint and ratio vocabulary. */
export const WUYINKEJI_MODELS = ['gpt-image-2.5', 'nano-banana-2-lite'] as const

/** One supported Wuyinkeji image model. */
export type WuyinkejiModel = typeof WUYINKEJI_MODELS[number]

/** Result-detail path reporting one generation task's settlement. */
const DETAIL_PATH = '/api/async/detail'

/** Result-detail status of a task that settled successfully. */
const STATUS_DONE = 2

/** Result-detail status of a task that settled with a failure. */
const STATUS_FAILED = 3

/** Deployment-supplied async generation endpoint description. */
export interface WuyinkejiGenerationConfig {
  /** Endpoint base URL; the submit and detail paths are appended. Defaults to the public API. */
  readonly baseURL?: string
  /** Model selecting the submission endpoint, ratio vocabulary, and reference-image forwarding. Defaults to `gpt-image-2.5`. */
  readonly model?: WuyinkejiModel
  /** Name of the environment variable holding the API key; never the key itself. */
  readonly authEnv: string
  /**
   * Aspect ratio sent when a request carries no `size`, expressed in the selected
   * model's vocabulary (for example `1024*1024`); omitted = endpoint default.
   */
  readonly aspectRatio?: string
  /** Delay between result-detail polls in milliseconds. Defaults to 3000. */
  readonly pollIntervalMs?: number
  /** Overall timeout covering submission, polling, and download in milliseconds. Defaults to 120000. */
  readonly timeoutMs?: number
}

/** A generation function the provider registers on the seam and tests can fake. */
export type WuyinkejiGenerator = (
  request: ImageGenerateRequest,
  signal?: AbortSignal,
) => Promise<ImageResult>

const DEFAULT_POLL_INTERVAL_MS = 3_000
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MODEL: WuyinkejiModel = 'gpt-image-2.5'

/**
 * Wire description of one model: the submission path plus the translation of
 * the seam's size hint (or the configured fallback) into the wire ratio.
 */
interface ModelSpec {
  /** Submission path appended to the base URL. */
  readonly submitPath: string
  /** The wire ratio for one request: an explicit size hint wins over the configured fallback. */
  readonly aspectRatioFor: (size: string | undefined, fallback: string | undefined) => string | undefined
  /** Reference-image URLs to send as `urls`, or `undefined` for a model that accepts none. */
  readonly referenceImagesFor: (request: ImageGenerateRequest) => readonly string[] | undefined
}

/**
 * Per-model wire descriptions. GPT-Image-2.5 speaks pixel-pair ratios
 * (`1024*1024`), so a hint rewrites `x`/`×` as `*`, and rejects a submission
 * carrying `urls` (the upstream answers 500), so it never sends reference
 * images; NanoBanana2Lite speaks colon ratios (`16:9`), so a pixel pair
 * reduces to its lowest-terms ratio, and forwards reference-image URLs
 * verbatim.
 */
const MODEL_SPECS: Record<WuyinkejiModel, ModelSpec> = {
  'gpt-image-2.5': {
    submitPath: '/api/async/image_gpt_2.5',
    aspectRatioFor: (size, fallback) => {
      const hint = size?.trim()
      if (hint !== undefined && hint !== '') return hint.replaceAll(/[x×]/gi, '*')
      return fallback
    },
    referenceImagesFor: () => undefined,
  },
  'nano-banana-2-lite': {
    submitPath: '/api/async/image_nanoBanana2Lite',
    aspectRatioFor: (size, fallback) => {
      const hint = size?.trim()
      if (hint === undefined || hint === '') return fallback
      const pair = /^([1-9]\d*)\s*[x×]\s*([1-9]\d*)$/i.exec(hint)
      if (pair === null) return hint
      const width = Number(pair[1])
      const height = Number(pair[2])
      const divisor = greatestCommonDivisor(width, height)
      return `${width / divisor}:${height / divisor}`
    },
    referenceImagesFor: request => request.referenceImages,
  },
}

/**
 * Build a {@link WuyinkejiGenerator} over the public async task API.
 * @param config - the endpoint description.
 * @returns a generator that submits the prompt, polls the task, and downloads the image.
 */
export function createWuyinkejiGenerator(config: WuyinkejiGenerationConfig): WuyinkejiGenerator {
  const baseURL = (config.baseURL ?? WUYINKEJI_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const spec = MODEL_SPECS[config.model ?? DEFAULT_MODEL]
  return async (request, signal) => {
    const key = process.env[config.authEnv]
    if (key === undefined || key.trim() === '') {
      throw new ImageError(
        `image-wuyinkeji: environment variable "${config.authEnv}" is not set`,
        'IMAGE_PROVIDER_FAILED',
      )
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const composed = signal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, signal])
    const taskId = await submit(baseURL, key, request, spec, config.aspectRatio, composed, timeoutSignal)
    const imageUrl = await poll(baseURL, key, taskId, pollIntervalMs, composed, timeoutSignal)
    return download(imageUrl, key, composed, timeoutSignal)
  }
}

/** Submit one prompt and return the task id the endpoint assigns. */
async function submit(
  baseURL: string,
  key: string,
  request: ImageGenerateRequest,
  spec: ModelSpec,
  fallbackRatio: string | undefined,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<string> {
  const body: Record<string, unknown> = { prompt: request.prompt }
  const aspectRatio = spec.aspectRatioFor(request.size, fallbackRatio)
  if (aspectRatio !== undefined) body.aspectRatio = aspectRatio
  const referenceImages = spec.referenceImagesFor(request)
  if (referenceImages !== undefined) body.urls = referenceImages

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
    throw new ImageError(`image-wuyinkeji: submission endpoint responded ${response.status}`, 'IMAGE_PROVIDER_FAILED')
  }
  const payload = await readJson(response, 'submission endpoint', timeoutSignal, key)
  if (payload.code !== 200) {
    throw new ImageError(`image-wuyinkeji: submission was rejected: ${describeMessage(payload.msg)}`, 'IMAGE_PROVIDER_FAILED')
  }
  const data = payload.data
  const id = isRecord(data) ? data.id : undefined
  if (typeof id !== 'string' || id === '') {
    throw new ImageError('image-wuyinkeji: submission response carried no task id', 'IMAGE_PROVIDER_FAILED')
  }
  return id
}

/** Poll the result-detail endpoint until the task settles and return the image URL. */
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
      throw new ImageError(`image-wuyinkeji: result-detail endpoint responded ${response.status}`, 'IMAGE_PROVIDER_FAILED')
    }
    const payload = await readJson(response, 'result-detail endpoint', timeoutSignal, key)
    if (payload.code !== 200) {
      throw new ImageError(`image-wuyinkeji: result-detail was rejected: ${describeMessage(payload.msg)}`, 'IMAGE_PROVIDER_FAILED')
    }
    const data = payload.data
    if (!isRecord(data)) {
      throw new ImageError('image-wuyinkeji: result-detail response carried no task data', 'IMAGE_PROVIDER_FAILED')
    }
    if (data.status === STATUS_DONE) {
      const first: unknown = Array.isArray(data.result) ? data.result[0] : undefined
      if (typeof first !== 'string' || first === '') {
        throw new ImageError('image-wuyinkeji: settled task carried no image URL', 'IMAGE_PROVIDER_FAILED')
      }
      return first
    }
    if (data.status === STATUS_FAILED) {
      throw new ImageError(`image-wuyinkeji: generation failed: ${describeMessage(data.message)}`, 'IMAGE_PROVIDER_FAILED')
    }
    if (data.status !== 0 && data.status !== 1) {
      throw new ImageError(`image-wuyinkeji: result-detail reported an unknown status ${String(data.status)}`, 'IMAGE_PROVIDER_FAILED')
    }
    try {
      await sleep(pollIntervalMs, signal)
    } catch (error) {
      throw toProviderFailure(error, timeoutSignal, 'polling was interrupted', key)
    }
  }
}

/** Download the settled image URL into its raw bytes and media type. */
async function download(
  url: string,
  key: string,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<ImageResult> {
  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch (error) {
    throw toProviderFailure(error, timeoutSignal, 'image download failed', key)
  }
  if (!response.ok) {
    throw new ImageError(`image-wuyinkeji: image download responded ${response.status}`, 'IMAGE_PROVIDER_FAILED')
  }
  let bytes: ArrayBuffer
  try {
    bytes = await response.arrayBuffer()
  } catch (error) {
    throw toProviderFailure(error, timeoutSignal, 'image download body read failed', key)
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
      throw new ImageError(`image-wuyinkeji: ${stage} returned a non-JSON body`, 'IMAGE_PROVIDER_FAILED', { cause: error })
    }
    throw toProviderFailure(error, timeoutSignal, `${stage} body read failed`, key)
  }
  if (!isRecord(payload)) {
    throw new ImageError(`image-wuyinkeji: ${stage} returned a non-JSON body`, 'IMAGE_PROVIDER_FAILED')
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

/** Greatest common divisor of two positive integers, by Euclid's algorithm. */
function greatestCommonDivisor(first: number, second: number): number {
  return second === 0 ? first : greatestCommonDivisor(second, first % second)
}

/** Map one transport failure onto a typed provider error, naming an elapsed overall timeout. */
function toProviderFailure(error: unknown, timeoutSignal: AbortSignal, activity: string, key: string): ImageError {
  const detail = timeoutSignal.aborted ? 'timed out' : redact(String(error), key)
  return new ImageError(`image-wuyinkeji: ${activity}: ${detail}`, 'IMAGE_PROVIDER_FAILED', { cause: error })
}

/** Replace the credential wherever a transport diagnostic embeds it, raw or URL-encoded. */
function redact(text: string, key: string): string {
  return text.replaceAll(key, '***').replaceAll(encodeURIComponent(key), '***')
}

/** Resolve the media type from the download's content type, falling back to the URL extension. */
function mediaTypeOf(response: Response, url: string): string {
  const header = response.headers.get('content-type')?.split(';', 1)[0]?.trim()
  if (header !== undefined && header.startsWith('image/')) return header
  const extension = url.split('?', 1)[0]?.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  return 'image/png'
}

/** Narrow one parsed JSON value to an object with unknown fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A human-readable rendering of an endpoint message field. */
function describeMessage(value: unknown): string {
  return typeof value === 'string' && value !== '' ? value : 'unknown error'
}

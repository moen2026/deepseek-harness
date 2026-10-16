/**
 * Volcengine Ark generation client for the video-volc provider. Ark hosts
 * Seedance video generation behind two task families: the chat-completions
 * shape this provider shipped with and the content-generation task endpoints
 * the Seedance 2.5 model ids speak. Both families answer a submission with a
 * task id, report the task's settlement on polls, and settle on the generated
 * video's URL, which this client downloads into raw bytes. Requests
 * authenticate with a Bearer ARK API key read from an *environment variable
 * name* (`authEnv`) at call time so the secret never enters configuration
 * files or logs; this module never logs the credential.
 * @module @deepseek-ai/dsh-video-volc/generate
 */

import { VideoError } from '@deepseek-ai/dsh-video'
import type { VideoGenerateRequest, VideoResult } from '@deepseek-ai/dsh-video'
import { describeMessage, isRecord, sleep, toProviderFailure } from './internal.ts'

/** Base URL of the public Volcengine Ark inference plane. */
export const VOLC_DEFAULT_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com'

/** Submission path of the Ark video-generation task (chat-completions shape). */
export const ARK_CHAT_COMPLETIONS_PATH = '/api/v3/ark/chat/completions'

/** Submission path of the Ark content-generation task family (Seedance 2.5 models). */
export const ARK_CONTENT_GENERATION_TASKS_PATH = '/api/v3/contents/generations/tasks'

/** Task-query path reporting one generation task's settlement. */
export const ARK_TASK_GET_PATH = '/api/v3/ark/task/get'

/** Ark model identifier submitted for one generation. */
export const VOLC_DEFAULT_MODEL = 'seedance-2.0'

/** Size tiers the chat-completions Seedance endpoint accepts. */
export const VOLC_SIZES = ['720p', '1080p'] as const

/** Resolution tiers the content-generation Seedance endpoint accepts. */
export const VOLC_CONTENT_SIZES = ['480p', '720p', '1080p'] as const

/** Task statuses that settle a generation successfully (chat-completions and content-generation wordings). */
const TASK_DONE_STATUSES = new Set(['Success', 'Completed', 'Done', 'Active', 'succeeded'])

/** Task statuses that settle a generation with a failure. */
const TASK_FAILED_STATUSES = new Set(['Failed', 'Error', 'failed'])

/** Deployment-supplied async generation endpoint description. */
export interface VolcVideoGenerationConfig {
  /** Ark inference base URL; the submission and task paths are appended. Defaults to the public plane. */
  readonly arkBaseURL?: string
  /** Ark model identifier. Defaults to `seedance-2.0`. */
  readonly model?: string
  /** Name of the environment variable holding the ARK API key; never the key itself. */
  readonly authEnv: string
  /** Project name the task is filed under. Defaults to `default`. */
  readonly project?: string
  /** Delay between task polls in milliseconds. Defaults to 10000. */
  readonly pollIntervalMs?: number
  /** Overall timeout covering submission, polling, and download in milliseconds. Defaults to 600000. */
  readonly timeoutMs?: number
  /** Whether the content-generation family generates native audio; undefined omits the field. */
  readonly generateAudio?: boolean
  /** Value of `extra_body.omni_reference_task_type` for content-generation submissions; undefined omits it. */
  readonly referenceTaskType?: string
}

/** The task family one Ark model id speaks. */
type VolcTaskFamily = 'chat-completions' | 'content-generation'

/** A generation function the provider registers on the seam and tests can fake. */
export type VolcVideoGenerator = (
  request: VideoGenerateRequest,
  signal?: AbortSignal,
) => Promise<VideoResult>

const DEFAULT_POLL_INTERVAL_MS = 10_000
const DEFAULT_TIMEOUT_MS = 600_000
const DEFAULT_MODEL = VOLC_DEFAULT_MODEL
const DEFAULT_PROJECT = 'default'

/** Validate the duration hint both task families carry. */
function validateDuration(duration: number): void {
  if (!Number.isInteger(duration) || duration <= 0) {
    throw new VideoError(
      'video-volc: Seedance duration must be a positive integer of seconds',
      'VIDEO_INVALID_REQUEST',
    )
  }
}

/**
 * Build the chat-completions submission body. The prompt becomes the user
 * message, the one reference image becomes a leading `reference_image`
 * message entry, and the duration and size hints are validated locally,
 * because the endpoint's size vocabulary is its own. Hints the endpoint has
 * no fields for (aspect ratio, frame conditioning, reference video, reference
 * audio) are dropped.
 */
function volcBody(request: VideoGenerateRequest, model: string): Record<string, unknown> {
  const messages: unknown[] = []
  if (request.referenceImage !== undefined) {
    messages.push({ type: 'image_url', image_url: { url: request.referenceImage }, role: 'reference_image' })
  }
  messages.push({ role: 'user', content: request.prompt })
  const body: Record<string, unknown> = { model, messages }
  if (request.duration !== undefined) {
    validateDuration(request.duration)
    body.duration = request.duration
  }
  if (request.size !== undefined) body.size = volcSizeHint(request.size, VOLC_SIZES)
  return body
}

/**
 * Build the content-generation submission body. The prompt becomes the text
 * entry, each present reference becomes one typed content entry with its
 * role, the aspect ratio maps onto `ratio`, and the size hint maps onto the
 * 480p/720p/1080p resolution tiers. The configured audio switch and
 * reference task type map onto `generate_audio` and `extra_body`; undefined
 * values omit their fields.
 */
function volcContentBody(
  request: VideoGenerateRequest,
  model: string,
  config: VolcVideoGenerationConfig,
): Record<string, unknown> {
  const content: unknown[] = [{ type: 'text', text: request.prompt }]
  if (request.referenceImage !== undefined) {
    content.push({ type: 'image_url', image_url: { url: request.referenceImage }, role: 'reference_image' })
  }
  if (request.referenceVideo !== undefined) {
    content.push({ type: 'video_url', video_url: { url: request.referenceVideo }, role: 'reference_video' })
  }
  if (request.referenceAudio !== undefined) {
    content.push({ type: 'audio_url', audio_url: { url: request.referenceAudio }, role: 'reference_audio' })
  }
  const body: Record<string, unknown> = { model, content }
  if (request.duration !== undefined) {
    // -1 is the endpoint's automatic-duration sentinel: the model decides the length.
    if (request.duration !== -1) validateDuration(request.duration)
    body.duration = request.duration
  }
  if (request.aspectRatio !== undefined) body.ratio = request.aspectRatio
  if (request.size !== undefined) body.resolution = volcSizeHint(request.size, VOLC_CONTENT_SIZES)
  if (config.generateAudio !== undefined) body.generate_audio = config.generateAudio
  if (config.referenceTaskType !== undefined) body.extra_body = { omni_reference_task_type: config.referenceTaskType }
  return body
}

/** Translate one size hint into the addressed family's tiers, or fail for an uninterpretable hint. */
function volcSizeHint(hint: string, tiers: readonly [string, ...string[]]): string {
  const token = hint.trim().toLowerCase()
  if (tiers.includes(token)) return token
  const pair = /^([1-9]\d*)\s*[x×]\s*([1-9]\d*)$/.exec(token)
  if (pair === null) {
    throw new VideoError(
      `video-volc: Seedance size "${hint}" is neither a pixel pair (for example 1280x720) nor a resolution token (${tiers.join(', ')})`,
      'VIDEO_INVALID_REQUEST',
    )
  }
  const shorter = Math.min(Number(pair[1]), Number(pair[2]))
  const matched = [...tiers].reverse().find(tier => shorter >= Number(tier.slice(0, -1)))
  return matched ?? tiers[0]
}

/**
 * Resolve the task family the configured model id speaks. Official Ark model
 * ids (`doubao-seedance-*`, Seedance 1.0 and 2.5 alike) use the
 * content-generation task endpoints; every other model keeps the
 * chat-completions submission this provider shipped with.
 */
function volcTaskFamily(model: string): VolcTaskFamily {
  return model.startsWith('doubao-seedance-') ? 'content-generation' : 'chat-completions'
}

/**
 * Build a {@link VolcVideoGenerator} over the public Ark inference plane.
 * @param config - the endpoint description.
 * @returns a generator that submits the prompt, polls the task, and downloads the video.
 */
export function createVolcVideoGenerator(config: VolcVideoGenerationConfig): VolcVideoGenerator {
  const arkBaseURL = (config.arkBaseURL ?? VOLC_DEFAULT_ARK_BASE_URL).replace(/\/+$/, '')
  const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const model = config.model ?? DEFAULT_MODEL
  const project = config.project ?? DEFAULT_PROJECT
  const family = volcTaskFamily(model)
  return async (request, signal) => {
    const key = process.env[config.authEnv]
    if (key === undefined || key.trim() === '') {
      throw new VideoError(
        `video-volc: environment variable "${config.authEnv}" is not set`,
        'VIDEO_PROVIDER_FAILED',
      )
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const composed = signal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, signal])
    const body = family === 'content-generation' ? volcContentBody(request, model, config) : volcBody(request, model)
    const taskId = await submit(arkBaseURL, key, family, body, composed, timeoutSignal)
    const videoUrl = await poll(arkBaseURL, key, family, project, taskId, pollIntervalMs, composed, timeoutSignal)
    return download(videoUrl, key, composed, timeoutSignal)
  }
}

/** Submit one generation task and return the task id the endpoint assigns. */
async function submit(
  arkBaseURL: string,
  key: string,
  family: VolcTaskFamily,
  body: Record<string, unknown>,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<string> {
  const path = family === 'content-generation' ? ARK_CONTENT_GENERATION_TASKS_PATH : ARK_CHAT_COMPLETIONS_PATH
  let response: Response
  try {
    response = await fetch(`${arkBaseURL}${path}`, {
      method: 'POST',
      signal,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw toProviderFailure(error, timeoutSignal, 'submission request failed', key)
  }
  if (!response.ok) {
    throw new VideoError(`video-volc: submission endpoint responded ${response.status}`, 'VIDEO_PROVIDER_FAILED')
  }
  const payload = await readJson(response, 'submission endpoint', timeoutSignal, key)
  const id = payload.TaskId ?? payload.taskId ?? payload.id
  if (typeof id !== 'string' || id === '') {
    throw new VideoError('video-volc: submission response carried no task id', 'VIDEO_PROVIDER_FAILED')
  }
  return id
}

/** Poll the task endpoint until the task settles and return the video URL. */
async function poll(
  arkBaseURL: string,
  key: string,
  family: VolcTaskFamily,
  project: string,
  taskId: string,
  pollIntervalMs: number,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<string> {
  const contentFamily = family === 'content-generation'
  for (;;) {
    const requestUrl = contentFamily
      ? `${arkBaseURL}${ARK_CONTENT_GENERATION_TASKS_PATH}/${taskId}`
      : `${arkBaseURL}${ARK_TASK_GET_PATH}`
    const init: RequestInit = contentFamily
      ? { method: 'GET', signal, headers: { authorization: `Bearer ${key}` } }
      : {
        method: 'POST',
        signal,
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ProjectName: project, TaskId: taskId }),
      }
    let response: Response
    try {
      response = await fetch(requestUrl, init)
    } catch (error) {
      throw toProviderFailure(error, timeoutSignal, 'task request failed', key)
    }
    if (!response.ok) {
      throw new VideoError(`video-volc: task endpoint responded ${response.status}`, 'VIDEO_PROVIDER_FAILED')
    }
    const payload = await readJson(response, 'task endpoint', timeoutSignal, key)
    const status = payload.Status ?? payload.status
    if (typeof status === 'string' && TASK_DONE_STATUSES.has(status)) {
      const settledUrl = contentFamily
        ? contentVideoUrl(payload)
        : payload.VideoUrl ?? payload.videoUrl ?? payload.url
      if (typeof settledUrl !== 'string' || settledUrl === '') {
        throw new VideoError('video-volc: settled task carried no video URL', 'VIDEO_PROVIDER_FAILED')
      }
      return settledUrl
    }
    if (typeof status === 'string' && TASK_FAILED_STATUSES.has(status)) {
      const message = contentFamily ? contentFailureMessage(payload) : payload.Message ?? payload.message
      throw new VideoError(
        `video-volc: generation failed: ${describeMessage(message)}`,
        'VIDEO_PROVIDER_FAILED',
      )
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
    throw new VideoError(`video-volc: video download responded ${response.status}`, 'VIDEO_PROVIDER_FAILED')
  }
  let bytes: ArrayBuffer
  try {
    bytes = await response.arrayBuffer()
  } catch (error) {
    throw toProviderFailure(error, timeoutSignal, 'video download body read failed', key)
  }
  return { data: new Uint8Array(bytes), mediaType: mediaTypeOf(response, url) }
}

/** Extract the content-generation settlement's `content.video_url` when the content object is present. */
function contentVideoUrl(payload: Record<string, unknown>): unknown {
  const content = payload.content
  return isRecord(content) ? content.video_url : undefined
}

/** Extract the content-generation failure message from its `error` object or bare error field. */
function contentFailureMessage(payload: Record<string, unknown>): unknown {
  return isRecord(payload.error) ? payload.error.Message ?? payload.error.message : payload.error
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
      throw new VideoError(`video-volc: ${stage} returned a non-JSON body`, 'VIDEO_PROVIDER_FAILED', { cause: error })
    }
    throw toProviderFailure(error, timeoutSignal, `${stage} body read failed`, key)
  }
  if (!isRecord(payload)) {
    throw new VideoError(`video-volc: ${stage} returned a non-JSON body`, 'VIDEO_PROVIDER_FAILED')
  }
  return payload
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

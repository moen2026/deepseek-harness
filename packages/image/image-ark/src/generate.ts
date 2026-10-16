/**
 * Volcengine Ark generation client for the image-ark provider. Ark hosts
 * Seedream image generation behind one synchronous `/images/generations` POST:
 * the request names the prompt, an optional reference image, and the optional
 * layer-decomposition switch, and the answer carries one URL per produced
 * image — one for a plain generation, several cropped layers for a
 * decomposition — which this client downloads into raw bytes and maps onto the
 * seam's result vocabulary. Requests authenticate with a Bearer ARK API key
 * read from an *environment variable name* (`authEnv`) at call time so the
 * secret never enters configuration files or logs; this module never logs the
 * credential.
 * @module @deepseek-ai/dsh-image-ark/generate
 */

import { ImageError } from '@deepseek-ai/dsh-image'
import type { ImageGenerateRequest, ImageLayer, ImageResult } from '@deepseek-ai/dsh-image'

/** Base URL of the public Volcengine Ark inference plane. */
export const ARK_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com'

/** Submission path of the Ark image-generation endpoint. */
export const ARK_IMAGES_GENERATIONS_PATH = '/api/v3/images/generations'

/** Ark model identifier submitted for one generation. */
export const ARK_DEFAULT_MODEL = 'doubao-seedream-5-0-pro-260628'

/** Deployment-supplied generation endpoint description. */
export interface ArkImageGenerationConfig {
  /** Ark inference base URL; the submission path is appended. Defaults to the public plane. */
  readonly arkBaseURL?: string
  /** Ark model identifier. Defaults to `doubao-seedream-5-0-pro-260628`. */
  readonly model?: string
  /** Name of the environment variable holding the ARK API key; never the key itself. */
  readonly authEnv: string
  /** Ask the endpoint to decompose the generation into layers. Defaults to false. */
  readonly layerDecomposition?: boolean
  /** Output format requested from the endpoint (`png` or `jpeg`); undefined omits the field. */
  readonly outputFormat?: 'png' | 'jpeg'
  /** Per-request timeout covering submission and every download in milliseconds. Defaults to 120000. */
  readonly timeoutMs?: number
}

/** A generation function the provider registers on the seam and tests can fake. */
export type ArkImageGenerator = (
  request: ImageGenerateRequest,
  signal?: AbortSignal,
) => Promise<ImageResult>

const DEFAULT_TIMEOUT_MS = 120_000

/** Media types the endpoint's `output_format` field reports, mapped to MIME types. */
const FORMAT_MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/**
 * Build an {@link ArkImageGenerator} over the public Ark inference plane.
 * @param config - the endpoint description.
 * @returns a generator that posts the prompt, downloads every answered image URL,
 * and maps a decomposed answer onto the seam's layer vocabulary.
 */
export function createArkImageGenerator(config: ArkImageGenerationConfig): ArkImageGenerator {
  const arkBaseURL = (config.arkBaseURL ?? ARK_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const model = config.model ?? ARK_DEFAULT_MODEL
  return async (request, signal) => {
    const key = process.env[config.authEnv]
    if (key === undefined || key.trim() === '') {
      throw new ImageError(
        `image-ark: environment variable "${config.authEnv}" is not set`,
        'IMAGE_PROVIDER_FAILED',
      )
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const composed = signal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, signal])
    const payload = await submit(arkBaseURL, key, arkBody(request, model, config), composed)
    const entries = payload.data
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new ImageError('image-ark: generation response carried no images', 'IMAGE_PROVIDER_FAILED')
    }
    const decomposed = config.layerDecomposition === true && entries.length > 1
    const images = entries.map(entry => imageEntry(entry, decomposed))
    const layers = await Promise.all(images.map(async (image): Promise<ImageLayer> => {
      const fetched = await download(image.url, composed)
      return {
        zIndex: image.zIndex,
        ...image.layer,
        // A declared image/* content type refines the format field's fallback.
        ...fetched.mediaType === undefined ? {} : { mediaType: fetched.mediaType },
        data: fetched.data,
      }
    }))
    // The composed background is the lowest layer; a plain generation has exactly one.
    const bottom = layers.reduce((lowest, layer) => (layer.zIndex < lowest.zIndex ? layer : lowest))
    return {
      data: bottom.data,
      mediaType: bottom.mediaType,
      ...decomposed ? { layers } : {},
    }
  }
}

/** Build the Ark submission body from the seam request and the deployment config. */
function arkBody(
  request: ImageGenerateRequest,
  model: string,
  config: ArkImageGenerationConfig,
): Record<string, unknown> {
  const body: Record<string, unknown> = { model, prompt: request.prompt, response_format: 'url' }
  const reference = request.referenceImages?.[0]
  if (reference !== undefined) body.image = reference
  if (config.layerDecomposition === true) body.layer_decomposition = true
  if (request.size !== undefined && request.size.trim() !== '') body.size = request.size.trim()
  if (config.outputFormat !== undefined) body.output_format = config.outputFormat
  return body
}

/** One answered image entry, narrowed to the fields the seam vocabulary carries. */
interface AnsweredImage {
  url: string
  zIndex: number
  layer: Pick<ImageLayer, 'mediaType' | 'width' | 'height' | 'boundingBox' | 'name' | 'description'>
}

/** Parse the endpoint fields one answered image entry must and may carry. */
function imageEntry(entry: unknown, decomposed: boolean): AnsweredImage {
  if (typeof entry !== 'object' || entry === null) {
    throw new ImageError('image-ark: generation response carried an unexpected shape', 'IMAGE_PROVIDER_FAILED')
  }
  const record = entry as Record<string, unknown>
  if (typeof record.url !== 'string' || record.url === '') {
    throw new ImageError('image-ark: generation response carried an unexpected shape', 'IMAGE_PROVIDER_FAILED')
  }
  const zIndex = record.z_index
  if (decomposed && (typeof zIndex !== 'number' || !Number.isInteger(zIndex))) {
    throw new ImageError('image-ark: layer decomposition response carried a layer without a z_index', 'IMAGE_PROVIDER_FAILED')
  }
  const extent = typeof record.size === 'string' ? extentOf(record.size) : undefined
  if (decomposed && extent === undefined) {
    throw new ImageError('image-ark: layer decomposition response carried a layer without a usable size', 'IMAGE_PROVIDER_FAILED')
  }
  return {
    url: record.url,
    zIndex: typeof zIndex === 'number' ? zIndex : 0,
    layer: {
      mediaType: mediaTypeOf(record.output_format),
      width: extent?.width ?? 0,
      height: extent?.height ?? 0,
      ...boundingBoxOf(record.bounding_box),
      ...typeof record.name === 'string' && record.name !== '' ? { name: record.name } : {},
      ...typeof record.description === 'string' && record.description !== '' ? { description: record.description } : {},
    },
  }
}

/** Parse one `WIDTHxHEIGHT` extent, or fail when the pair is unusable. */
function extentOf(size: string): { width: number; height: number } | undefined {
  const pair = /^(\d+)x(\d+)$/.exec(size.trim())
  return pair === null ? undefined : { width: Number(pair[1]), height: Number(pair[2]) }
}

/** Parse the endpoint's absolute bounding box, or omit it when the shape deviates. */
function boundingBoxOf(value: unknown): Pick<ImageLayer, 'boundingBox'> {
  if (typeof value !== 'object' || value === null) return {}
  const absolute = (value as { absolute?: unknown }).absolute
  if (!Array.isArray(absolute) || absolute.length !== 4 || !absolute.every(item => typeof item === 'number')) {
    return {}
  }
  return { boundingBox: absolute as [number, number, number, number] }
}

/** Resolve the media type from the endpoint's `output_format`, falling back to PNG. */
function mediaTypeOf(outputFormat: unknown): string {
  return typeof outputFormat === 'string' ? FORMAT_MEDIA_TYPES[outputFormat] ?? 'image/png' : 'image/png'
}

/** Submit one generation and return the parsed JSON answer. */
async function submit(
  arkBaseURL: string,
  key: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{ data?: unknown }> {
  let response: Response
  try {
    response = await fetch(`${arkBaseURL}${ARK_IMAGES_GENERATIONS_PATH}`, {
      method: 'POST',
      signal,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new ImageError(`image-ark: generation request failed: ${String(error)}`, 'IMAGE_PROVIDER_FAILED', { cause: error })
  }
  if (!response.ok) {
    throw new ImageError(`image-ark: generation endpoint responded ${response.status}`, 'IMAGE_PROVIDER_FAILED')
  }
  try {
    return await response.json() as { data?: unknown }
  } catch (error) {
    throw new ImageError('image-ark: generation endpoint returned a non-JSON body', 'IMAGE_PROVIDER_FAILED', { cause: error })
  }
}

/** Download one answered image URL into its raw bytes and content-type media type. */
async function download(url: string, signal: AbortSignal): Promise<{ data: Uint8Array; mediaType?: string }> {
  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch (error) {
    throw new ImageError(`image-ark: image download failed: ${String(error)}`, 'IMAGE_PROVIDER_FAILED', { cause: error })
  }
  if (!response.ok) {
    throw new ImageError(`image-ark: image download responded ${response.status}`, 'IMAGE_PROVIDER_FAILED')
  }
  let bytes: ArrayBuffer
  try {
    bytes = await response.arrayBuffer()
  } catch (error) {
    throw new ImageError(`image-ark: image download body read failed: ${String(error)}`, 'IMAGE_PROVIDER_FAILED', { cause: error })
  }
  const header = response.headers.get('content-type')?.split(';', 1)[0]?.trim()
  return {
    data: new Uint8Array(bytes),
    ...header !== undefined && header.startsWith('image/') ? { mediaType: header } : {},
  }
}

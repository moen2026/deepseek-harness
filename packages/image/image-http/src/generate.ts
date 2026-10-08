/**
 * HTTP generation client for the image-http provider. It posts a JSON body to an
 * OpenAI-compatible `/images/generations` shape requesting base64 answers and maps the
 * JSON response onto the seam's image vocabulary. The credential is read from an
 * *environment variable name* (`authEnv`) at call time so the secret never enters
 * configuration files or logs; this module never logs the credential.
 * @module @deepseek-ai/dsh-image-http/generate
 */

import { ImageError } from '@deepseek-ai/dsh-image'
import type { ImageGenerateRequest, ImageResult } from '@deepseek-ai/dsh-image'

/** Deployment-supplied generation endpoint description. */
export interface HttpGenerationConfig {
  /** Full generation endpoint URL (an OpenAI-compatible `/images/generations` shape). */
  readonly url: string
  /** Model name sent to the endpoint. */
  readonly model: string
  /** Name of the environment variable holding the bearer token; never the token itself. */
  readonly authEnv: string
  /** Per-request timeout in milliseconds. Defaults to 120000. */
  readonly timeoutMs?: number
}

/** A generation function the provider registers on the seam and tests can fake. */
export type HttpGenerator = (
  request: ImageGenerateRequest,
  signal?: AbortSignal,
) => Promise<ImageResult>

const DEFAULT_TIMEOUT_MS = 120_000

/** Decode one base64 payload into raw bytes. */
function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

/**
 * Build an {@link HttpGenerator} over an OpenAI-compatible generation endpoint.
 * @param config - the endpoint description.
 * @returns a generator that posts the prompt and maps the JSON answer.
 */
export function createHttpGenerator(config: HttpGenerationConfig): HttpGenerator {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return async (request, signal) => {
    const key = process.env[config.authEnv]
    if (key === undefined || key.trim() === '') {
      throw new ImageError(
        `image-http: environment variable "${config.authEnv}" is not set`,
        'IMAGE_PROVIDER_FAILED',
      )
    }
    const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)]
    if (signal !== undefined) signals.push(signal)
    const composed = AbortSignal.any(signals)

    // Base64 answers keep image bytes out of URL fetches and are the only response
    // form the seam's byte-oriented result vocabulary can carry.
    const body: Record<string, unknown> = {
      model: config.model,
      prompt: request.prompt,
      response_format: 'b64_json',
    }
    if (request.size !== undefined && request.size.trim() !== '') body.size = request.size.trim()
    if (request.n !== undefined) body.n = request.n

    let response: Response
    try {
      response = await fetch(config.url, {
        method: 'POST',
        signal: composed,
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        // The credential is sent only as a header; it is never part of the request body or any log.
        body: JSON.stringify(body),
      })
    } catch (error) {
      throw new ImageError(`image-http: generation request failed: ${String(error)}`, 'IMAGE_PROVIDER_FAILED', { cause: error })
    }
    if (!response.ok) {
      throw new ImageError(`image-http: generation endpoint responded ${response.status}`, 'IMAGE_PROVIDER_FAILED')
    }
    let payload: { data?: unknown }
    try {
      payload = await response.json() as typeof payload
    } catch (error) {
      throw new ImageError('image-http: generation endpoint returned a non-JSON body', 'IMAGE_PROVIDER_FAILED', { cause: error })
    }
    const first: unknown = Array.isArray(payload.data) ? payload.data[0] : undefined
    const entry = (first ?? {}) as { b64_json?: unknown; revised_prompt?: unknown }
    if (typeof entry.b64_json !== 'string') {
      throw new ImageError('image-http: generation endpoint returned an unexpected shape', 'IMAGE_PROVIDER_FAILED')
    }
    return {
      data: decodeBase64(entry.b64_json),
      mediaType: 'image/png',
      ...typeof entry.revised_prompt === 'string' && entry.revised_prompt !== ''
        ? { revisedPrompt: entry.revised_prompt }
        : {},
    }
  }
}

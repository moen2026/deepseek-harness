/**
 * Failure and async plumbing shared by the video-volc generation and asset
 * clients. Both clients speak to Volcengine planes with call-time credentials,
 * so transport diagnostics are redacted the same way and every failure maps to
 * the typed video provider error.
 * @module @deepseek-ai/dsh-video-volc/internal
 */

import { VideoError } from '@deepseek-ai/dsh-video'

/**
 * Map one transport failure onto a typed provider error, naming an elapsed
 * overall timeout.
 */
export function toProviderFailure(error: unknown, timeoutSignal: AbortSignal, activity: string, ...credentials: string[]): VideoError {
  const detail = timeoutSignal.aborted ? 'timed out' : redact(String(error), ...credentials)
  return new VideoError(`video-volc: ${activity}: ${detail}`, 'VIDEO_PROVIDER_FAILED', { cause: error })
}

/** Replace the credential wherever a transport diagnostic embeds it, raw or URL-encoded. */
export function redact(text: string, ...credentials: string[]): string {
  let redacted = text
  for (const credential of credentials) {
    redacted = redacted.replaceAll(credential, '***').replaceAll(encodeURIComponent(credential), '***')
  }
  return redacted
}

/** Narrow one parsed JSON value to an object with unknown fields. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A human-readable rendering of an endpoint message field. */
export function describeMessage(value: unknown): string {
  return typeof value === 'string' && value !== '' ? value : 'unknown error'
}

/** Wait one poll interval, rejecting with the abort reason as soon as the signal aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
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

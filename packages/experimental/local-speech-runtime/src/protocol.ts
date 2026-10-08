/** Bounded transport between Host and one local speech worker process. */
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { Transcript } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { z } from 'zod'
import { SpeechInputError } from './speech-input.ts'

/**
 * Wait for a cancellable operation without losing ownership of its eventual settlement.
 * @param pending - the operation's own promise, whose settlement always wins.
 * @param signal - caller cancellation that rejects this view early.
 * @returns the eventual settlement of `pending`.
 */
export function waitFor<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = (): void => { reject(signal.reason instanceof Error ? signal.reason : new Error('Speech operation cancelled')) }
    signal.addEventListener('abort', abort, { once: true })
    void pending.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
  })
}

/**
 * Read one bounded worker readiness frame and reject exit before readiness.
 * @param handle - newly spawned worker with piped stdout.
 * @param limit - maximum readiness bytes.
 * @param signal - startup deadline or caller cancellation.
 * @returns dynamically allocated loopback port.
 */
export async function readReady(handle: SubprocessHandle, limit: number, signal: AbortSignal): Promise<number> {
  if (!handle.stdout) throw new Error('Speech worker stdout is unavailable')
  signal.throwIfAborted()
  const stdout = handle.stdout
  let text = ''
  const pending = Promise.withResolvers<number>()
  const data = (chunk: Buffer): void => {
    text += chunk.toString('utf8')
    if (Buffer.byteLength(text) > limit) { pending.reject(new Error('Speech worker readiness exceeded its byte limit')); return }
    const end = text.indexOf('\n')
    if (end < 0) return
    try {
      const value = z.object({ port: z.number().int().min(1).max(65535) }).strict().parse(JSON.parse(text.slice(0, end)))
      pending.resolve(value.port)
    } catch (error) { pending.reject(new Error('Invalid speech worker readiness', { cause: error })) }
  }
  stdout.on('data', data)
  stdout.on('error', pending.reject)
  void handle.done.then(() => {
    pending.reject(new Error(`Speech worker exited before readiness: ${handle.collected.stderr?.readFrom(0).text}`))
  }, pending.reject)
  try { return await waitFor(pending.promise, signal) }
  finally { stdout.off('data', data); stdout.off('error', pending.reject); stdout.resume() }
}

/**
 * Decode a bounded worker HTTP response; malformed worker output fails the request.
 * @param response - private authenticated worker response.
 * @param limit - maximum bytes retained before parsing.
 * @param schema - validated reply shape.
 * @returns validated worker reply; marked input rejections throw SpeechInputError.
 */
export async function readJsonReply<S extends z.ZodType>(response: Response, limit: number, schema: S): Promise<z.infer<S>> {
  if (!response.body) throw new Error('Speech worker returned no response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > limit) throw new Error('Speech worker reply exceeded its byte limit')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!response.ok) {
    const failure = z.object({ error: z.string(), code: z.literal('invalid-input').optional() }).parse(value)
    if ((response.status === 400 || response.status === 413) && failure.code === 'invalid-input') {
      throw new SpeechInputError(failure.error)
    }
    throw new Error(failure.error)
  }
  return schema.parse(value)
}

/**
 * Read one bounded binary worker response; malformed worker output fails the request.
 * @param response - private authenticated worker response.
 * @param limit - maximum bytes retained.
 * @returns the complete response body; marked input rejections throw SpeechInputError.
 */
export async function readBufferReply(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) throw new Error('Speech worker returned no response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > limit) throw new Error('Speech worker reply exceeded its byte limit')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  const body = Buffer.concat(chunks)
  if (!response.ok) {
    const failure = z.object({ error: z.string(), code: z.literal('invalid-input').optional() }).parse(JSON.parse(body.toString('utf8')))
    if ((response.status === 400 || response.status === 413) && failure.code === 'invalid-input') {
      throw new SpeechInputError(failure.error)
    }
    throw new Error(failure.error)
  }
  return body
}

const transcriptSchema = z.object({
  text: z.string(), audioSeconds: z.number().nonnegative(), inferenceSeconds: z.number().nonnegative(),
}).strict()

/**
 * Decode a bounded worker response into one recognized transcript.
 * @param response - private authenticated worker response.
 * @param limit - maximum bytes retained before JSON parsing.
 * @returns validated final transcript; marked input rejections throw SpeechInputError.
 */
export async function readTranscript(response: Response, limit: number): Promise<Transcript> {
  return await readJsonReply(response, limit, transcriptSchema)
}

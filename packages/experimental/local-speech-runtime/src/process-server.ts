/** Authenticated loopback transport for one serial native speech worker. */
import { createServer, type Server } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { SpeechInputError } from './speech-input.ts'

/** One authenticated bounded request received by a worker endpoint. */
export interface LoopbackRequest {
  /** Full request URL, resolved against the loopback origin. */
  readonly url: URL
  /** Complete request body, bounded by the configured byte limit. */
  readonly body: Buffer
}

/** One worker reply; object bodies serialize as JSON, buffers pass through with their content type. */
export interface LoopbackReply {
  readonly status: number
  readonly body: object | Buffer
  readonly contentType?: string
}

/**
 * Bind an ephemeral loopback listener with token authentication and bounded bodies.
 * @param token - private per-process authentication secret.
 * @param maxBodyBytes - maximum accepted request body bytes.
 * @param handler - synchronous endpoint owned by this process.
 * @param minBodyBytes - minimum accepted request body bytes; smaller requests fail with 413.
 * @returns the listening server and its dynamically assigned port.
 */
export async function startLoopbackServer(token: string, maxBodyBytes: number,
  handler: (request: LoopbackRequest) => LoopbackReply, minBodyBytes = 1): Promise<{ server: Server; port: number }> {
  const expected = Buffer.from(`Bearer ${token}`)
  const server = createServer((request, response) => {
    const reply = (status: number, value: object): void => {
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
    }
    const authorization = Buffer.from(request.headers.authorization ?? '')
    if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
      request.resume(); reply(401, { error: 'Unauthorized' }); return
    }
    const url = new URL(request.url as string, 'http://localhost')
    if (request.method !== 'POST') {
      request.resume(); reply(404, { error: 'Unknown endpoint' }); return
    }
    const length = Number(request.headers['content-length'])
    if (!Number.isSafeInteger(length) || length < minBodyBytes || length > maxBodyBytes) {
      request.resume(); reply(413, { error: 'Invalid request body size', code: 'invalid-input' }); return
    }
    void (async () => {
      try {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(chunk as Buffer)
        const result = handler({ url, body: Buffer.concat(chunks) })
        if (Buffer.isBuffer(result.body)) {
          response.writeHead(result.status, { 'content-type': result.contentType ?? 'application/octet-stream' })
          response.end(result.body); return
        }
        reply(result.status, result.body)
      } catch (error) {
        reply(error instanceof SpeechInputError ? 400 : 500, {
          error: error instanceof Error ? error.message : String(error),
          ...error instanceof SpeechInputError ? { code: 'invalid-input' } : {},
        })
      }
    })()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address() as { port: number }
  return { server, port: address.port }
}

/**
 * Bind an ephemeral loopback recognizer endpoint; model loading completes before readiness is published.
 * @param token - private per-process authentication secret.
 * @param maxAudioBytes - maximum retained request bytes.
 * @param transcribe - synchronous inference owned by this process.
 * @returns the listening server and its dynamically assigned port.
 */
export async function startRecognitionServer(token: string, maxAudioBytes: number,
  transcribe: (audio: Uint8Array, language: string) => object): Promise<{ server: Server; port: number }> {
  return await startLoopbackServer(token, maxAudioBytes, ({ url, body }) => {
    if (url.pathname !== '/transcribe') return { status: 404, body: { error: 'Unknown endpoint' } }
    return { status: 200, body: transcribe(body, url.searchParams.get('language') ?? 'auto') }
  }, 46)
}

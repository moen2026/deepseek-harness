/**
 * Slack callback HTTP handler: bounded raw-body intake, signature
 * verification over the untouched bytes, the URL-verification challenge
 * answer, event and interactive-payload translation, and delivery into
 * `ctx.connector`. The handler answers only after the message has a durable
 * webhook delivery (queued or duplicate), never after rule settlement; every
 * refusal carries no request data.
 * @module @deepseek-ai/dsh-connector-slack/handler
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { parseInteractivePayload, readRawBody, SlackCallbackError, verifySlackSignature } from './callback.ts'
import { translateSlackPayload } from './event.ts'

/** Handler values resolved once at plugin load. */
export interface SlackCallbackHandlerConfig {
  /** Credential reference containing the app signing secret. */
  readonly signingSecretRef: CredentialRef
  /** Positive raw body ceiling in bytes. */
  readonly maxBodyBytes: number
}

/** Whether Content-Type names one of the two media types Slack posts. */
function mediaTypeOf(value: string | undefined): 'json' | 'urlencoded' | undefined {
  if (value === undefined) return undefined
  const semicolon = value.indexOf(';')
  const media = (semicolon === -1 ? value : value.slice(0, semicolon)).trim().toLowerCase()
  if (media === 'application/json') return 'json'
  return media === 'application/x-www-form-urlencoded' ? 'urlencoded' : undefined
}

/** Require one unambiguous non-empty request header. */
function requiredHeader(request: IncomingMessage, name: string): string {
  const values = request.headersDistinct[name]
  const value = values?.[0]
  if (values?.length !== 1 || value === undefined || value.trim() === '') {
    throw new SlackCallbackError(400, `missing ${name} header`)
  }
  return value
}

/** Resolve the required signing secret, refusing while it is unavailable. */
async function resolveCredential(ctx: Context, ref: CredentialRef, label: string): Promise<string> {
  const credential = await ctx.credentials.resolve(ref)
  if (credential === undefined || credential.value === '') {
    throw new SlackCallbackError(503, `Slack ${label} is unavailable`)
  }
  return credential.value
}

/** Send one plain-text response exactly once. */
function respond(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(message)
}

/** Send one JSON response exactly once. */
function respondJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

/**
 * Create one exact-route Slack callback handler.
 * @param ctx - adapter context carrying credentials and the connector seam.
 * @param config - validated credential reference and body ceiling.
 * @returns an HTTP handler that answers after in-memory delivery admission.
 */
export function createSlackCallbackHandler(ctx: Context, config: SlackCallbackHandlerConfig): WebRoute['handler'] {
  return async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.setHeader('allow', 'POST')
        throw new SlackCallbackError(405, 'method not allowed')
      }
      const mediaType = mediaTypeOf(request.headers['content-type'])
      if (mediaType === undefined) {
        throw new SlackCallbackError(415, 'content type must be application/json or application/x-www-form-urlencoded')
      }
      const rawBody = await readRawBody(request, config.maxBodyBytes)
      const signingSecret = await resolveCredential(ctx, config.signingSecretRef, 'signing secret')
      const verification = verifySlackSignature({
        timestamp: requiredHeader(request, 'x-slack-request-timestamp'),
        signature: requiredHeader(request, 'x-slack-signature'),
      }, signingSecret, rawBody, Date.now())
      if (verification === 'stale') throw new SlackCallbackError(401, 'stale request timestamp')
      if (verification === 'invalid') throw new SlackCallbackError(401, 'invalid webhook signature')

      const payload = mediaType === 'json' ? parseJsonBody(rawBody) : parseInteractiveBody(rawBody)
      const translated = translateSlackPayload(payload)
      if (translated.kind === 'challenge') {
        respondJson(response, 200, { challenge: translated.challenge })
        return
      }
      if (translated.kind === 'message') {
        try {
          await ctx.connector.deliver(translated.message)
        } catch (error: unknown) {
          if (error instanceof TypeError) throw new SlackCallbackError(400, 'Slack message is not deliverable')
          throw new SlackCallbackError(503, 'connector delivery is unavailable')
        }
      }
      respondJson(response, 200, { ok: true })
    } catch (error: unknown) {
      if (error instanceof SlackCallbackError) {
        respond(response, error.status, error.message)
        return
      }
      ctx.logger.warn('connector-slack: request failed')
      respond(response, 503, 'connector-slack ingress is unavailable')
    }
  }
}

/** Parse the outer JSON object of one Events API callback body. */
function parseJsonBody(rawBody: Buffer): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody))
  } catch {
    // TextDecoder and JSON.parse are the only statements in the try; a body
    // that is not UTF-8 JSON is exactly this refusal.
    throw new SlackCallbackError(400, 'request body is not valid UTF-8 JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SlackCallbackError(400, 'Slack callback payload must be a JSON object')
  }
  return parsed
}

/** Decode one urlencoded interactive body as UTF-8 before form parsing. */
function parseInteractiveBody(rawBody: Buffer): unknown {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
  } catch {
    throw new SlackCallbackError(400, 'request body is not valid UTF-8')
  }
  return parseInteractivePayload(text)
}

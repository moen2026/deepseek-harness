/**
 * DingTalk callback HTTP handler: bounded UTF-8 intake, timestamped signature
 * verification, text translation, session-webhook registration, and delivery
 * into `ctx.connector`. The handler answers only after the message has a
 * durable webhook delivery (queued or duplicate), never after rule
 * settlement; every refusal carries no request data.
 * @module @deepseek-ai/dsh-connector-dingtalk/handler
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { DingtalkCallbackError, readUtf8Body, translateDingtalkCallback } from './callback.ts'
import type { DingtalkClient } from './client.ts'
import { verifyDingtalkCallback } from './verify.ts'

/** Handler values resolved once at plugin load. */
export interface DingtalkCallbackHandlerConfig {
  /** Credential reference containing the DingTalk app secret. */
  readonly appSecretRef: CredentialRef
  /** Positive raw body ceiling in bytes. */
  readonly maxBodyBytes: number
}

/** Whether Content-Type names JSON, ignoring parameters such as charset. */
function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false
  const semicolon = value.indexOf(';')
  const mediaType = semicolon === -1 ? value : value.slice(0, semicolon)
  return mediaType.trim().toLowerCase() === 'application/json'
}

/** Read one unambiguous non-empty request header, or nothing. */
function singleHeader(request: IncomingMessage, name: string): string | undefined {
  const values = request.headersDistinct[name]
  const value = values?.[0]
  if (values?.length !== 1 || value === undefined || value.trim() === '') return undefined
  return value
}

/** Resolve the required app secret, refusing while it is unavailable. */
async function resolveCredential(ctx: Context, ref: CredentialRef): Promise<string> {
  const credential = await ctx.credentials.resolve(ref)
  if (credential === undefined || credential.value === '') {
    throw new DingtalkCallbackError(503, 'DingTalk app secret is unavailable')
  }
  return credential.value
}

/** Send one empty acknowledgement exactly once. */
function respondEmpty(response: ServerResponse): void {
  response.writeHead(200)
  response.end()
}

/** Send one plain-text refusal exactly once. */
function respond(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(message)
}

/** Parse the outer JSON object of one callback body. */
function parsePayload(body: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    // JSON.parse is the only statement in the try; a body that is not JSON is
    // exactly this refusal.
    throw new DingtalkCallbackError(400, 'request body is not valid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DingtalkCallbackError(400, 'DingTalk callback payload must be a JSON object')
  }
  return parsed
}

/**
 * Create one exact-route DingTalk callback handler.
 * @param ctx - adapter context carrying credentials and the connector seam.
 * @param client - the outbound client that remembers session webhooks.
 * @param config - validated credential reference and body ceiling.
 * @returns an HTTP handler that answers after in-memory delivery admission.
 */
export function createDingtalkCallbackHandler(
  ctx: Context,
  client: DingtalkClient,
  config: DingtalkCallbackHandlerConfig,
): WebRoute['handler'] {
  return async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.setHeader('allow', 'POST')
        throw new DingtalkCallbackError(405, 'method not allowed')
      }
      if (!isJsonContentType(request.headers['content-type'])) {
        throw new DingtalkCallbackError(415, 'content type must be application/json')
      }
      const body = await readUtf8Body(request, config.maxBodyBytes)
      const appSecret = await resolveCredential(ctx, config.appSecretRef)
      const verification = verifyDingtalkCallback({
        timestamp: singleHeader(request, 'timestamp'),
        sign: singleHeader(request, 'sign'),
      }, appSecret, Date.now())
      if (verification === 'stale') throw new DingtalkCallbackError(401, 'stale request timestamp')
      if (verification === 'invalid') throw new DingtalkCallbackError(401, 'invalid webhook signature')

      const translated = translateDingtalkCallback(parsePayload(body))
      if (translated !== undefined) {
        client.remember(translated.message.channel, translated.sessionWebhook, translated.sessionWebhookExpiresAt)
        try {
          await ctx.connector.deliver(translated.message)
        } catch (error: unknown) {
          if (error instanceof TypeError) throw new DingtalkCallbackError(400, 'DingTalk message is not deliverable')
          throw new DingtalkCallbackError(503, 'connector delivery is unavailable')
        }
      }
      respondEmpty(response)
    } catch (error: unknown) {
      if (error instanceof DingtalkCallbackError) {
        respond(response, error.status, error.message)
        return
      }
      ctx.logger.warn('connector-dingtalk: request failed')
      respond(response, 503, 'connector-dingtalk ingress is unavailable')
    }
  }
}

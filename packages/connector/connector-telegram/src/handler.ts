/**
 * Telegram callback HTTP handler: bounded raw-body intake, webhook secret
 * token verification, update translation, callback-query acknowledgement,
 * and delivery into `ctx.connector`. The handler answers only after the
 * message has a durable webhook delivery (queued or duplicate), never after
 * rule settlement; every refusal carries no request data.
 * @module @deepseek-ai/dsh-connector-telegram/handler
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { readRawBody, secretTokenMatches, TelegramCallbackError } from './callback.ts'
import { fieldOf, translateTelegramUpdate } from './event.ts'
import type { TelegramClient } from './client.ts'

/** Handler values resolved once at plugin load. */
export interface TelegramCallbackHandlerConfig {
  /** Credential reference containing the bot token (also used for callback answers). */
  readonly botTokenRef: CredentialRef
  /** Credential reference containing the webhook secret token; absent accepts every caller. */
  readonly webhookSecretRef?: CredentialRef
  /** Positive raw body ceiling in bytes. */
  readonly maxBodyBytes: number
}

/** Require one unambiguous non-empty request header. */
function requiredHeader(request: IncomingMessage, name: string): string {
  const values = request.headersDistinct[name]
  const value = values?.[0]
  if (values?.length !== 1 || value === undefined || value.trim() === '') {
    throw new TelegramCallbackError(400, `missing ${name} header`)
  }
  return value
}

/** Resolve one required credential, refusing while it is unavailable. */
async function resolveCredential(ctx: Context, ref: CredentialRef, label: string): Promise<string> {
  const credential = await ctx.credentials.resolve(ref)
  if (credential === undefined || credential.value === '') {
    throw new TelegramCallbackError(503, `Telegram ${label} is unavailable`)
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

/** Parse the outer JSON object of one update body. */
function parseUpdate(rawBody: Buffer): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody))
  } catch {
    // TextDecoder and JSON.parse are the only statements in the try; a body
    // that is not UTF-8 JSON is exactly this refusal.
    throw new TelegramCallbackError(400, 'request body is not valid UTF-8 JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TelegramCallbackError(400, 'Telegram update must be a JSON object')
  }
  return parsed
}

/**
 * Create one exact-route Telegram callback handler.
 * @param ctx - adapter context carrying credentials and the connector seam.
 * @param client - the outbound client that answers callback queries.
 * @param config - validated credential references and body ceiling.
 * @returns an HTTP handler that answers after in-memory delivery admission.
 */
export function createTelegramCallbackHandler(
  ctx: Context,
  client: TelegramClient,
  config: TelegramCallbackHandlerConfig,
): WebRoute['handler'] {
  return async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.setHeader('allow', 'POST')
        throw new TelegramCallbackError(405, 'method not allowed')
      }
      if (request.headers['content-type'] === undefined
        || !request.headers['content-type'].startsWith('application/json')) {
        throw new TelegramCallbackError(415, 'content type must be application/json')
      }
      const rawBody = await readRawBody(request, config.maxBodyBytes)
      if (config.webhookSecretRef !== undefined) {
        const secretToken = await resolveCredential(ctx, config.webhookSecretRef, 'webhook secret token')
        if (!secretTokenMatches(requiredHeader(request, 'x-telegram-bot-api-secret-token'), secretToken)) {
          throw new TelegramCallbackError(401, 'invalid webhook secret token')
        }
      }

      const payload = parseUpdate(rawBody)
      const translated = translateTelegramUpdate(payload)
      if (translated.kind === 'message') {
        const callbackQueryId = fieldOf(fieldOf(payload, 'callback_query'), 'id')
        if (typeof callbackQueryId === 'string' && callbackQueryId !== '') {
          // The client's spinner must stop whether or not the seam accepts
          // the click, so the acknowledgement is best-effort and its failure
          // is logged, never fatal.
          try {
            await client.answerCallbackQuery(callbackQueryId)
          } catch (error: unknown) {
            ctx.logger.warn('connector-telegram: callback query acknowledgement failed', error)
          }
        }
        try {
          await ctx.connector.deliver(translated.message)
        } catch (error: unknown) {
          if (error instanceof TypeError) throw new TelegramCallbackError(400, 'Telegram update is not deliverable')
          throw new TelegramCallbackError(503, 'connector delivery is unavailable')
        }
      }
      respondEmpty(response)
    } catch (error: unknown) {
      if (error instanceof TelegramCallbackError) {
        respond(response, error.status, error.message)
        return
      }
      ctx.logger.warn('connector-telegram: request failed')
      respond(response, 503, 'connector-telegram ingress is unavailable')
    }
  }
}

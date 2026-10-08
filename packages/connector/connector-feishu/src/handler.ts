/**
 * Feishu callback HTTP handler: bounded raw-body intake, signature and token
 * verification, the URL-verification challenge answer, event translation, and
 * delivery into `ctx.connector`. The handler answers only after the message
 * has a durable webhook delivery (queued or duplicate), never after rule
 * settlement; every refusal carries no request data.
 * @module @deepseek-ai/dsh-connector-feishu/handler
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  FeishuCallbackError,
  decryptFeishuEnvelope,
  readRawBody,
  tokenMatches,
  verifyFeishuSignature,
} from './callback.ts'
import { fieldOf, tokenOf, translateFeishuCallback } from './event.ts'

/** Handler values resolved once at plugin load. */
export interface FeishuCallbackHandlerConfig {
  /** Credential reference containing the event verification token. */
  readonly verificationTokenRef: CredentialRef
  /** Credential reference containing the event encrypt key; absent for plaintext callbacks. */
  readonly encryptKeyRef?: CredentialRef
  /** Positive raw body ceiling in bytes. */
  readonly maxBodyBytes: number
}

/** Whether Content-Type names JSON, ignoring parameters such as charset. */
function isJsonContentType(value: string | undefined): boolean {
  return value !== undefined && value.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

/** Require one unambiguous non-empty request header. */
function requiredHeader(request: IncomingMessage, name: string): string {
  const values = request.headersDistinct[name]
  const value = values?.[0]
  if (values?.length !== 1 || value === undefined || value.trim() === '') {
    throw new FeishuCallbackError(400, `missing ${name} header`)
  }
  return value
}

/** Resolve one required credential, refusing while it is unavailable. */
async function resolveCredential(ctx: Context, ref: CredentialRef, label: string): Promise<string> {
  const credential = await ctx.credentials.resolve(ref)
  if (credential === undefined || credential.value === '') {
    throw new FeishuCallbackError(503, `Feishu ${label} is unavailable`)
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

/** Parse the outer JSON envelope of one callback body. */
function parseEnvelope(rawBody: Buffer): unknown {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
  } catch {
    throw new FeishuCallbackError(400, 'request body is not valid UTF-8')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new FeishuCallbackError(400, 'request body is not valid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new FeishuCallbackError(400, 'Feishu callback payload must be a JSON object')
  }
  return parsed
}

/** Verify and open an encrypted envelope; plaintext payloads pass through. */
async function openEnvelope(
  ctx: Context,
  config: FeishuCallbackHandlerConfig,
  request: IncomingMessage,
  rawBody: Buffer,
  envelope: unknown,
): Promise<unknown> {
  const encrypt = fieldOf(envelope, 'encrypt')
  if (typeof encrypt !== 'string') return envelope
  if (config.encryptKeyRef === undefined) {
    throw new FeishuCallbackError(503, 'Feishu callback is encrypted but no encrypt key is configured')
  }
  const encryptKey = await resolveCredential(ctx, config.encryptKeyRef, 'encrypt key')
  const verified = verifyFeishuSignature({
    timestamp: requiredHeader(request, 'x-lark-request-timestamp'),
    nonce: requiredHeader(request, 'x-lark-request-nonce'),
    signature: requiredHeader(request, 'x-lark-signature'),
  }, encryptKey, rawBody)
  if (!verified) throw new FeishuCallbackError(401, 'invalid webhook signature')
  return decryptFeishuEnvelope(encrypt, encryptKey)
}

/**
 * Create one exact-route Feishu callback handler.
 * @param ctx - adapter context carrying credentials and the connector seam.
 * @param config - validated credential references and body ceiling.
 * @returns an HTTP handler that answers after in-memory delivery admission.
 */
export function createFeishuCallbackHandler(ctx: Context, config: FeishuCallbackHandlerConfig): WebRoute['handler'] {
  return async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.setHeader('allow', 'POST')
        throw new FeishuCallbackError(405, 'method not allowed')
      }
      if (!isJsonContentType(request.headers['content-type'])) {
        throw new FeishuCallbackError(415, 'content type must be application/json')
      }
      const rawBody = await readRawBody(request, config.maxBodyBytes)
      const payload = await openEnvelope(ctx, config, request, rawBody, parseEnvelope(rawBody))
      const token = tokenOf(payload)
      const verificationToken = await resolveCredential(ctx, config.verificationTokenRef, 'verification token')
      if (token === undefined || !tokenMatches(token, verificationToken)) {
        throw new FeishuCallbackError(401, 'invalid verification token')
      }

      const translated = translateFeishuCallback(payload)
      if (translated.kind === 'challenge') {
        respondJson(response, 200, { challenge: translated.challenge })
        return
      }
      if (translated.kind === 'message') {
        try {
          await ctx.connector.deliver(translated.message)
        } catch (error: unknown) {
          if (error instanceof TypeError) throw new FeishuCallbackError(400, 'Feishu message is not deliverable')
          throw new FeishuCallbackError(503, 'connector delivery is unavailable')
        }
      }
      respondJson(response, 200, { code: 0 })
    } catch (error: unknown) {
      if (error instanceof FeishuCallbackError) {
        respond(response, error.status, error.message)
        return
      }
      ctx.logger.warn('connector-feishu: request failed')
      respond(response, 503, 'connector-feishu ingress is unavailable')
    }
  }
}

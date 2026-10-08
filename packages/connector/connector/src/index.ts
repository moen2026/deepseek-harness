/**
 * Service Definition for the connector capability seam (`ctx.connector`): a
 * multi-provider registry, one inbound route turning verified platform
 * messages into durable webhook deliveries, one outbound route pushing
 * messages through the addressed provider, and the channel-to-Session
 * binding table both routes share.
 *
 * A provider reserves one platform id: {@link Connector.registerProvider}
 * validates and conflict-checks before mutating, so an invalid or duplicate
 * registration publishes nothing, and its disposer releases the reservation.
 * The inbound rule registered by {@link Connector.inbound} derives one
 * deterministic Session id per channel, appends every message of that
 * channel to the same Session — resuming it when this process no longer
 * holds it live — and creates it only when no Session exists to resume. The
 * creating path delegates to the webhook Session request, so workspace,
 * preset, permission, and rollback behavior stay the webhook runtime's; this
 * seam adds no second Session-creation implementation.
 *
 * The binding table is process-local by design: outbound pushes are raised
 * by events of live Sessions, and a channel always re-binds — to the same
 * derived id — before its Session can raise one, so persistence would record
 * only restart-recoverable duplicates of a derived fact.
 * @module @deepseek-ai/dsh-connector
 */

import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { Buffer } from 'node:buffer'
import { Context, Service } from '@deepseek-ai/cordis'
import { admitEncodedFile, admitEncodedImages } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { brandString } from '@deepseek-ai/dsh-brand'
import { errorChain, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  webhookDeliveryMessage,
  WebhookDeliveryId,
  WebhookRuleId,
  WebhookSourceId,
} from '@deepseek-ai/dsh-webhook'
import type { VerifiedWebhookDelivery, WebhookSessionRequest } from '@deepseek-ai/dsh-webhook'
import type { AdmittedAttachmentBlock } from '@deepseek-ai/dsh-webhook'
import type {} from '@deepseek-ai/dsh-webhook-outbox'
import { ConnectorChannelId, ConnectorMessageId } from './brand.ts'
import { ConnectorError } from './types.ts'
import type {
  ConnectorChannel,
  ConnectorInboundAttachment,
  ConnectorInboundMessage,
  ConnectorInboundOptions,
  ConnectorOutboundMessage,
  ConnectorProvider,
  ConnectorResolution,
  ConnectorResolutionHandler,
  ConnectorService,
} from './types.ts'

export * from './brand.ts'
export {
  ConnectorError,
} from './types.ts'
export type {
  ConnectorChannel,
  ConnectorErrorCode,
  ConnectorInboundAttachment,
  ConnectorInboundMessage,
  ConnectorInboundOptions,
  ConnectorOutboundAction,
  ConnectorOutboundMessage,
  ConnectorProvider,
  ConnectorResolution,
  ConnectorResolutionHandler,
  ConnectorService,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    connector: ConnectorService
  }
}

/** Process-local key of one channel address. */
function channelKey(channel: ConnectorChannel): string {
  return `${channel.provider}\u0000${channel.channel}`
}

/**
 * Derive the one Session id a channel addresses. Deterministic so a message
 * arriving after a restart resumes the same Session instead of creating a
 * second one, and derived from the provider too, so two platforms' equal
 * channel strings never collide.
 * @param channel - the channel to derive the Session identity for.
 * @returns the derived, branded Session id.
 */
function sessionIdOf(channel: ConnectorChannel): SessionId {
  const digest = createHash('sha256')
    .update(`${channel.provider}\u0000${channel.channel}`)
    .digest('hex')
  return brandString<SessionId>(`connector-${digest.slice(0, 24)}`)
}

/**
 * Validate one wire attachments value and return its typed form. Shared by
 * `deliver()` (the provider translation boundary) and `inboundMessageOf()`
 * (durable event replay), so both boundaries reject the same malformed input
 * before any durable record or storage admission runs.
 * @param value - the untyped attachments value.
 * @param subject - diagnostic noun for failure messages.
 * @returns the typed attachments in input order.
 * @throws TypeError when the value is not an array of well-formed attachments.
 */
function inboundAttachmentsOf(value: unknown, subject: string): readonly ConnectorInboundAttachment[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`connector inbound ${subject} must be an array when present`)
  }
  return value.map((entry): ConnectorInboundAttachment => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError(`connector inbound ${subject} entries must be JSON objects`)
    }
    const record = entry as Record<string, unknown>
    const kind = record['type']
    if (kind !== 'image' && kind !== 'file') {
      throw new TypeError(`connector inbound ${subject} entry type must be 'image' or 'file'`)
    }
    const data = record['data']
    if (typeof data !== 'string'
      || (kind === 'image' && data.length === 0)
      || Buffer.from(data, 'base64').toString('base64') !== data) {
      throw new TypeError(
        `connector inbound ${subject} entry data must be canonical base64${
          kind === 'image' ? ' of at least one byte' : ''
        }`,
      )
    }
    const name = record['name']
    if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
      throw new TypeError(`connector inbound ${subject} entry name must be a non-empty string when present`)
    }
    if (kind === 'file') {
      return { type: 'file', data, ...(name === undefined ? {} : { name }) }
    }
    const mediaType = record['mediaType']
    if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp' && mediaType !== 'image/gif') {
      throw new TypeError(`connector inbound ${subject} entry mediaType must be one of the accepted raster image types`)
    }
    return { type: 'image', mediaType, data, ...(name === undefined ? {} : { name }) }
  })
}

/**
 * Extract the fields an inbound rule consumes from one delivery's event
 * payload. The payload crossed the provider's translation boundary, so every
 * field is validated here rather than trusted.
 * @param delivery - the verified delivery dispatched to the inbound rule.
 * @returns the channel and message text the payload carries.
 * @throws TypeError when the payload is not an object of non-empty strings.
 */
function inboundMessageOf(delivery: Readonly<VerifiedWebhookDelivery>): {
  readonly channel: ConnectorChannelId
  readonly messageId: ConnectorMessageId
  readonly sender: string
  readonly text: string
  readonly attachments?: readonly ConnectorInboundAttachment[]
  readonly resolution?: ConnectorResolution
} {
  const event = delivery.event
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('connector delivery event must be a JSON object')
  }
  const required = (name: string): string => {
    const candidate = event[name]
    if (typeof candidate !== 'string' || candidate.trim() === '') {
      throw new TypeError(`connector delivery event ${name} must be a non-empty string`)
    }
    return candidate
  }
  const channel = required('channel')
  const messageId = required('messageId')
  const sender = required('sender')
  const rawResolution = event.resolution
  if (rawResolution === undefined) {
    return {
      channel: ConnectorChannelId(channel),
      messageId: ConnectorMessageId(messageId),
      sender,
      text: required('text'),
      ...(event['attachments'] === undefined
        ? {}
        : { attachments: inboundAttachmentsOf(event['attachments'], 'event attachments') }),
    }
  }
  if (event['attachments'] !== undefined) {
    throw new TypeError('connector delivery event resolution must not carry attachments')
  }
  if (rawResolution === null || typeof rawResolution !== 'object' || Array.isArray(rawResolution)) {
    throw new TypeError('connector delivery event resolution must be a JSON object when present')
  }
  const resolution = rawResolution as Record<string, unknown>
  const actionId = resolution.actionId
  if (typeof actionId !== 'string' || actionId.trim() === '') {
    throw new TypeError('connector delivery event resolution.actionId must be a non-empty string')
  }
  const value = resolution.value
  if (typeof value !== 'string') {
    throw new TypeError('connector delivery event resolution.value must be a string')
  }
  return {
    channel: ConnectorChannelId(channel),
    messageId: ConnectorMessageId(messageId),
    sender,
    // An interactive resolution never re-enters the Session as chat text, so
    // its (often absent) text is not constrained.
    text: typeof event.text === 'string' ? event.text : '',
    resolution: { actionId, value },
  }
}

/**
 * `ctx.connector`. Holds the platform reservations, inbound rules, and
 * process-local bindings; each contribution is released when its
 * contributing fiber unloads.
 */
export class Connector extends Service implements ConnectorService {
  static inject = ['webhookRuntime', 'webhookOutbox', 'agents', 'agentPresets', 'sessionPersistence']

  private readonly providers = new Map<string, ConnectorProvider>()
  private readonly resolutionHandlers = new Map<string, ConnectorResolutionHandler>()
  // The value is a fresh token per registration, not the rule id: a
  // replacement rule for the same provider derives the same id, so only
  // object identity can tell two registrations apart.
  private readonly inboundRules = new Map<string, object>()
  private readonly sessionsByChannel = new Map<string, SessionId>()
  private readonly channelsBySession = new Map<SessionId, ConnectorChannel>()

  constructor(ctx: Context) {
    super(ctx, 'connector')
  }

  registerProvider(provider: ConnectorProvider): () => void {
    // Validate and conflict-check BEFORE any mutation: an invalid or duplicate
    // registration must publish nothing (fail-loud, all-or-nothing).
    if (typeof provider.id !== 'string' || provider.id.trim() === '') {
      throw new ConnectorError('a connector provider id must be a non-empty string', 'CONNECTOR_INVALID_PROVIDER')
    }
    if (typeof provider.push !== 'function') {
      throw new ConnectorError(`connector provider "${provider.id}" requires push()`, 'CONNECTOR_INVALID_PROVIDER')
    }
    if (this.providers.has(provider.id)) {
      throw new ConnectorError(
        `connector provider "${provider.id}" is already registered`,
        'CONNECTOR_CONFLICT',
      )
    }

    const dispose = this.ctx.effect(function* (this: Connector) {
      this.providers.set(provider.id, provider)
      yield () => {
        this.providers.delete(provider.id)
      }
    }.bind(this), `connector.registerProvider(${provider.id})`)
    // ctx.effect's disposer returns Promise<void>; our disposer API is synchronous
    // fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  async deliver(message: ConnectorInboundMessage): Promise<'queued' | 'duplicate'> {
    // The message crossed the provider's translation boundary: validate every
    // field before a durable record exists for it.
    if (typeof message.channel !== 'string' || message.channel.trim() === '') {
      throw new TypeError('connector inbound channel must be a non-empty string')
    }
    if (typeof message.messageId !== 'string' || message.messageId.trim() === '') {
      throw new TypeError('connector inbound messageId must be a non-empty string')
    }
    if (typeof message.sender !== 'string' || message.sender.trim() === '') {
      throw new TypeError('connector inbound sender must be a non-empty string')
    }
    if (typeof message.text !== 'string'
      || (message.resolution === undefined && message.text.trim() === '')) {
      throw new TypeError('connector inbound text must be a non-empty string')
    }
    // A decision never re-enters the Session as prompt material, so it must
    // not carry attachments; a prompt message validates every attachment
    // before its durable record exists.
    if (message.resolution !== undefined && message.attachments !== undefined && message.attachments.length > 0) {
      throw new TypeError('connector inbound resolution message must not carry attachments')
    }
    const attachments = message.attachments === undefined
      ? undefined
      : inboundAttachmentsOf(message.attachments, 'attachments')
    if (message.resolution !== undefined) {
      const { actionId, value } = message.resolution
      if (typeof actionId !== 'string' || actionId.trim() === '') {
        throw new TypeError('connector inbound resolution.actionId must be a non-empty string')
      }
      if (typeof value !== 'string') {
        throw new TypeError('connector inbound resolution.value must be a string')
      }
    }
    if (!this.providers.has(message.provider)) {
      throw new ConnectorError(
        `connector provider "${message.provider}" is not registered`,
        'CONNECTOR_UNKNOWN_PROVIDER',
      )
    }
    if (!this.inboundRules.has(message.provider)) {
      throw new ConnectorError(
        `connector provider "${message.provider}" has no inbound rule`,
        'CONNECTOR_INBOUND_UNAVAILABLE',
      )
    }
    const event = {
      channel: message.channel,
      messageId: message.messageId,
      sender: message.sender,
      text: message.text,
      ...(attachments === undefined ? {} : { attachments: [...attachments] }),
      ...(message.resolution === undefined
        ? {}
        : { resolution: { actionId: message.resolution.actionId, value: message.resolution.value } }),
    }
    const delivery: VerifiedWebhookDelivery = {
      kind: message.provider,
      source: WebhookSourceId(message.provider),
      deliveryId: WebhookDeliveryId(message.messageId),
      event,
      receivedAt: Date.now(),
    }
    return await this.ctx.webhookOutbox.deliver(delivery)
  }

  async push(channel: ConnectorChannel, message: ConnectorOutboundMessage, signal?: AbortSignal): Promise<void> {
    const provider = this.providers.get(channel.provider)
    if (provider === undefined) {
      throw new ConnectorError(
        `connector provider "${channel.provider}" is not registered`,
        'CONNECTOR_UNKNOWN_PROVIDER',
      )
    }
    await provider.push(channel.channel, message, signal)
  }

  inbound(options: ConnectorInboundOptions): () => Promise<void> {
    // Deployment configuration is validated before anything is registered: a
    // misconfigured rule must fail at the caller, not on the first message.
    if (typeof options.provider !== 'string' || options.provider.trim() === '') {
      throw new TypeError('connector inbound provider must be a non-empty string')
    }
    if (typeof options.workspacePath !== 'string' || !isAbsolute(options.workspacePath)) {
      throw new TypeError('connector inbound workspacePath must be an absolute path')
    }
    if (typeof options.agentPreset !== 'string' || options.agentPreset.trim() === '') {
      throw new TypeError('connector inbound agentPreset must be a non-empty string')
    }
    if (typeof options.permissionPreset !== 'string' || options.permissionPreset.trim() === '') {
      throw new TypeError('connector inbound permissionPreset must be a non-empty string')
    }
    if (options.title !== undefined && (typeof options.title !== 'string' || options.title.trim() === '')) {
      throw new TypeError('connector inbound title must be a non-empty string when present')
    }
    if (this.inboundRules.has(options.provider)) {
      throw new ConnectorError(
        `connector provider "${options.provider}" already has an inbound rule`,
        'CONNECTOR_CONFLICT',
      )
    }

    const ruleId = WebhookRuleId(`connector-inbound:${options.provider}`)
    const disposeRule = this.ctx.webhookRuntime.register({
      id: ruleId,
      kind: options.provider,
      run: (delivery, signal) => this.runInbound(options, ruleId, delivery, signal),
    })
    const token = {}
    this.inboundRules.set(options.provider, token)
    return async () => {
      await disposeRule()
      // Only this registration is forgotten: a later rule for the same
      // provider (registered after this one was released) stays.
      if (this.inboundRules.get(options.provider) === token) this.inboundRules.delete(options.provider)
    }
  }

  /**
   * Register the interactive-callback consumer for one provider.
   * Validate and conflict-check before mutating; the disposer removes only
   * this registration.
   */
  resolutions(provider: string, handler: ConnectorResolutionHandler): () => void {
    if (typeof provider !== 'string' || provider.trim() === '') {
      throw new ConnectorError('a connector resolution provider must be a non-empty string', 'CONNECTOR_INVALID_PROVIDER')
    }
    if (typeof handler !== 'function') {
      throw new ConnectorError(`connector resolutions("${provider}") requires a handler function`, 'CONNECTOR_INVALID_PROVIDER')
    }
    if (!this.providers.has(provider)) {
      throw new ConnectorError(`connector provider "${provider}" is not registered`, 'CONNECTOR_UNKNOWN_PROVIDER')
    }
    if (this.resolutionHandlers.has(provider)) {
      throw new ConnectorError(
        `connector provider "${provider}" already has a resolution handler`,
        'CONNECTOR_CONFLICT',
      )
    }
    const dispose = this.ctx.effect(function* (this: Connector) {
      this.resolutionHandlers.set(provider, handler)
      yield () => {
        if (this.resolutionHandlers.get(provider) === handler) this.resolutionHandlers.delete(provider)
      }
    }.bind(this), `connector.resolutions(${provider})`)
    return () => void dispose()
  }

  bind(channel: ConnectorChannel, sessionId: SessionId): void {
    const key = channelKey(channel)
    const previousSession = this.sessionsByChannel.get(key)
    if (previousSession !== undefined && previousSession !== sessionId) {
      this.channelsBySession.delete(previousSession)
    }
    const previousChannel = this.channelsBySession.get(sessionId)
    if (previousChannel !== undefined && channelKey(previousChannel) !== key) {
      this.sessionsByChannel.delete(channelKey(previousChannel))
    }
    this.sessionsByChannel.set(key, sessionId)
    this.channelsBySession.set(sessionId, channel)
  }

  unbind(channel: ConnectorChannel): void {
    const key = channelKey(channel)
    const sessionId = this.sessionsByChannel.get(key)
    if (sessionId === undefined) return
    this.sessionsByChannel.delete(key)
    // bind maintains one invariant: whoever is recorded as the session's
    // channel has exactly this key, so one delete releases both sides.
    this.channelsBySession.delete(sessionId)
  }

  sessionOf(channel: ConnectorChannel): SessionId | undefined {
    return this.sessionsByChannel.get(channelKey(channel))
  }

  channelOf(sessionId: SessionId): ConnectorChannel | undefined {
    return this.channelsBySession.get(sessionId)
  }

  /**
   * Admit one inbound message's attachments through the attachment
   * capability: image parts commit as normalized durable references, file
   * parts commit verbatim. A message without attachments performs no storage
   * operation. Failure fails the delivery, so the platform retries rather
   * than the attachment being dropped silently.
   * @param message - the parsed inbound message.
   * @returns the admitted reference blocks in attachment order.
   */
  private async admitAttachments(message: Pick<ConnectorInboundMessage, 'text' | 'attachments'>): Promise<readonly AdmittedAttachmentBlock[]> {
    const attachments = message.attachments
    if (attachments === undefined || attachments.length === 0) return []
    const store = this.ctx.get('attachments')
    if (store === undefined) {
      throw new ConnectorError(
        'connector inbound attachments require an attachment capability (ctx.attachments)',
        'CONNECTOR_ATTACHMENTS_UNAVAILABLE',
      )
    }
    const imageRefs = await admitEncodedImages(
      store,
      attachments.filter(
        (attachment): attachment is Extract<ConnectorInboundAttachment, { type: 'image' }> => attachment.type === 'image',
      ),
    )
    let next = 0
    const blocks: AdmittedAttachmentBlock[] = []
    for (const attachment of attachments) {
      if (attachment.type === 'image') {
        blocks.push({ type: 'image', attachment: imageRefs[next++] as ImageAttachmentRef })
        continue
      }
      blocks.push({
        type: 'file',
        attachment: await admitEncodedFile(store, {
          data: attachment.data,
          ...(attachment.name === undefined ? {} : { name: attachment.name }),
        }),
      })
    }
    return blocks
  }

  /**
   * Run one provider message: continue the channel's Session — live,
   * resumed, or created — and append the message to it.
   * @param options - the inbound rule's deployment choices.
   * @param ruleId - the rule identity recorded in the admitted message source.
   * @param delivery - the verified delivery dispatched to this rule.
   * @param signal - aborts when the registration or the runtime unloads.
   * @returns `null` after a continuation, or the creation request for a
   * channel whose Session does not exist yet.
   */
  private async runInbound(
    options: ConnectorInboundOptions,
    ruleId: WebhookRuleId,
    delivery: Readonly<VerifiedWebhookDelivery>,
    signal: AbortSignal,
  ): Promise<WebhookSessionRequest | null> {
    const message = inboundMessageOf(delivery)
    // An interactive resolution never re-enters the Session as chat text: it
    // is handed to the provider's resolution consumer, and a missing consumer
    // fails the delivery so the platform retries rather than the decision
    // being dropped silently.
    if (message.resolution !== undefined) {
      const handler = this.resolutionHandlers.get(options.provider)
      if (handler === undefined) {
        throw new ConnectorError(
          `connector provider "${options.provider}" has no resolution handler`,
          'CONNECTOR_INBOUND_UNAVAILABLE',
        )
      }
      await handler({
        provider: options.provider,
        channel: message.channel,
        messageId: message.messageId,
        sender: message.sender,
        text: message.text,
        resolution: message.resolution,
      })
      return null
    }
    const channel: ConnectorChannel = { provider: options.provider, channel: message.channel }
    const sessionId = sessionIdOf(channel)
    // Bind before any Session exists: the binding is the intent the outbound
    // route reads, and a failed creation stays self-healing because every
    // later message derives the same id and resumes or recreates it.
    this.bind(channel, sessionId)

    const attachments = await this.admitAttachments(message)
    const content: ContentBlock[] = [{ type: 'text', text: message.text }, ...attachments]

    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) {
      live.followup(webhookDeliveryMessage(delivery, ruleId, content))
      return null
    }

    try {
      const preset = await this.ctx.agentPresets.resolve(options.agentPreset)
      await using presetScope = await this.ctx.agentPresets.acquireScope(preset.id)
      void presetScope
      signal.throwIfAborted()
      const handle = await this.ctx.agents.resume({
        resumeSessionId: sessionId,
        signal,
        setup: async (agentCtx) => {
          await this.ctx.agentPresets.mount(agentCtx, preset.id)
        },
      })
      handle.agent.followup(webhookDeliveryMessage(delivery, ruleId, content))
      return null
    } catch (error: unknown) {
      // Cancellation is not a missing Session: an unload must not create one.
      signal.throwIfAborted()
      this.ctx.logger.debug(
        `connector: session "${sessionId}" could not be resumed; creating it: ${errorChain(error)}`,
      )
    }

    return {
      workspacePath: options.workspacePath,
      title: options.title ?? `Connector ${options.provider}`,
      prompt: message.text,
      ...(attachments.length === 0 ? {} : { attachments }),
      agentPreset: options.agentPreset,
      permissionPreset: options.permissionPreset,
      sessionId,
      ...options.model === undefined ? {} : { model: options.model },
    }
  }
}

export default Connector

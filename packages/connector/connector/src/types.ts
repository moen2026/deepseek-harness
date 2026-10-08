/**
 * Vocabulary for the connector capability seam (`ctx.connector`): the channel
 * address of one IM platform conversation, the inbound message a provider
 * translates from a verified callback, the outbound message the seam routes
 * back, the provider contract, and the `ConnectorService` surface consumers
 * call.
 * @module @deepseek-ai/dsh-connector/types
 */

import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WebhookModelSelection } from '@deepseek-ai/dsh-webhook'
import type { ConnectorChannelId, ConnectorMessageId } from './brand.ts'

/**
 * Stable, machine-routable codes for connector failures, carried on
 * {@link ConnectorError} so callers branch on `code` instead of parsing `message`.
 */
export type ConnectorErrorCode =
  | 'CONNECTOR_INVALID_PROVIDER'
  | 'CONNECTOR_CONFLICT'
  | 'CONNECTOR_UNKNOWN_PROVIDER'
  | 'CONNECTOR_INBOUND_UNAVAILABLE'
  | 'CONNECTOR_ATTACHMENTS_UNAVAILABLE'

/**
 * Structured connector failure. Extends {@link HarnessError} with one
 * {@link ConnectorErrorCode}.
 */
export class ConnectorError extends HarnessError {
  override readonly code: ConnectorErrorCode

  /**
   * @param message - human-readable failure detail.
   * @param code - the stable machine-routable failure code.
   * @param options - optional error cause chain.
   */
  constructor(message: string, code: ConnectorErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/** The address of one IM platform conversation: a provider id plus its channel. */
export interface ConnectorChannel {
  /** Registered provider that owns the platform, such as `feishu`. */
  readonly provider: string
  /** Provider-platform channel identifier (chat, room, or direct message). */
  readonly channel: ConnectorChannelId
}

/**
 * One base64-encoded attachment a provider downloaded from the platform and
 * forwards on an inbound message. The seam admits both forms through the
 * attachment capability before any Session sees them, so the Session only
 * ever receives durable references.
 */
export type ConnectorInboundAttachment =
  | {
    /** Discriminant; the image form maps onto the image admission vocabulary. */
    readonly type: 'image'
    /** Declared media type, verified against the decoded bytes during admission. */
    readonly mediaType: ImageMediaType
    /** Canonical base64 encoding of the image bytes. */
    readonly data: string
    /** Optional platform display name. */
    readonly name?: string
  }
  | {
    /** Discriminant; the file form commits verbatim through `saveFile`. */
    readonly type: 'file'
    /** Canonical base64 encoding of the exact file bytes. */
    readonly data: string
    /** Optional platform display name; it is never interpreted as a path. */
    readonly name?: string
  }

/**
 * One authenticated platform message a provider translated from a verified
 * callback. The seam turns it into a durable webhook delivery, so these
 * fields are the contract between adapter translation and rule consumption.
 */
export interface ConnectorInboundMessage {
  /** Registered provider that verified the callback. */
  readonly provider: string
  /** Channel the message was sent to. */
  readonly channel: ConnectorChannelId
  /** Platform message identifier, carried as the delivery's deduplication key. */
  readonly messageId: ConnectorMessageId
  /** Platform sender identifier recorded for the receiving rule. */
  readonly sender: string
  /** Message text admitted to the bound Session. */
  readonly text: string
  /**
   * Attachments the provider downloaded from the platform, admitted through
   * the attachment capability and appended after the prompt text. Omission
   * carries no storage obligation. A resolution message must not carry
   * attachments: a decision never re-enters the Session as prompt material.
   */
  readonly attachments?: readonly ConnectorInboundAttachment[]
  /**
   * Interactive-callback decision carried by the message. Presence routes the
   * message to the provider's registered resolution consumer instead of the
   * bound Session's prompt; `text` stays the callback's human-readable
   * summary but is never appended as a prompt.
   */
  readonly resolution?: ConnectorResolution
}

/** One message the seam routes to a provider for delivery to a channel. */
export interface ConnectorOutboundMessage {
  /** Optional short heading a platform may render above the text. */
  readonly title?: string
  /** Message text; the provider owns platform-specific rendering. */
  readonly text: string
  /**
   * Backend-neutral interactive actions the provider renders as clickable
   * buttons (Feishu card buttons, Slack Block Kit actions). The provider owns
   * the platform card; a clicked action comes back as a
   * {@link ConnectorResolution} on an inbound message carrying the same
   * `id`. Omission renders plain text.
   */
  readonly actions?: readonly ConnectorOutboundAction[]
}

/** One clickable action a provider renders inside an interactive outbound message. */
export interface ConnectorOutboundAction {
  /** Stable action id the platform carries back on the clicked callback. */
  readonly id: string
  /** Button label the platform renders. */
  readonly label: string
  /** Optional backend-neutral rendering hint; the provider owns the visual. */
  readonly style?: 'primary' | 'danger'
}

/** One interactive-callback decision a platform delivered back to the seam. */
export interface ConnectorResolution {
  /** The {@link ConnectorOutboundAction} id the user clicked. */
  readonly actionId: string
  /** Provider-carried payload returned with the click; empty when none. */
  readonly value: string
}

/**
 * A backend that reserves one platform id on `ctx.connector` and delivers
 * outbound messages to that platform. The provider owns callback
 * verification, message translation, and platform delivery mechanics; the
 * seam only routes.
 */
export interface ConnectorProvider {
  /** Platform identity reserved atomically at registration, such as `feishu`. */
  readonly id: string
  /**
   * Deliver one message to a channel on the provider's platform.
   * @param channel - provider-platform channel identifier.
   * @param message - the message to deliver.
   * @param signal - cancellation honored across the provider's I/O.
   */
  push(channel: ConnectorChannelId, message: ConnectorOutboundMessage, signal?: AbortSignal): void | Promise<void>
}

/**
 * Deployment choices for one inbound rule: which provider's messages become
 * Sessions, and how the Session is composed. The fields mirror the webhook
 * Session request vocabulary, so the creating path inherits the webhook
 * runtime's full validation and rollback.
 */
export interface ConnectorInboundOptions {
  /** Registered provider whose deliveries become Sessions. */
  readonly provider: string
  /** Existing local directory to resolve or create as a Web Workspace. */
  readonly workspacePath: string
  /** Agent composition mounted for the Session, new or resumed. */
  readonly agentPreset: string
  /** Sandbox and approval preset applied before prompt admission. */
  readonly permissionPreset: string
  /** Explicit Session title; omission uses `Connector <provider>`. */
  readonly title?: string
  /** Optional explicit model route; omission uses the complete current default. */
  readonly model?: WebhookModelSelection
}

/**
 * Consumer of one provider's interactive-callback decisions. Registered via
 * {@link ConnectorService.resolutions}; invoked from the provider's inbound
 * rule instead of the prompt-append path.
 */
export type ConnectorResolutionHandler = (
  message: ConnectorInboundMessage & { readonly resolution: ConnectorResolution },
) => void | Promise<void>

/**
 * The `ctx.connector` surface: a multi-provider registry, the inbound route
 * from verified platform messages into `ctx.webhookOutbox`, the outbound
 * route from Session events to a provider, and the channel-to-Session
 * binding table both routes share. The seam exposes no protocol escape
 * hatch — platform mechanics are the provider's private concern.
 */
export interface ConnectorService {
  /**
   * Reserve one platform id on the seam. Validate and conflict-check before
   * mutating: an invalid or duplicate registration publishes nothing, and
   * the disposer releases the reservation.
   * @param provider - the backend claiming the platform id.
   * @returns a synchronous disposer releasing this provider's reservation.
   */
  registerProvider(provider: ConnectorProvider): () => void
  /**
   * Admit one verified platform message as a durable webhook delivery:
   * `ctx.webhookOutbox` deduplicates it by message id and replays it into
   * the webhook runtime, where the provider's inbound rule runs.
   * @param message - the translated inbound message.
   * @returns `'queued'` once the durable record landed; `'duplicate'` when an
   * equivalent message is pending or retained as delivered.
   * @throws TypeError when a field is not a non-empty string.
   * @throws {@link ConnectorError} with `CONNECTOR_UNKNOWN_PROVIDER` when no
   * provider is registered under the id, or `CONNECTOR_INBOUND_UNAVAILABLE`
   * when the provider has no inbound rule.
   */
  deliver(message: ConnectorInboundMessage): Promise<'queued' | 'duplicate'>
  /**
   * Route one outbound message through the addressed provider.
   * @param channel - the destination channel.
   * @param message - the message to deliver.
   * @param signal - cancellation forwarded to the provider.
   * @throws {@link ConnectorError} with `CONNECTOR_UNKNOWN_PROVIDER` when no
   * provider is registered under `channel.provider`.
   */
  push(channel: ConnectorChannel, message: ConnectorOutboundMessage, signal?: AbortSignal): Promise<void>
  /**
   * Register the inbound rule for one provider: a webhook rule that runs on
   * every message of that provider and either appends the prompt to the
   * channel's existing Session (live or resumed) or creates it.
   * @param options - the provider and Session composition for its messages.
   * @returns an awaitable disposer that removes the rule.
   * @throws TypeError when an option is invalid.
   * @throws {@link ConnectorError} with `CONNECTOR_CONFLICT` when the
   * provider already has an inbound rule.
   */
  inbound(options: ConnectorInboundOptions): () => Promise<void>
  /**
   * Register the interactive-callback consumer for one provider: every
   * inbound message of that provider carrying a {@link ConnectorResolution}
   * is handed to the handler instead of being appended to the bound Session.
   * A resolution that arrives while no handler is registered fails the
   * delivery so the platform can retry — decisions are never dropped silently.
   * @param provider - the registered provider whose callbacks the handler consumes.
   * @param handler - the consumer invoked per resolution.
   * @returns a synchronous disposer removing this handler.
   * @throws {@link ConnectorError} with `CONNECTOR_CONFLICT` when the provider
   * already has a resolution handler, or `CONNECTOR_UNKNOWN_PROVIDER` when no
   * provider is registered under the id.
   */
  resolutions(provider: string, handler: ConnectorResolutionHandler): () => void
  /**
   * Record the 1:1 binding between one channel and one Session: the next
   * inbound message continues the bound Session, and outbound consumers
   * resolve a Session back to its channel. Re-binding either side releases
   * the conflicting pair.
   * @param channel - the channel to bind.
   * @param sessionId - the Session the channel now addresses.
   */
  bind(channel: ConnectorChannel, sessionId: SessionId): void
  /**
   * Release the binding of one channel, if any.
   * @param channel - the channel to release.
   */
  unbind(channel: ConnectorChannel): void
  /**
   * Resolve the Session a channel is currently bound to.
   * @param channel - the channel to resolve.
   * @returns the bound Session id, or `undefined` when unbound.
   */
  sessionOf(channel: ConnectorChannel): SessionId | undefined
  /**
   * Resolve the channel a Session is currently bound to.
   * @param sessionId - the Session to resolve.
   * @returns the bound channel, or `undefined` when unbound.
   */
  channelOf(sessionId: SessionId): ConnectorChannel | undefined
}

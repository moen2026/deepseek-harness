# Connector seam

English | [中文](connector.zh.md)

The Connector subsystem turns verified IM platform messages into ordinary durable Sessions and routes Session-originated text back to the platform. The `ctx.connector` seam owns the provider registry, the inbound rule, the outbound route, and the process-local channel-to-Session binding table; provider adapters own callback verification, message translation, and platform delivery mechanics. The [implemented decision](../../.agents/notes/implemented/architecture/2026-09-28-im-connector-seam.md) records why the seam sits between the webhook runtime and platform adapters.

## Shared values

`ConnectorChannelId` and `ConnectorMessageId` are branded opaque strings. `ConnectorChannel` addresses one platform conversation: a registered `provider` id plus the platform `channel`.

`ConnectorInboundMessage` carries what a provider translated from a verified callback — `provider`, `channel`, `messageId`, `sender`, and `text` — and every field is validated before a durable record exists; it is the contract between adapter translation and rule consumption.

`ConnectorOutboundMessage` carries optional `title` and required `text`; the provider owns platform rendering. `ConnectorProvider` reserves one platform id and delivers through `push(channel, message, signal)`.

`ConnectorError` extends `HarnessError` with one `ConnectorErrorCode`: `CONNECTOR_INVALID_PROVIDER`, `CONNECTOR_CONFLICT`, `CONNECTOR_UNKNOWN_PROVIDER`, or `CONNECTOR_INBOUND_UNAVAILABLE`.

## Inbound route

`deliver()` validates every message field, requires a registered provider with an inbound rule, and admits the message as a `VerifiedWebhookDelivery` through `ctx.webhookOutbox` — the platform message id is the deduplication key, so a redelivered callback never runs rules twice. It answers `'queued'` or `'duplicate'`.

`inbound(options)` registers one rule per provider (id `connector-inbound:<provider>`); on every admitted message the rule derives one deterministic Session id from provider plus channel and continues it: the live handle when this process holds it, otherwise a resume of the persisted Session, otherwise a `WebhookSessionRequest` that the webhook runtime creates with its full validation and rollback. A restart therefore never forks a second Session, and a failed creation heals on the next message.

## Outbound route

`push(channel, message, signal)` resolves the channel's registered provider and delegates the delivery; an unregistered provider rejects with `CONNECTOR_UNKNOWN_PROVIDER`. Consumers that react to Session events resolve the destination with `channelOf(sessionId)` first.

## Channel bindings

`bind()` records the 1:1 channel-to-Session pair; rebinding either side releases the conflicting pair, and `unbind()` releases one channel. `sessionOf()` and `channelOf()` resolve each direction. The table is process-local by design: a channel re-binds — to the same derived id — before its Session can raise an outbound push, so persistence would store restart-recoverable duplicates of a derived fact.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxconnector--connectorservice"></a>

### `ctx.connector` — `ConnectorService`

The `ctx.connector` surface: a multi-provider registry, the inbound route from verified platform messages into `ctx.webhookOutbox`, the outbound route from Session events to a provider, and the channel-to-Session binding table both routes share. The seam exposes no protocol escape hatch — platform mechanics are the provider's private concern.

```ts cordis-catalog
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
```

Types: [SessionId](core.md)

Source: [`packages/connector/connector/src/types.ts`](../../packages/connector/connector/src/types.ts)
<!-- END GENERATED cordis-surface -->

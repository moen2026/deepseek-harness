# Connector seam

[English](connector.md) | 中文

Connector 子系统把已验证的 IM 平台消息转换为普通持久 Session，并把源自 Session 的文本路由回平台。`ctx.connector` seam 拥有 provider 注册表、入站规则、出站路由与进程内 channel 到 Session 的绑定表；provider 适配器拥有回调验签、消息翻译与平台投递机制。[已实现决策](../../.agents/notes/implemented/architecture/2026-09-28-im-connector-seam.zh.md)记录了 seam 为何位于 webhook 运行时与平台适配器之间。

## 共享值

`ConnectorChannelId` 与 `ConnectorMessageId` 是品牌化不透明字符串。`ConnectorChannel` 寻址一个平台对话：已注册 `provider` id 加平台 `channel`。

`ConnectorInboundMessage` 承载 provider 从已验证回调翻译而来的内容——`provider`、`channel`、`messageId`、`sender` 与 `text`——持久记录出现前每个字段都会被校验；它是适配器翻译与规则消费之间的约定。

`ConnectorOutboundMessage` 承载可选 `title` 与必填 `text`；平台渲染由 provider 负责。`ConnectorProvider` 保留一个平台 id，并通过 `push(channel, message, signal)` 投递。

`ConnectorError` 扩展 `HarnessError`，携带一个 `ConnectorErrorCode`：`CONNECTOR_INVALID_PROVIDER`、`CONNECTOR_CONFLICT`、`CONNECTOR_UNKNOWN_PROVIDER` 或 `CONNECTOR_INBOUND_UNAVAILABLE`。

## 入站路由

`deliver()` 校验消息的每个字段，要求 provider 已注册且已有入站规则，并经 `ctx.webhookOutbox` 把消息接纳为 `VerifiedWebhookDelivery`——平台消息 id 即去重键，因此重复回调绝不会让规则运行两次。它返回 `'queued'` 或 `'duplicate'`。

`inbound(options)` 为每个 provider 注册一条规则（id 为 `connector-inbound:<provider>`）；对每条被接纳的消息，规则从 provider 与 channel 派生出唯一确定性的 Session id 并续写它：进程持有活动句柄时直接使用，否则恢复已持久 Session，再否则返回由 webhook 运行时以其完整校验与回滚创建的 `WebhookSessionRequest`。因此重启不会分叉出第二个 Session，创建失败会在下一条消息时自愈。

## 出站路由

`push(channel, message, signal)` 解析 channel 的已注册 provider 并委托投递；provider 未注册时以 `CONNECTOR_UNKNOWN_PROVIDER` 拒绝。对 Session 事件作出反应的消费方先用 `channelOf(sessionId)` 解析目的地。

## Channel 绑定

`bind()` 记录 1:1 的 channel 到 Session 配对；重绑任一侧会释放冲突配对，`unbind()` 释放单个 channel。`sessionOf()` 与 `channelOf()` 解析两个方向。该表按设计为进程内：channel 会在其 Session 能发出出站推送之前（以同一派生 id）重新绑定，因此持久化只会存储派生事实的重启可恢复副本。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [SessionId](core.zh.md)

Source: [`packages/connector/connector/src/types.ts`](../../packages/connector/connector/src/types.ts)
<!-- END GENERATED cordis-surface -->

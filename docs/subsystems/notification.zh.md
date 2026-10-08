# 通知

[English](notification.md) | 中文

notification seam——在单一 `ctx.notification` 服务上暴露一个操作员提醒通道的[能力 seam](../glossary.zh.md#capability-seam)，按包拆分：Service Definition（[dsh-notification](../../packages/notification/notification)，`ctx.notification` + 提供方注册表 + 路由的 `notify` 操作）、Service Provider（[dsh-notification-desktop](../../packages/notification/notification-desktop) 把已接受的提醒经 Desktop Host IPC 通道转发给 Electron 壳；[dsh-notification-web](../../packages/notification/notification-web) 把它们重发为 `notification/raised` 宿主事件，由 API remote 白名单携往 Client 交互面）、以及 Consumer（[dsh-notification-triggers](../../packages/notification/notification-triggers)，观察审批等待、长回合、已投递的提醒与已武装目标的规则）。通知是**一项可选能力**，不属于 agent-loop 主干。每个部署只有一个提供方持有该 seam——交互面是部署级选择，因此第二次注册是冲突；未注册提供方时，`notify` 抛出 `NotificationError` `NOTIFICATION_UNAVAILABLE`。提醒是尽力而为的：调用方把失败视为缺失的提醒，平台机制完全归提供方私有。

Source: [`packages/notification/notification/src/types.ts`](../../packages/notification/notification/src/types.ts)

## 提醒与路由

seam 只共享一个词汇表：`NotificationRequest` 携带必需的 `title` 与 `body`、可选的 `tag`——提供方可以据此合并同类提醒的稳定去重或分组键——以及可选的 `urgency`（`low`、`normal`、`critical`），提供方在平台存在对应概念时把它映射到平台的显著性。seam 对每个被接受的请求原样路由：没有限流、免打扰时段或内容边界——那些策略属于调用方。

提供方以注册时原子保留的不透明身份字符串注册；`NotificationError` 扩展 `HarnessError`，携带稳定代码 `NOTIFICATION_INVALID_PROVIDER`、`NOTIFICATION_CONFLICT`、`NOTIFICATION_UNAVAILABLE` 与 `NOTIFICATION_PROVIDER_FAILED`，调用方依据代码路由而不是解析 `message`。交付路径是转发宿主事件的提供方会把每个被接受的请求重发为 `notification/raised`，让交互面消费者共享一个载荷词汇表；没有此类转发器的部署没有监听者。

## 交互面与触发

两个交互面提供方按 profile 划分部署，因此恰好挂载一个：桌面提供方在缺少 Desktop Host IPC 通道时于加载时失败，而不是退化为静默丢弃提醒；Web 提供方的呈现发生在 Client，由浏览器权限模型把关可视化通知——Host 既不观察也不请求它。

[dsh-notification-triggers](../../packages/notification/notification-triggers) 把宿主状态变化变成提醒：审批等待超过阈值、回合时长达到下限、计划提醒被投递、目标被武装。每条规则都是带 schema 默认值的受验证 `Config` 字段，因此部署可以从 cordis.yml 调整提醒，且 settings 交互面无需额外代码即可渲染这些开关；失败的 `notify` 会被记录，而不会让引发它的宿主信号失败。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxnotification--notificationservice"></a>

### `ctx.notification` — `NotificationService`

The `ctx.notification` surface: a single-provider reservation registry plus the routed `notify` operation. The seam exposes no protocol escape hatch — platform mechanics are the provider's private concern.

```ts cordis-catalog
/**
 * Reserve the seam for one provider. Validate and conflict-check everything
 * before mutating: an invalid or conflicting registration publishes nothing,
 * and its disposer releases the reservation.
 * @param provider - the backend claiming the seam.
 * @returns a synchronous disposer releasing this provider's reservation.
 */
registerProvider(provider: NotificationProvider): () => void

/**
 * Route one alert to the registered provider.
 * @param request - the alert to surface.
 * @param signal - cancellation forwarded to the provider.
 * @throws {@link NotificationError} with `NOTIFICATION_UNAVAILABLE` when no provider is registered.
 */
notify(request: NotificationRequest, signal?: AbortSignal): Promise<void>
```

Source: [`packages/notification/notification/src/types.ts`](../../packages/notification/notification/src/types.ts)

<a id="notification-events"></a>

### `notification/*` events

<a id="notificationraised--emit"></a>

#### `notification/raised` — emit

One alert was accepted by the seam and is republished for surface consumers. A provider whose delivery path is a forwarded Host event emits this on every accepted request; deployments without such a forwarder have no listener.

```ts cordis-catalog
/**
 * One alert was accepted by the seam and is republished for surface
 * consumers. A provider whose delivery path is a forwarded Host event
 * emits this on every accepted request; deployments without such a
 * forwarder have no listener.
 * @mode emit
 * @param alert - the accepted alert, as the caller raised it.
 */
'notification/raised'(alert: NotificationRequest): void
```

Source: [`packages/notification/notification/src/types.ts`](../../packages/notification/notification/src/types.ts)
<!-- END GENERATED cordis-surface -->

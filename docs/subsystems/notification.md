# Notifications

English | [中文](notification.zh.md)

The notification seam — a [capability seam](../glossary.md#capability-seam) exposing one operator-alert channel on one `ctx.notification` service, split across packages: Service Definition ([dsh-notification](../../packages/notification/notification), `ctx.notification` + the provider registry + the routed `notify` operation), Service Providers ([dsh-notification-desktop](../../packages/notification/notification-desktop) forwards accepted alerts over the Desktop Host IPC channel to the Electron shell; [dsh-notification-web](../../packages/notification/notification-web) republishes them as the `notification/raised` host event the API remote allowlist carries to a Client surface), and Consumer ([dsh-notification-triggers](../../packages/notification/notification-triggers), the rules watching approval waits, long turns, delivered reminders, and armed goals). Notification is **one optional capability**, not part of the agent-loop spine. One provider holds the seam per deployment — the surface is a deployment-wide choice, so a second registration is a conflict — and with no provider registered `notify` throws `NotificationError` `NOTIFICATION_UNAVAILABLE`. Alerting is best-effort: callers treat a failure as a missing reminder, and platform mechanics stay the provider's private concern.

Source: [`packages/notification/notification/src/types.ts`](../../packages/notification/notification/src/types.ts)

## Alerts and routing

One vocabulary shares the seam: a `NotificationRequest` carries a required `title` and `body`, an optional `tag` — a stable dedup or grouping key a provider may coalesce sibling alerts on — and an optional `urgency` (`low`, `normal`, `critical`) that providers map onto their platform's prominence where one exists. The seam routes every accepted request as-is: no rate limit, quiet hours, or content bound — those policies belong to the callers.

Providers register under an opaque identity string reserved atomically at registration; `NotificationError` extends `HarnessError` with stable codes `NOTIFICATION_INVALID_PROVIDER`, `NOTIFICATION_CONFLICT`, `NOTIFICATION_UNAVAILABLE`, and `NOTIFICATION_PROVIDER_FAILED`, which callers route on instead of parsing `message`. A provider whose delivery path is a forwarded Host event republishes every accepted request as `notification/raised`, so surface consumers share one payload vocabulary; deployments without such a forwarder have no listener.

## Surfaces and triggers

The two surface providers divide the deployment by profile, so exactly one is mounted: the desktop provider fails at load without the Desktop Host IPC channel instead of degrading to silently dropped alerts, and the web provider's presentation happens at the Client, where the browser's permission model gates the visual notification — the Host neither observes nor requests it.

[dsh-notification-triggers](../../packages/notification/notification-triggers) turns host state changes into alerts: an approval waiting past a threshold, a turn finishing at or above a minimum duration, a delivered scheduled reminder, and a goal becoming armed. Every rule is a validated `Config` field with a schema default, so a deployment retunes alerting from cordis.yml and the settings surface renders the knobs without extra code; a failed `notify` is logged instead of failing the host signal that raised it.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

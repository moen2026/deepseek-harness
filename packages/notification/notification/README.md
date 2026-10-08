---
description: "The notification capability seam (ctx.notification): a single-provider reservation registry and one order-independent route — notify — over provider-agnostic alerts, for users and maintainers composing or extending operator reminders for deployments."
kind: "package-reference"
---

# @deepseek-ai/dsh-notification

English | [中文](README.zh.md)

## Summary

Use `dsh-notification` to give a deployment one operator-alert channel: the `notify` route takes a title, a body, and optional dedup and urgency hints and hands them to the registered provider, so a platform's delivery mechanics never change how consumers raise alerts. A single provider reserves the seam exclusively, and registration is atomic: an invalid or conflicting claim publishes nothing. Combine it with `dsh-notification-triggers` and a surface provider such as `dsh-notification-desktop` or `dsh-notification-web`; alone it answers no call and throws `NOTIFICATION_UNAVAILABLE`. The seam makes no delivery guarantee — whether an alert surfaces depends on the platform.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the service, a surface provider, and the rules that raise alerts. This package is the service those packages register against and call; it defines no surface, trigger, or preference of its own.

### When to choose it

Choose this service when a deployment wants operator alerts raised from host events — a scheduled follow-up matured, an approval has been waiting past a threshold, a turn finished, a goal reached a mark — without each caller speaking a platform's alert API. It covers one route — notify — with provider-owned delivery mechanics; the request vocabulary is fixed by the seam, so replacing the provider does not change how callers raise alerts. The seam is a host capability: it registers nothing model-facing.

### Composing a notification stack

The seam needs a provider and a caller to do anything. A minimal composition mounts the service, the trigger rules, and a surface provider:

```yaml
- name: '@deepseek-ai/dsh-notification'
- name: '@deepseek-ai/dsh-notification-triggers'
- name: '@deepseek-ai/dsh-notification-desktop'
```

The rules own when an alert is raised and the provider owns how it surfaces; see [dsh-notification-triggers](../notification-triggers/README.md), [dsh-notification-desktop](../notification-desktop/README.md), and [dsh-notification-web](../notification-web/README.md).

### The operation

`notify(request, signal?)` takes a `NotificationRequest` — a required `title` and `body` plus an optional `tag` for deduplication and an optional `urgency` (`low`, `normal`, `critical`) — and resolves once the provider accepted the alert. The seam applies no rate limit, quiet-hours policy, or content bound, so callers own those policies.

### Failures and recovery

A call fails with the structured error `NOTIFICATION_UNAVAILABLE` when no provider is registered — mount a provider or continue without alerts. Invalid or conflicting registrations fail with `NOTIFICATION_INVALID_PROVIDER` or `NOTIFICATION_CONFLICT` before any route is published, and a platform-side failure fails with `NOTIFICATION_PROVIDER_FAILED`. Callers catch `NotificationError` and route on its stable `code`; alerting is best-effort, so callers treat a failure as a missing reminder rather than a lost task.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the seam and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design philosophy

- **Capability seam, Service Definition role.** The package owns `ctx.notification` and the provider registry; providers speak platform protocols, not rules, and `dsh-notification-triggers` owns when an alert is raised.
- **Exclusive whole-deployment reservation.** One provider holds the seam at a time; the alert channel is a deployment-wide choice, so a second registration is a conflict rather than a co-existing route.
- **Atomic registration.** `registerProvider()` validates and conflict-checks everything before mutating: an invalid or conflicting registration publishes nothing, and its disposer releases the reservation.
- **Order-independent routing.** The route forwards to the single registered provider through `ctx.effect()`, so the reservation lives and dies with the registering fiber; registration and HMR order never change which provider answers.
- **Closed, provider-agnostic vocabulary.** The request fields are fixed across platforms — adding a refinement is a compile-enforced change across the seam, providers, and callers. There is no protocol escape hatch.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Notification` service, `registerProvider`/`notify`, `NotificationError` codes |
| [`src/types.ts`](src/types.ts) | Seam vocabulary: request, provider, and service contracts |
| — | No runtime invariant companion is published; the provider reservation is private, atomically updated state; the seam exposes neither an enumerable snapshot nor lifecycle events to compare independently. |

### Registration and disposal lifecycle

Registration and disposal run through `ctx.effect()`, so the provider route lives and dies with the registering fiber. `registerProvider()` returns a synchronous disposer; the seam drops the always-resolved effect promise so its disposer API stays synchronous. `NotificationError` extends `HarnessError` with stable codes (`NOTIFICATION_INVALID_PROVIDER`, `NOTIFICATION_CONFLICT`, `NOTIFICATION_UNAVAILABLE`, `NOTIFICATION_PROVIDER_FAILED`) that callers route on instead of parsing `message`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared alert route to the rules that raise alerts and the two surface providers.

- [dsh-notification-triggers](../notification-triggers/README.md) — the rules that watch host events and raise alerts through this seam.
- [dsh-notification-desktop](../notification-desktop/README.md) — the desktop provider that forwards alerts to the Electron shell.
- [dsh-notification-web](../notification-web/README.md) — the web provider that forwards alerts to the browser surface.
- [notification group map](../README.md) — the package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

None, as the host alert seam registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the seam's current scope. They are package constraints, not a task backlog.

- **Single provider per runtime** — the alert channel is a deployment-wide claim, so a second registration conflicts instead of co-existing. A deployment-configured fan-out above the seam is the intended extension if multiple surfaces must receive one alert.
- **No delivery receipt** — `notify` resolves once the provider accepted the alert; platform permission or focus state may still suppress the visual surface, and the seam does not observe that.
- **No rate or quiet-hours policy** — deduplication strategy, quiet hours, and per-source switches belong to the calling rules; the seam routes every accepted call without inspection.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

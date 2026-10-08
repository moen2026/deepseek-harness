---
description: "The browser notification surface: presents Host-raised alerts through the Web Notification API, permission-gated."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-notification

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-notification` presents Host-raised alerts through the browser's Web Notification API. Every accepted alert arrives on the forwarded `notification/raised` event, and the plugin shows it only when the browser already granted permission for this origin — asking for permission stays outside this surface, never a side effect of an alert.

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

Load the plugin through the web-app manifest. The node half is an inert plugin that makes the package visible to the host Loader; the browser half ships via the `./client` export, discovered through the `dsh.client` declaration, so an ordinary deployment mounts it without extra wiring — and it stays silent until the Host raises an alert.

### Alerts present as-is

Each accepted alert maps directly onto one Web Notification: `title` becomes the notification title, `body` its body, and the optional `tag` passes through as the platform's grouping key, so a sibling alert sharing a tag replaces its predecessor where the browser coalesces. `urgency` reaches no Web Notification option — the API has no prominence concept — so it goes unused at this surface.

### Permission is the user's decision

The plugin never prompts. It presents only when `Notification.permission` is `'granted'` and drops every other alert, including when the surface has no Notification API at all; a dropped alert is silent — no error reaches the caller that raised it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The host half ([`src/index.ts`](src/index.ts)) is an empty `apply` that exists so the package appears in the host cordis.yml and Loader; the browser half ([`src/client/index.ts`](src/client/index.ts)) registers one `ctx.effect` subscribing to `ctx.remote.$on('notification/raised')`. Presentation is a pure function over the alert and the platform constructor, which the browser-plugin spec replaces to observe titles, options, permission gating, and disposal.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The inert host half that keeps the package loadable |
| [`src/client/index.ts`](src/client/index.ts) | The subscription, the permission gate, and the present function |
| [`tests/browser-plugin.client.spec.ts`](tests/browser-plugin.client.spec.ts) | Presentation and disposal cases over a substituted constructor |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-notification`](../../notification/notification/README.md) — the seam that accepts alerts, the provider registry, and the `NotificationRequest` vocabulary.
- [`dsh-notification-web`](../../notification/notification-web/README.md) — the Host-side provider that republishes accepted alerts as `notification/raised`.
- [`dsh-api-remotes`](../../api/remotes/README.md) — the Remote layer forwarding the allowlisted Host event to the Client surface.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package presents Host-raised alerts to a human and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define current package constraints, not a task backlog.

- **Permission is never requested** — the plugin presents only where the user already granted it; prompting belongs to interactive work outside this surface.
- **`urgency` has no web mapping** — the Web Notification API exposes no prominence control, so all urgencies present identically.
- **Clicks are inert** — a presented notification carries no click-through into the session.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package owns no cross-plugin mutable state and emits no Cordis events; its single effect registration — the `notification/raised` subscription — proves disposal through the browser-plugin spec.

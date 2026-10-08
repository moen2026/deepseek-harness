---
description: "The notification group map: the operator-alert seam, its desktop and web surface providers, and the trigger rules, for users and maintainers navigating the group."
kind: "package-group"
---

# notification/ — Operator alerts for sessions

English | [中文](README.zh.md)

## Summary

The notification group surfaces operator alerts: a host-side seam, one deployment-selected surface provider, and the trigger rules that decide when an alert is worth raising. `ctx.notification` routes one `notify` request to the mounted provider — the desktop provider forwards to the Electron shell, the web provider republishes the `notification/raised` event the API remote allowlist carries to the browser surface. Alerting is optional and best-effort: with no provider mounted `notify` fails with `NOTIFICATION_UNAVAILABLE`, and a failed delivery is logged, never allowed to fail the host signal that raised it.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`notification/`](notification/README.md) | Defines the alert seam: a single-provider reservation and the routed `notify` operation | `ctx.notification` |
| [`notification-desktop/`](notification-desktop/README.md) | Forwards accepted alerts over the Desktop Host IPC channel to the Electron shell | registers on `ctx.notification` |
| [`notification-web/`](notification-web/README.md) | Republishes accepted alerts as the `notification/raised` event for the browser surface | registers on `ctx.notification` |
| [`notification-triggers/`](notification-triggers/README.md) | Watches approval waits, long turns, delivered reminders, and armed goals to raise alerts | calls `ctx.notification` |

The seam is one optional capability, and the surface is a deployment-wide choice: the desktop and web providers are mutually exclusive per profile, so mounting the group never needs a second notification channel.

-----

<a id="related-documentation"></a>
## Related documentation

- [Notification subsystem](../../docs/subsystems/notification.md) — the group's registration surface and how the packages compose.
- [Config catalog](../../docs/config-catalog.md) — the trigger rules' validated configuration fields.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

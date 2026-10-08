---
description: "The desktop-surface provider for the DeepSeek Harness notification seam — reserves ctx.notification and forwards every accepted alert as one desktop-notification message over the Desktop Host IPC channel, where the Electron shell raises the platform notification."
kind: "package-reference"
---

# @deepseek-ai/dsh-notification-desktop

English | [中文](README.zh.md)

## Summary

Use `dsh-notification-desktop` to give a desktop deployment native operator alerts: it reserves `ctx.notification` and forwards every accepted alert as one `desktop-notification` message over the Desktop Host IPC channel, where the Electron shell raises the platform notification. Mounting it without that channel fails at load instead of silently dropping alerts. It is one of two surface providers — choose [dsh-notification-web](../notification-web/README.md) for browser deployments — and needs [dsh-notification](../notification/README.md) plus alert-raising rules such as [dsh-notification-triggers](../notification-triggers/README.md) to do anything.

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

Mount the provider in the Desktop Host process. It is a surface provider for [dsh-notification](../notification/README.md): it speaks the seam's provider contract, owns the IPC message it forwards, and defines no route, trigger, or preference of its own.

### When to choose it

Choose this provider when operator alerts must surface through the desktop shell's native notifications. The Host process owns no alert surface; the provider hands each alert to the Host's own IPC channel, the Electron shell receives it, and the shell raises the platform notification natively. A deployment without a desktop shell mounts a different provider — the seam admits exactly one.

### Composing a notification stack

```yaml
- name: '@deepseek-ai/dsh-notification'
- name: '@deepseek-ai/dsh-notification-triggers'
- name: '@deepseek-ai/dsh-notification-desktop'
```

### The forwarded message

Every accepted request becomes one `DesktopAlertMessage`: a `type: 'desktop-notification'` tag, the request's `title` and `body`, and the request's `tag` and `urgency` only when the caller supplied them. Absent fields stay absent on the wire, so the shell side sees exactly the alert the caller raised.

### Failures and recovery

`apply` fails at load with `NOTIFICATION_UNAVAILABLE` when the Host IPC channel is absent — mounting the desktop provider outside the Desktop Host is a misconfiguration, not a silent no-op. Past that point the provider is synchronous: `notify` hands the message to the channel and resolves, and how the shell surfaces it — focus, permission, sound, click behavior — stays the shell's concern.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design philosophy

- **Surface provider role.** The package owns one surface: it claims `ctx.notification` with the stable id `desktop` and answers `notify`; when alerts are raised stays with the calling rules, and the seam's vocabulary stays fixed.
- **Host IPC as the delivery path.** The Host process's own `process.send` is the channel; the provider calls it bound to `process`, so the message travels the same channel the shell already validates as a platform event.
- **Fail-loud mounting.** A missing channel throws at load instead of dropping alerts silently — a misconfiguration must not degrade into "notifications never arrive".
- **Absent means absent.** Optional request fields are omitted from the message rather than forwarded as `undefined`, so the wire message carries the caller's exact fields.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `createDesktopNotificationProvider`, `apply`, `DesktopAlertMessage` |
| — | No runtime invariant companion is published; the provider holds no independent observable state to compare — it forwards what the seam accepted, and the reservation already fails loud on misuse. |

### Channel and error propagation

`apply` proves the Host IPC channel exists at load and fails loud without it; each alert is then forwarded by calling `process.send` as a method, so the native sender keeps its receiver and a channel closed later surfaces on the call itself.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from this provider back to the seam it serves and the rules that raise alerts.

- [dsh-notification](../notification/README.md) — the seam this provider reserves and the request vocabulary it forwards.
- [dsh-notification-triggers](../notification-triggers/README.md) — the rules that watch host events and raise alerts through the seam.
- [dsh-notification-web](../notification-web/README.md) — the browser-surface provider for deployments without a desktop shell.
- [notification group map](../README.md) — the package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

None, as the surface provider registers nothing model-facing.

#### KV Cache effect

None; this provider neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the provider's current scope. They are package constraints, not a task backlog.

- **Desktop shell only** — the provider requires the Desktop Host IPC channel and fails at load without it; browser deployments mount `dsh-notification-web` instead.
- **No delivery receipt** — `notify` resolves once the message left the Host; whether the shell shows, coalesces, or suppresses the notification is outside the seam.
- **No urgency mapping** — the message carries the request's `urgency` hint verbatim; mapping it to a platform prominence is the shell side's choice.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

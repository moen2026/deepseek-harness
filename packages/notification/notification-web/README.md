---
description: "The browser-surface provider for the DeepSeek Harness notification seam — reserves ctx.notification and republishes every accepted alert as the process-local notification/raised event for the API remote forwarding allowlist to carry to a Client surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-notification-web

English | [中文](README.zh.md)

## Summary

Use `dsh-notification-web` for deployments whose surface is a browser: it reserves `ctx.notification` and republishes every accepted alert as the `notification/raised` host event. The Host presents nothing itself — the event is the hand-off, and the [API remote forwarding allowlist](../../api/remotes/README.md) carries it to a Client surface that presents it through the browser's notification API. Combine it with [dsh-notification](../notification/README.md) and alert-raising rules such as [dsh-notification-triggers](../notification-triggers/README.md); a desktop deployment mounts [dsh-notification-desktop](../notification-desktop/README.md) instead.

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

Mount the provider in the Host process; it adds the republish hop and nothing else. It is a surface provider for [dsh-notification](../notification/README.md): it speaks the seam's provider contract and defines no route, trigger, or presentation of its own.

### When to choose it

Choose this provider when the deployment's surface is a browser session served by the Host — the Web profile, or any deployment without a desktop shell. The provider itself needs no browser capability: it publishes the accepted alert as a process-local event, and presentation happens wherever a Client surface listens. The browser's own permission model gates the visual notification at the Client, not here.

### Composing a notification stack

```yaml
- name: '@deepseek-ai/dsh-notification'
- name: '@deepseek-ai/dsh-notification-triggers'
- name: '@deepseek-ai/dsh-notification-web'
```

### The republished event

`notification/raised(alert)` carries the `NotificationRequest` exactly as the caller raised it — the same request the seam accepted, not a rendered message. The event is declared by the seam, so Host and Client share one vocabulary for what was raised.

### Failures and recovery

The provider adds no failure mode of its own: republishing is an in-process emit, and `notify` resolves as the seam's contract states. When the event reaches no listener — no forwarding allowlist entry, no mounted Client surface — the alert is simply not presented; the seam's best-effort contract already covers that outcome.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design philosophy

- **Republish, not present.** The provider owns the first hop only — turning an accepted request into a process-local event; presenting it is the Client surface's job, and the two hops stay independently replaceable.
- **Seam-declared vocabulary.** The `notification/raised` event is declared where the seam defines its request vocabulary, so a build without the event refuses rather than guesses.
- **The allowlist carries the hop.** Which events travel Host to Client is the `dsh-api-remotes` allowlist's decision, not this provider's; the provider emits unconditionally so the allowlist stays the one forwarding policy.
- **No hidden policy.** The provider inspects nothing — no dedup by `tag`, no quiet hours, no urgency filters; every accepted request is republished as-is.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `createWebNotificationProvider`, `apply`, `WEB_PROVIDER_ID` |
| — | No runtime invariant companion is published; the provider holds no independent observable state to compare — it republishes what the seam accepted, and the emit is its whole effect. |

### The two-hop path

Delivery to a browser spans three components: this provider publishes `notification/raised` in the Host, the `dsh-api-remotes` forwarding allowlist declares the event as Client-bound, and a Client surface — the Web client's notification UI — presents it through the browser's notification API. Each hop is owned by its package, so a deployment replaces presentation without touching how alerts are raised.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from this provider to the seam it serves, the rules that raise alerts, and the allowlist that carries the event to a Client.

- [dsh-notification](../notification/README.md) — the seam this provider reserves and the event vocabulary it republishes with.
- [dsh-notification-triggers](../notification-triggers/README.md) — the rules that watch host events and raise alerts through the seam.
- [dsh-notification-desktop](../notification-desktop/README.md) — the native-notification provider for desktop deployments.
- [dsh-api-remotes](../../api/remotes/README.md) — the forwarding allowlist that declares `notification/raised` as Client-bound.
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

- **Republish, not presentation** — mounting this provider alone shows nothing in a browser; the forwarding allowlist entry and a Client surface must both exist.
- **No permission handling on the Host** — browser permission state is a Client concern the Host neither observes nor requests.
- **No receipt back** — the Client's presentation outcome never returns to the Host, so the seam keeps its fire-and-forget contract.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

# Agent Note: Operator alert notifications

Status: implemented

English | [中文](2026-09-28-operator-alert-notifications.zh.md)

## Problem

Sessions produce host events a human away from the conversation should notice: an approval waiting for input, a turn finishing after a long run, a scheduled reminder coming due, a goal becoming armed. The Desktop shell and the Web are different deployments with different presentation channels — the Electron shell can show native notifications, the browser can show Web Notifications — and nothing shared one "raise an alert" vocabulary, so each host signal would have had to grow its own per-surface delivery code. Qoder parity (roadmap D11) requires operator notifications.

## Decision

Notifications ship as the standard three-layer family in the new `packages/notification` group: the [dsh-notification](../../../../packages/notification/notification) seam (`ctx.notification`: a single-provider reservation plus the routed `notify` operation), the surface providers [dsh-notification-desktop](../../../../packages/notification/notification-desktop) (forwards accepted alerts over the Desktop Host IPC channel to the Electron shell) and [dsh-notification-web](../../../../packages/notification/notification-web) (republishes accepted alerts as the `notification/raised` event the API remote allowlist carries to a Client surface), and the consumer [dsh-notification-triggers](../../../../packages/notification/notification-triggers).

Three positions define the seam's contract:

- **One optional capability, best-effort delivery.** Notification is not part of the agent-loop spine; with no provider registered `notify` throws `NOTIFICATION_UNAVAILABLE`, and a failed delivery is logged, never allowed to fail the host signal that raised it — callers treat a failure as a missing reminder. Nothing reaches a model request, so the session log and `SessionEventMap` are unchanged.
- **The surface is a deployment-wide choice.** Exactly one provider mounts per profile (the desktop and web patches are mutually exclusive), and a second registration is `NOTIFICATION_CONFLICT`; the desktop provider fails at load without its IPC channel instead of degrading to silently dropped alerts.
- **Policy stays with the callers.** The seam routes every accepted request as-is — no rate limit, quiet hours, or content bound — and the triggers' thresholds are validated `Config` fields with schema defaults (`approvalWaitSeconds` 60, `turnCompleteMinSeconds` 30, plus per-event opt-ins), so a deployment retunes alerting from cordis.yml and the settings surface renders the knobs without extra code.

The browser half ([dsh-client-ui-notification](../../../../packages/client/ui-notification)) presents every forwarded alert through the Web Notification API only when permission was already granted — permission stays the user's decision, never a side effect of an alert.

## Alternatives considered

**Per-surface delivery without a seam.** Letting schedule, approval, and goal signals talk to the Electron shell and the browser directly would duplicate trigger logic per surface and let one deployment notify through both channels. One seam with one mounted provider keeps triggers surface-neutral and makes "notify once per deployment" structural.

**Degrading silently when the surface is missing.** A desktop provider that no-ops without its IPC channel produces alerts indistinguishable from "nothing to report". Misconfiguration fails loud at load instead.

**Seam-owned rate limits, quiet hours, or urgency mapping.** These are presentation policy the callers own; keeping them out of the seam leaves one vocabulary (title, body, tag, urgency) that every producer can raise without knowing where the alert lands.

## Consequences

- A deployment mounts exactly one surface per profile: Electron notifications on desktop, browser notifications on the Web, permission-gated at the Client.
- Alert failures never affect the host signal that raised them; a user without granted browser permission simply sees nothing from the web surface.
- `docs/subsystems/notification.md` gains a generated Cordis API section, the trigger knobs are catalogued in `docs/config-catalog.md`, and the group appears in the capability-seams, module-graph, and package catalogs.

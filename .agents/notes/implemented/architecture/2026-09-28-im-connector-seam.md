# Agent Note: IM connector seam

Status: implemented

English | [中文](2026-09-28-im-connector-seam.zh.md)

## Problem

The roadmap's IM connector work (C8) must make Feishu and DingTalk ordinary agent channels: a platform message opens or continues one Session, and Session-originated text reaches the platform. Adapter-local implementations would each reinvent Session continuity, deduplication, and outbound addressing, and the webhook ingress already owns verified delivery intake with a durable outbox that deduplicates by delivery id and retries failed rule runs.

## Decision

The connector ships as the `packages/connector/` group: one seam package (`dsh-connector`) plus one provider package per platform (`dsh-connector-feishu`, `dsh-connector-dingtalk`).

- **A capability seam between the webhook runtime and platform adapters.** `ctx.connector` owns the provider registry, the inbound rule, the outbound route, and the channel-to-Session binding table. Providers own callback verification, message translation, and platform delivery; the seam exposes no protocol escape hatch.
- **Inbound messages ride the durable outbox.** `deliver()` validates every field of a translated message, requires a registered provider with an inbound rule, and admits it through `ctx.webhookOutbox` as a `VerifiedWebhookDelivery` keyed by the platform message id — deduplication and crash replay are the outbox's, not per-adapter code.
- **One deterministic Session per channel.** The inbound rule derives the Session id from provider plus channel, then continues it: the live handle, else a resume of the persisted Session, else a `WebhookSessionRequest` whose creation keeps the webhook runtime's validation and rollback. A restart never forks a second Session.
- **Bindings are process-local.** `bind()`/`unbind()`/`sessionOf()`/`channelOf()` mirror the 1:1 channel-to-Session pair in memory: a channel re-binds before its Session can raise an outbound push, so persisting the table would store only restart-recoverable duplicates of a derived fact.
- **Activation is an opt-in overlay.** The shipped Web composition has no webhook runtime, so `apps/cli/config/examples/im-connectors/` carries per-platform overlays (with `dsh-webhook` and `dsh-webhook-outbox`) instead of a default mount.

## Alternatives considered

**Per-platform self-contained packages.** Each adapter packaging its own Session continuity, deduplication, and outbound addressing would duplicate reliability logic per provider and diverge on deduplication; the seam keeps one implementation.

**Folding connectors into the webhook runtime.** Webhook is a generic verified-event ingress whose rules are arbitrary; IM conversations add channel identity, Session continuity, and outbound routing that would burden every webhook deployment. The connector consumes the webhook runtime without changing it.

**Persisting channel bindings.** Bindings are derived from live Sessions' inbound messages; a persisted table would need staleness governance for a fact the next message rebuilds.

**Mounting connectors in the shipped Web profile.** That would pull the webhook stack into every Web launch; the overlay keeps the default composition unchanged.

## Consequences

- A platform callback now creates or continues one durable Session per channel, deduplicated by platform message id through the outbox.
- The webhook group gains documentation of the acknowledged face; the connector group, its subsystem page, and the generated catalogs record the seam.
- Outbound triggering stays a consumer's decision: the seam routes `push()` but owns no rule for which Session events push what.

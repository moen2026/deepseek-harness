# Agent Note: Durable webhook delivery outbox

Status: implemented

English | [中文](2026-09-28-durable-webhook-delivery-outbox.zh.md)

## Problem

Webhook ingress is fire-and-forget: `ctx.webhookRuntime.dispatch()` starts rule callbacks and forgets them, so a process exit or a failing invocation silently drops the delivery, and a provider's repeated delivery can create repeated Sessions. The roadmap's IM connector work (C8: Feishu and DingTalk channels) must not build inbound reliability per adapter, and providers are the one inbound path whose transport itself retries — a delivery identifier exists, so duplicates can be deduplicated before rules run.

## Decision

The delivery queue ships as [dsh-webhook-outbox](../../../../packages/webhook/webhook-outbox) in the webhook group: a durable at-least-once outbox between verified deliveries and the rule runtime.

- **The runtime gained an acknowledged dispatch face.** `dispatchAcknowledged(delivery)` starts the same matching invocations as `dispatch()` and resolves whether every started invocation settled successfully; `dispatch()` keeps its documented fire-and-forget contract. The runtime's validation boundary (`snapshotDelivery`) is exported so the outbox and the runtime admit deliveries through one implementation.
- **One record per delivery** in the `webhook_outbox` storage domain (`per-record` layout), keyed by the base64url-encoded `[kind, source, deliveryId]` triple. `deliver()` validates and snapshots synchronously, persists before any dispatch, and answers `'queued'` or `'duplicate'`; a pending record or a `delivered` record inside the retention window dedupes, while `failed` and expired records are replaced by a fresh `pending` record so a redelivery is a retry rather than a lost event.
- **Retry and replay are the queue's job.** Every unacknowledged dispatch retries on one timer with `retryBackoffMs`; `maxAttempts` failures settle the record `failed`, terminal until a redelivery or the pruner. Opening the domain replays pending records in receipt order. Terminal records are pruned past `retentionMs`; pending records never are.
- **Unload is a closing gate.** `deliver` refuses, retry timers cancel, both serialized chains drain, then the domain closes. Work settling during the drain records its outcome but arms no new timer or prune, and a background persistence failure is logged and leaves the previous record standing for the next retry or boot replay. `[Service.init]` awaits durable activation so `ctx.plugin()` reports a failed open or replay instead of activating into a broken queue.
- **All three fields are required config.** `maxAttempts`, `retryBackoffMs`, and `retentionMs` are deployment choices with no universally correct value.

## Alternatives considered

**Retry inside the rule runtime.** Adding queues and timers to `dispatch()` burdens every rule plugin with persistence it may not want and changes the runtime's fire-and-forget contract. The acknowledged face keeps the runtime decision-free and puts durability in a package a profile opts into.

**In-memory queue or per-adapter retry.** An in-memory queue loses exactly the crash case it exists for; retry logic in each connector adapter would duplicate durability per provider and diverge on dedup. One durable outbox serves every adapter through the acknowledged face.

**Exactly-once deduplication.** Exactly-once needs rule-side idempotency the runtime cannot provide, and a delivery identifier is only source metadata — the runtime's documented behavior runs rules again for a repeated id. At-least-once with a retention-window dedupe is the honest contract.

## Consequences

- `deliver()` answers `'queued'` or `'duplicate'`; unacknowledged dispatches survive restarts as pending records, so adapter ingress becomes at-least-once.
- The webhook group READMEs document the acknowledged face; the `webhook_outbox` domain joins the persistence catalog and the three config fields the generated config catalog.
- The roadmap's Feishu and DingTalk connectors consume `ctx.webhookOutbox.deliver()` for inbound events and keep provider concerns (signature verification, message translation) to themselves.

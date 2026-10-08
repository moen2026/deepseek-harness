---
description: "Durable at-least-once delivery queue for maintainers wiring reliable webhook ingress into the rule runtime."
kind: "package-reference"
---

# @deepseek-ai/dsh-webhook-outbox

English | [中文](README.zh.md)

## Summary

`dsh-webhook-outbox` provides the Host `ctx.webhookOutbox`: a durable at-least-once queue between verified provider deliveries and `ctx.webhookRuntime`. `deliver()` persists one frozen snapshot before any rule runs and answers `'queued'` or `'duplicate'`; unacknowledged dispatches retry with the configured backoff, and pending records replay in receipt order at the next open. Terminal records are pruned past the retention window. Choose it when deliveries must survive a crash or a failing rule run; plain `dispatch()` stays fire-and-forget.

## Table of Contents

- [Delivery ledger](#delivery-ledger)
- [Dispatch and retry](#dispatch-and-retry)
- [Replay and retention](#replay-and-retention)
- [Composition](#composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="delivery-ledger"></a>
## Delivery ledger

One record per delivery lives in the `webhook_outbox` storage domain (`per-record` layout), keyed by the base64url-encoded `[kind, source, deliveryId]` triple. A record stores the frozen delivery snapshot, its `state` (`pending`, `delivered`, `failed`), `attempts`, `updatedAt`, and the latest rendered failure text in `lastError`.

`deliver()` validates and snapshots the delivery synchronously, then serializes behind the queue's ingest chain: a `pending` record, or a `delivered` record still inside the retention window, answers `'duplicate'`; every other case (absent, `failed`, or expired `delivered`) writes a fresh `pending` record and answers `'queued'`. Redeliveries therefore never run rules twice while the record is retained.

<a id="dispatch-and-retry"></a>
## Dispatch and retry

Each queued delivery dispatches through `ctx.webhookRuntime.dispatchAcknowledged(delivery)`, which resolves `true` only when every matching rule invocation settled successfully and `false` when no rule matched or any invocation failed. Acknowledged records become `delivered`. An unacknowledged or throwing dispatch increments `attempts` and keeps the record `pending` with one retry timer at `retryBackoffMs`; once `attempts` reaches `maxAttempts` the record becomes `failed` and is never retried — the next identical delivery starts a fresh `pending` record instead.

Dispatch is serialized: one delivery in flight at a time, in admission order, and an admitted dispatch drains before the domain closes.

<a id="replay-and-retention"></a>
## Replay and retention

Opening the domain replays every `pending` record in receipt order and prunes terminal records older than `retentionMs`; `pending` records are never pruned, and a prune failure is logged without failing the open. An expired `delivered` record is re-queued lazily when its delivery arrives again.

Unload marks the queue closing (later `deliver()` calls throw), cancels retry timers, drains both chains, and closes the domain; a dispatch that settles during unload records its outcome but arms no new timer or prune. A background persistence failure is logged and leaves the previous record standing, so the next retry or boot replay re-attempts it.

<a id="composition"></a>
## Composition

Mount it on the Host plane after [`dsh-webhook`](../webhook/README.md) and the storage stack. All three fields are required — attempt bounds, retry cadence, and retention are deployment choices with no universally correct value:

```yaml
- id: webhook-outbox
  name: '@deepseek-ai/dsh-webhook-outbox'
  config:
    maxAttempts: 3
    retryBackoffMs: 30000
    retentionMs: 604800000
```

| Field | Default | Meaning |
|---|---|---|
| `maxAttempts` | required | Dispatch attempts per delivery before its record becomes `failed` |
| `retryBackoffMs` | required | Delay before retrying a delivery whose dispatch was not acknowledged |
| `retentionMs` | required | Retained window for terminal records; older records are pruned |

The plugin injects `webhookRuntime` and `storageDomain`. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-webhook-outbox) is the exhaustive source for every accepted field.

<a id="model-experience"></a>
## Model Experience

None, as the outbox dispatches trusted rule callbacks and registers nothing model-facing.

#### KV Cache effect

None; the outbox queues dispatches but never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Fixed backoff, not exponential** — every retry waits exactly `retryBackoffMs`; jitter and backoff growth are outside this package.
- **At-least-once, not exactly-once** — a delivery can run again after its retained record expires, or a crash between a successful dispatch and the `delivered` write leaves the record `pending` for replay.
- **No dead-letter inspection surface** — `failed` records are visible only by reading the domain table until they are pruned.
- **One timer per pending record** — a burst of failing deliveries arms one timer each; there is no shared scheduler.
- **Retention is time-based only** — the retained record count is unbounded within the window.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

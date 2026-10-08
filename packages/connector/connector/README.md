---
description: "Bidirectional IM connector seam for maintainers wiring verified platform messages into Sessions and Session events back to chat platforms."
kind: "package-reference"
---

# @deepseek-ai/dsh-connector

English | [中文](README.zh.md)

## Summary

`dsh-connector` provides the Host `ctx.connector` capability seam: a multi-provider registry plus two routes sharing one channel-to-Session binding table. `deliver()` validates what a provider translated from a verified platform callback and admits it as a durable webhook delivery — deduplicated and replayed through `ctx.webhookOutbox` — where the provider's inbound rule derives one deterministic Session per channel and continues it (live, resumed, or created). `push()` routes outbound messages through the addressed provider. Providers own verification, translation, and platform delivery.

## Table of Contents

- [Provider registry](#provider-registry)
- [Inbound route](#inbound-route)
- [Interactive resolutions](#interactive-resolutions)
- [Inbound attachments](#inbound-attachments)
- [Outbound route](#outbound-route)
- [Channel bindings](#channel-bindings)
- [Composition](#composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="provider-registry"></a>
## Provider registry

`registerProvider()` claims one platform id such as `feishu` or `dingtalk`. It validates the id and `push()` and conflict-checks the id before publishing anything, so an invalid or duplicate registration changes no state; the returned synchronous disposer releases the reservation, and unloading the registering fiber releases it too. Providers coexist: every message routes by its `provider` field.

<a id="inbound-route"></a>
## Inbound route

A provider adapter verifies its platform callback, translates it into one `ConnectorInboundMessage`, and calls `deliver()`. The seam validates every field and builds a `VerifiedWebhookDelivery` whose deduplication key is the platform message id, then hands it to `ctx.webhookOutbox`; `'queued'` and `'duplicate'` mirror that ledger, so a redelivered callback never runs rules twice.

`inbound()` registers the provider's webhook rule once. On every admitted message the rule derives one deterministic Session id from provider plus channel and continues that Session: the live handle when this process holds it, otherwise a resume of the persisted Session, otherwise a `WebhookSessionRequest` that `ctx.webhookRuntime` creates with its full validation and rollback. A restart therefore never forks a second Session, and a failed creation heals itself on the next message.

<a id="interactive-resolutions"></a>
## Interactive resolutions

A callback that answers a rendered action set — one inbound message carrying a `resolution` (`actionId` plus a string `value`) — never re-enters the Session as chat text. `deliver()` persists it through the same outbox dedup ledger and then routes it to the provider's `resolutions()` consumer; with no consumer registered the delivery fails with `CONNECTOR_INBOUND_UNAVAILABLE` instead of being dropped. The resolution's text is unconstrained because the seam never treats it as chat.

<a id="inbound-attachments"></a>
## Inbound attachments

An inbound message may carry `attachments`: one base64-encoded image (`mediaType`, `data`, optional `name`) or file (`data`, optional `name`) per platform download. `deliver()` validates the array — entry type, canonical base64, accepted raster media types — before its durable record, so a malformed payload fails at the adapter instead of poisoning the outbox. The inbound rule admits every attachment through `ctx.attachments` — images as normalized durable references under the deployment's image limits, files verbatim through `saveFile` — and appends the resulting reference blocks after the prompt text, so the Session only ever receives attachments the capability persisted. A message without attachments performs no storage operation, and the capability is resolved lazily: only messages that carry attachments require `ctx.attachments`, otherwise the delivery fails with `CONNECTOR_ATTACHMENTS_UNAVAILABLE`. An admission failure fails the delivery, so the platform retries rather than the attachment being dropped silently; a resolution message must not carry attachments, because a decision never becomes prompt material.

<a id="outbound-route"></a>
## Outbound route

`push(channel, message, signal)` resolves the channel's registered provider and delegates the delivery to it; an unregistered provider rejects with `CONNECTOR_UNKNOWN_PROVIDER`. Messages may carry `actions`, one backend-agnostic id/label/style triple per clickable choice; the provider owns rendering them (interactive card, buttons, or plain text), so the payload stays platform-neutral. Callers that react to Session events resolve the destination with `channelOf(sessionId)` first.

<a id="channel-bindings"></a>
## Channel bindings

`bind()` records the 1:1 channel-to-Session pair; rebinding either side releases the conflicting pair, so a channel addresses at most one Session and a Session at most one channel. The table is process-local by design, not persisted: outbound pushes are raised by events of live Sessions, and the inbound rule binds the channel — to the same derived id — before its Session can raise one, so a restart rebuilds each binding from the next message.

<a id="composition"></a>
## Composition

Mount it on the Host plane after [`dsh-webhook`](../../webhook/webhook/README.md) and the agent stack; the plugin injects `webhookRuntime`, `webhookOutbox`, `agents`, `agentPresets`, and `sessionPersistence`, and takes no `config`:

```yaml
- id: connector
  name: '@deepseek-ai/dsh-connector'
```

Providers arrive at runtime: `ctx.connector.registerProvider(provider)` from the adapter package, and one `ctx.connector.inbound({ provider, workspacePath, agentPreset, permissionPreset })` per platform whose messages should open Sessions.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the platform message text and any admitted attachment references that the inbound rule appends to the bound Session's prompt; the webhook Session machinery owns the model-facing rendering.

#### KV Cache effect

None; the connector routes and validates messages but never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One Session per channel** — a channel addresses exactly one Session; several conversations inside one channel are out of scope.
- **Process-local bindings** — a second Host process does not see the first's bindings until a message re-binds the channel.
- **No outbound trigger rules** — this package routes `push()`; deciding which Session events push what belongs to a consumer.
- **Adapters do not send attachments yet** — the seam admits `attachments` when a provider translates them; the built-in Feishu and Dingtalk adapters still deliver text only.
- **Field validation, not protocol validation** — the seam checks presence and type; platform protocol details stay in the adapter.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

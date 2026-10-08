---
description: "Discord Gateway adapter for deployments connecting a bot account's Gateway WebSocket into Sessions, with bot-token REST text and action-row pushes out."
kind: "package-reference"
---

# @deepseek-ai/dsh-connector-discord

English | [中文](README.zh.md)

## Summary

`dsh-connector-discord` opens one long-lived Gateway WebSocket identified by the bot token and registers one `discord` provider on `ctx.connector`. Text messages and message-component interactions arrive over the Gateway and enter `ctx.connector.deliver()`; component interactions are acknowledged with a deferred-update callback before delivery so the client's loading state stops. The provider pushes replies over the REST API as text and renders outbound actions as an action row of buttons that click back over the Gateway. Use it when a deployment needs Discord as an agent text channel.

## Table of Contents

- [Configuration](#configuration)
- [Gateway contract](#gateway-contract)
- [Inbound messages](#inbound-messages)
- [Outbound replies](#outbound-replies)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="configuration"></a>
## Configuration

| Key | Meaning |
|---|---|
| `botTokenEnv` | Credential reference containing the bot token used to identify on the Gateway and to post replies. |
| `intents` | Intent bitfield requested at identify; defaults to `GUILD_MESSAGES \| DIRECT_MESSAGES \| MESSAGE_CONTENT`. |
| `timeoutMs` | Per-request REST timeout in milliseconds; defaults to `10000`. |
| `apiBaseUrl` | Optional `https` REST origin override without query or fragment; defaults to `https://discord.com/api/v10`. |
| `gatewayUrl` | Optional `wss` Gateway endpoint override; defaults to `wss://gateway.discord.gg/?v=10&encoding=json`. |
| `reconnectDelayMs` | Fixed delay before reconnecting after a disconnect; defaults to `5000`. |

The bot token is resolved at each identify and each REST request, so rotation affects the next connection or push without reloading the plugin.

<a id="gateway-contract"></a>
## Gateway contract

The adapter connects to the Gateway, answers the `Hello` payload's heartbeat interval, and identifies with the configured intents. A `Reconnect` or `Invalid Session` op closes the socket; any disconnect reconnects after the fixed delay with a fresh identify. The connection is never resumed, so messages sent while offline are not replayed. Authentication is the connection itself — there is no per-message callback signature to verify, and the adapter never logs the token or payloads.

<a id="inbound-messages"></a>
## Inbound messages

The Gateway consumes `MESSAGE_CREATE` events with non-empty text: the `content`, `channel_id`, snowflake message `id`, and author id become one `ConnectorInboundMessage` delivered to `ctx.connector`; the message id is the dedup key. Bot-authored messages (including this application's own replies) and system messages are ignored so the conversation loop cannot echo itself. A message-component interaction (a clicked button, `INTERACTION_CREATE` type 3) becomes a resolution message: the component's `custom_id` — which this adapter set to the action id — is the resolution, and the interaction id is the message id, so every repeat click is a distinct delivery the resolution handler drops once its request is no longer pending. The interaction is acknowledged with a deferred-update callback on a best-effort basis before delivery: the acknowledgement failure is logged, never fatal.

<a id="outbound-replies"></a>
## Outbound replies

The provider posts the text (an optional title rendered as the first line) to the addressed channel via the REST API with the resolved bot token. Outbound actions are rendered as one action row of buttons; each button carries its action id as `custom_id`, so a click returns over the Gateway as the matching resolution and the interactive loop (`dsh-connector-approval`) has a Discord surface.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-connector`: this adapter contributes no prompt or tool schema; the bound webhook Session machinery owns the model-visible text its deliveries produce.

#### KV Cache effect

Independent. Gateway intake and delivery admission do not touch a model request; any new Session prefix belongs to the bound webhook runtime.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No resume** — a disconnect reconnects with a fresh identify, so messages sent while offline are not replayed; the durable outbox deduplicates what does arrive.
- **Privileged intents** — `MESSAGE_CONTENT` must be enabled for the bot in the Discord developer portal, or `content` arrives empty and messages are ignored.
- **No TLS override on the connection path** — both defaults are `wss`/`https` and overrides must match; there is no plaintext option.
- **Text only inbound** — attachments, embeds, and reactions are ignored.
- **Clicks are not deduplicated** — the interaction id is unique per click, so deduplication of repeat clicks belongs to the resolution handler's pending-request lifetime.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Authentication occurs at the Gateway identify and the REST `Bot` authorization header; the connector seam owns delivery admission, and no HTTP route exists for this adapter.

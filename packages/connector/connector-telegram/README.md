---
description: "Telegram callback adapter for deployments routing Bot API webhook updates into Sessions, with sendMessage replies and inline-keyboard actions out."
kind: "package-reference"
---

# @deepseek-ai/dsh-connector-telegram

English | [中文](README.zh.md)

## Summary

`dsh-connector-telegram` registers one exact HTTP route on the injected `ctx.webServer` and one `telegram` provider on `ctx.connector`. The route optionally verifies the `X-Telegram-Bot-Api-Secret-Token` header with a timing-safe comparison, admits text messages and inline-keyboard callback queries through `ctx.connector.deliver()`, and best-effort acknowledges each callback query so the client's spinner stops; the provider posts replies via `sendMessage` and renders outbound actions as an inline keyboard whose buttons carry their action ids as `callback_data`. Use it when a deployment needs Telegram as an agent text channel.

## Table of Contents

- [Configuration](#configuration)
- [Callback contract](#callback-contract)
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
| `path` | Exact non-root pathname without trailing slash, query, or fragment, such as `/telegram`. |
| `botTokenEnv` | Credential reference containing the bot token used for outbound posts and callback answers. |
| `webhookSecretEnv` | Optional credential reference containing the webhook secret token; omit to accept every caller. |
| `maxBodyBytes` | Positive safe-integer ceiling for the untouched request body. |
| `timeoutMs` | Per-request outbound timeout in milliseconds; defaults to `10000`. |
| `apiBaseUrl` | Optional `https` origin override without query or fragment, such as a Bot API local server; defaults to `https://api.telegram.org`. |

Both credentials are resolved per request, so rotation affects the next callback or push without reloading the plugin.

<a id="callback-contract"></a>
## Callback contract

Only `POST application/json` is accepted. The route reads a bounded raw body and, when `webhookSecretEnv` is configured, requires the unambiguous `X-Telegram-Bot-Api-Secret-Token` header and compares it timing-safe against the resolved secret. Telegram delivers each update at least once and retries until acknowledged, so the route answers only after delivery admission. It never logs secrets or payloads.

| Status | Meaning |
|---|---|
| `200` | Message admitted, callback acknowledged, or update ignored. |
| `400` | Undecodable body, or a structurally invalid update. |
| `401` | The webhook secret token header did not match. |
| `405` | Method was not `POST`. |
| `413` | Streamed body exceeded `maxBodyBytes`. |
| `415` | Media type was not `application/json`. |
| `503` | Webhook secret credential or connector delivery was unavailable. |

`200` states that a message reached durable delivery admission (queued or duplicate), never that a rule matched or a Session answered.

<a id="inbound-messages"></a>
## Inbound messages

The route consumes updates with a `message` carrying non-empty text: the `text`, `chat.id`, sender `from.id`, and the update's `update_id` become one `ConnectorInboundMessage` delivered to `ctx.connector`; numeric ids are stringified and `update_id` is the dedup key, so one Telegram retry of the same update is admitted once. Updates whose `message` has no text (photos, stickers, edits) and updates without a `message` are acknowledged without delivery. An update with a `callback_query` becomes a resolution message: the button's `callback_data` — which this adapter set to the action id — is the resolution, and `callback_query.id` is the message id, so every repeat click is a distinct delivery the resolution handler drops once its request is no longer pending.

<a id="outbound-replies"></a>
## Outbound replies

The provider posts the text (an optional title rendered as the first line) to the addressed chat via `sendMessage` on the token-scoped method URL. Outbound actions are rendered as an inline keyboard with one button per action whose `callback_data` carries the action id, so a click returns through the webhook as the matching resolution and the interactive loop (`dsh-connector-approval`) has a Telegram surface. Each incoming callback query is answered with `answerCallbackQuery` on a best-effort basis: the acknowledgement failure is logged, never fatal, because the client's spinner must stop whether or not the seam accepts the click.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-connector`: this adapter contributes no prompt or tool schema; the bound webhook Session machinery owns the model-visible text its deliveries produce.

#### KV Cache effect

Independent. Secret verification and delivery admission do not touch a model request; any new Session prefix belongs to the bound webhook runtime.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No TLS** — the injected development WebServer is normally loopback-only behind a TLS reverse proxy or tunnel.
- **Secret token is optional** — without `webhookSecretEnv` every caller is accepted, so a public route should always configure it.
- **Bot token in the URL path** — the Bot API scopes methods by `bot<token>`, so proxies logging full URLs see the token; use an `apiBaseUrl` you control when that matters.
- **Text only inbound** — photos, stickers, and edits are acknowledged and ignored.
- **Clicks are not deduplicated** — `callback_query.id` is unique per click, so deduplication of repeat clicks belongs to the resolution handler's pending-request lifetime.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Authentication and input validation occur at the exact HTTP operation; dsh-host-webserver owns route/disposer symmetry.

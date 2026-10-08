---
description: "DingTalk callback adapter for deployments routing signed robot-message callbacks into Sessions, with session-webhook text replies out."
kind: "package-reference"
---

# @deepseek-ai/dsh-connector-dingtalk

English | [中文](README.zh.md)

## Summary

`dsh-connector-dingtalk` registers one exact HTTP route on the injected `ctx.webServer` and one `dingtalk` provider on `ctx.connector`. The route bounds and verifies robot-message callbacks (timestamped `sign` HMAC), remembers the reply session webhook each text message arrives with, and admits text messages through `ctx.connector.deliver()`; the provider replies in text through the remembered session webhook. Use it when a deployment needs DingTalk as an agent text channel.

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
| `path` | Exact non-root pathname without trailing slash, query, or fragment, such as `/dingtalk`. |
| `appSecretEnv` | Credential reference containing the DingTalk app secret used for signature verification. |
| `maxBodyBytes` | Positive safe-integer ceiling for the untouched request body. |
| `timeoutMs` | Per-request outbound timeout in milliseconds; defaults to `10000`. |

The app secret credential is resolved for every request, so rotation affects the next callback without reloading the plugin.

<a id="callback-contract"></a>
## Callback contract

Only `POST application/json` is accepted. The route reads a bounded raw body, requires unambiguous `timestamp` and `sign` headers, and verifies the base64 HMAC-SHA256 over `timestamp\nappSecret` before the one-hour replay window is enforced. It never logs secrets or payloads.

| Status | Meaning |
|---|---|
| `200` | Message admitted or callback acknowledged. |
| `400` | Undecodable body, or a structurally invalid callback. |
| `401` | Missing, duplicate, stale, or non-verifying signature. |
| `405` | Method was not `POST`. |
| `413` | Streamed body exceeded `maxBodyBytes`. |
| `415` | Media type was not `application/json`. |
| `503` | App secret credential or connector delivery was unavailable. |

`200` states that a message reached durable delivery admission (queued or duplicate), never that a rule matched or a Session answered.

<a id="inbound-messages"></a>
## Inbound messages

The route consumes `msgtype` `text` callbacks: the `text.content`, `conversationId`, `msgId`, and the sender staff id (falling back to the sender id) become one `ConnectorInboundMessage` delivered to `ctx.connector`. The `sessionWebhook` and its stated expiry are remembered per conversation for outbound replies. Other message types are acknowledged without delivery.

<a id="outbound-replies"></a>
## Outbound replies

The provider posts `{"msgtype":"text","text":{"content":...}}` to the remembered session webhook of the addressed conversation, stopping 60 seconds before the stated expiry. There is no app-level token, so replies require a conversation whose callback arrived within its session webhook lifetime; an optional message title is rendered as a first line above the text. Outbound actions are ignored: the session webhook's action-card buttons only support URL jumps and carry no callback, so the interactive resolution loop (`dsh-connector-approval`) has no DingTalk surface.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-connector`: this adapter contributes no prompt or tool schema; the bound webhook Session machinery owns the model-visible text its deliveries produce.

#### KV Cache effect

Independent. Callback verification and delivery admission do not touch a model request; any new Session prefix belongs to the bound webhook runtime.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No TLS** — the injected development WebServer is normally loopback-only behind a TLS reverse proxy or tunnel.
- **Reply-only** — DingTalk exposes no app-level send, so outbound messages require a recently seen session webhook.
- **Session webhooks are in-memory** — a restart forgets remembered sessions until the conversation speaks again.
- **One-hour replay window** — timestamps outside ±1 hour are refused as stale.
- **Text only** — images, files, and rich cards are acknowledged and ignored.
- **No interactive actions** — the session webhook's action-card buttons only support URL jumps and carry no callback, so outbound actions are ignored and resolutions cannot return through DingTalk.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Authentication and input validation occur at the exact HTTP operation; dsh-host-webserver owns route/disposer symmetry.

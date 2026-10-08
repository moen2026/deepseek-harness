---
description: "Slack callback adapter for deployments routing signature-verified Events API and Block Kit callbacks into Sessions, with chat.postMessage replies out."
kind: "package-reference"
---

# @deepseek-ai/dsh-connector-slack

English | [中文](README.zh.md)

## Summary

`dsh-connector-slack` registers one exact HTTP route on the injected `ctx.webServer` and one `slack` provider on `ctx.connector`. The route verifies every callback with the Slack signing-secret HMAC (per-request resolution, five-minute replay window), accepts both the JSON Events API and urlencoded Block Kit interactivity payloads, and admits text messages and button clicks through `ctx.connector.deliver()`; the provider posts replies via `chat.postMessage` and renders outbound actions as Block Kit buttons that click back through the same route. Use it when a deployment needs Slack as an agent text channel.

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
| `path` | Exact non-root pathname without trailing slash, query, or fragment, such as `/slack`. |
| `signingSecretEnv` | Credential reference containing the Slack signing secret used for signature verification. |
| `botTokenEnv` | Credential reference containing the bot user OAuth token used for outbound posts. |
| `maxBodyBytes` | Positive safe-integer ceiling for the untouched request body. |
| `timeoutMs` | Per-request outbound timeout in milliseconds; defaults to `10000`. |
| `apiBaseUrl` | Optional `https` origin override without query or fragment; defaults to `https://slack.com`. |

Both credentials are resolved per request, so rotation affects the next callback or push without reloading the plugin.

<a id="callback-contract"></a>
## Callback contract

Only `POST` with `application/json` (Events API, including the `url_verification` challenge) or `application/x-www-form-urlencoded` (Block Kit interactivity, the `payload=` field) is accepted. The route reads a bounded raw body, requires unambiguous `x-slack-request-timestamp` and `x-slack-signature` headers, and verifies the `v0=` hex HMAC-SHA256 over `v0:timestamp:body` before the five-minute replay window is enforced. It never logs secrets or payloads.

| Status | Meaning |
|---|---|
| `200` | Message admitted, callback acknowledged, or challenge echoed. |
| `400` | Undecodable body, or a structurally invalid callback. |
| `401` | Missing, stale, or non-verifying signature. |
| `405` | Method was not `POST`. |
| `413` | Streamed body exceeded `maxBodyBytes`. |
| `415` | Media type was neither JSON nor urlencoded. |
| `503` | Signing-secret credential or connector delivery was unavailable. |

`200` states that a message reached durable delivery admission (queued or duplicate), never that a rule matched or a Session answered.

<a id="inbound-messages"></a>
## Inbound messages

The route consumes `event_callback` `message` events with non-empty text: the `text`, `channel`, `event_id`, and sender user id become one `ConnectorInboundMessage` delivered to `ctx.connector`; `event_id` is the dedup key, so one Slack retry of the same event is admitted once. Events carrying a `bot_id` (including this app's own posts) and messages with a `subtype` are acknowledged without delivery. A `block_actions` interactive payload becomes a resolution message whose message id pairs the clicked message timestamp with the clicked `action_id`, so a repeat click on the same button is deduplicated while a click on a different button of the same message is a distinct delivery. A `url_verification` payload is answered with its `challenge` after signature verification.

<a id="outbound-replies"></a>
## Outbound replies

The provider posts the text (an optional title rendered as the first line) to the addressed channel via `chat.postMessage` with the resolved bot token. Outbound actions are rendered as Block Kit `actions` buttons below a `section` block; each button carries its action id in both `action_id` and `value`, so a click returns through the interactive route as the matching resolution and the interactive loop (`dsh-connector-approval`) has a Slack surface.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-connector`: this adapter contributes no prompt or tool schema; the bound webhook Session machinery owns the model-visible text its deliveries produce.

#### KV Cache effect

Independent. Signature verification and delivery admission do not touch a model request; any new Session prefix belongs to the bound webhook runtime.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No TLS** — the injected development WebServer is normally loopback-only behind a TLS reverse proxy or tunnel.
- **Five-minute replay window** — timestamps outside ±5 minutes are refused as stale.
- **Text only inbound** — files, images, and rich block layouts without plain text are acknowledged and ignored.
- **First action only** — a `block_actions` payload with several clicked actions delivers the first one.
- **Bot echo filter needs the bot user** — events carry `bot_id` only when the app's bot user is installed in the workspace, so self-echo suppression depends on that installation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Authentication and input validation occur at the exact HTTP operation; dsh-host-webserver owns route/disposer symmetry.

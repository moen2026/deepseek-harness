---
description: "Feishu (Lark) callback adapter for deployments routing verified platform messages into Sessions, with tenant-token text pushes out."
kind: "package-reference"
---

# @deepseek-ai/dsh-connector-feishu

English | [中文](README.zh.md)

## Summary

`dsh-connector-feishu` registers one exact HTTP route on the injected `ctx.webServer` and one `feishu` provider on `ctx.connector`. The route bounds and verifies Feishu callbacks (encrypt-key signature or verification token), answers the URL-verification challenge, and admits text messages through `ctx.connector.deliver()`; the provider pushes outbound text by minting a tenant access token and posting to the addressed chat. Use it when a deployment needs Feishu or Lark as an agent text channel.

## Table of Contents

- [Configuration](#configuration)
- [Callback contract](#callback-contract)
- [Inbound messages](#inbound-messages)
- [Outbound pushes](#outbound-pushes)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="configuration"></a>
## Configuration

| Key | Meaning |
|---|---|
| `path` | Exact non-root pathname without trailing slash, query, or fragment, such as `/feishu`. |
| `appId` | Non-empty trimmed Feishu app id sent with the tenant token request. |
| `appSecretEnv` | Credential reference containing the Feishu app secret. |
| `verificationTokenEnv` | Credential reference containing the event verification token. |
| `encryptKeyEnv` | Credential reference containing the event encrypt key; omit for plaintext-only callbacks. |
| `maxBodyBytes` | Positive safe-integer ceiling for the untouched request body. |
| `timeoutMs` | Per-request outbound timeout in milliseconds; defaults to `10000`. |
| `apiBaseUrl` | API origin override for Lark, such as `https://open.larksuite.com`; defaults to `https://open.feishu.cn`. |

Credential references are resolved for every request, so rotation affects the next callback or push without reloading the plugin.

<a id="callback-contract"></a>
## Callback contract

Only `POST application/json` is accepted. The route reads a bounded raw body; when the body carries an `encrypt` envelope it requires `X-Lark-Request-Timestamp`, `X-Lark-Request-Nonce`, and `X-Lark-Signature`, verifies the signature over the untouched bytes before decryption, and then checks the event verification token. It never logs tokens, keys, or payloads.

| Status | Meaning |
|---|---|
| `200` | Challenge echoed, message admitted, or event acknowledged. |
| `400` | Missing or duplicate header, undecodable body, or structurally invalid callback. |
| `401` | Signature or verification token was invalid. |
| `405` | Method was not `POST`. |
| `413` | Streamed body exceeded `maxBodyBytes`. |
| `415` | Media type was not `application/json`. |
| `503` | Credential, encrypt key, or connector delivery was unavailable. |

`200` states that a message reached durable delivery admission (queued or duplicate), never that a rule matched or a Session answered.

<a id="inbound-messages"></a>
## Inbound messages

The route consumes `im.message.receive_v1` events whose `message_type` is `text`: the JSON `content.text`, `chat_id`, `message_id`, and the sender open id (falling back to the sender user id) become one `ConnectorInboundMessage` delivered to `ctx.connector`. A `card.action.trigger` event becomes one resolution message: the clicked button's `value.actionId` rides as the `resolution`, the card context supplies the channel, the operator is the sender, and the header event id is the dedup key so one platform retry of a click is admitted once. Other events and non-text messages are acknowledged without delivery; a URL-verification call answers its `challenge`.

<a id="outbound-pushes"></a>
## Outbound pushes

The provider mints one tenant access token per app (`auth/v3/tenant_access_token/internal`), caches it until 60 seconds before its stated expiry, and posts to `im/v1/messages?receive_id_type=chat_id` addressed by the channel id (the Feishu chat id). A plain message posts `{"text": ...}` with an optional title rendered as a first line; a message carrying `actions` posts an interactive card whose `action` buttons echo each action id in their button `value`, so `card.action.trigger` callbacks answer through the connector seam's resolution route.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-connector`: this adapter contributes no prompt or tool schema; the bound webhook Session machinery owns the model-visible text its deliveries produce.

#### KV Cache effect

Independent. Callback verification and delivery admission do not touch a model request; any new Session prefix belongs to the bound webhook runtime.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No TLS** — the injected development WebServer is normally loopback-only behind a TLS reverse proxy or tunnel.
- **Text only inbound** — images, files, and non-text messages are acknowledged and ignored; interactive-card clicks are consumed as resolutions only.
- **Signatures cover encrypted callbacks only** — plaintext callbacks are authenticated by the verification token alone.
- **One provider id per process** — two Feishu apps cannot both register `feishu`; run separate profiles for separate apps.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Authentication and input validation occur at the exact HTTP operation; dsh-host-webserver owns route/disposer symmetry.

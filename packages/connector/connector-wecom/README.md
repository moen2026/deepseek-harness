---
description: "WeCom callback adapter for deployments routing signature-verified, AES-encrypted application callbacks into Sessions, with corp application message pushes out."
kind: "package-reference"
---

# @deepseek-ai/dsh-connector-wecom

English | [中文](README.zh.md)

## Summary

`dsh-connector-wecom` registers one exact HTTP route on the injected `ctx.webServer` and one `wecom` provider on `ctx.connector`. The route verifies every callback with the WeCom callback-token SHA-1 signature and decrypts the AES-256-CBC envelope, and admits text messages and template-card button clicks through `ctx.connector.deliver()`; the provider exchanges the corp credentials for an access token and posts replies via `message/send`, rendering outbound actions as a template card whose buttons click back through the same route. Use it when a deployment needs WeCom as an agent text channel.

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
| `path` | Exact non-root pathname without trailing slash, query, or fragment, such as `/wecom`. |
| `callbackTokenEnv` | Credential reference containing the WeCom callback token used for signature verification. |
| `encodingAesKeyEnv` | Credential reference containing the 43-character encoding AES key used to decrypt callback envelopes. |
| `corpIdEnv` | Credential reference containing the corp id used to validate the decrypted receive id and to exchange tokens. |
| `corpSecretEnv` | Credential reference containing the application secret used to exchange tokens. |
| `agentId` | Positive integer agent id every outbound message posts as. |
| `maxBodyBytes` | Positive safe-integer ceiling for the untouched request body. |
| `timeoutMs` | Per-request outbound timeout in milliseconds; defaults to `10000`. |
| `apiBaseUrl` | Optional `https` origin override without query or fragment; defaults to `https://qyapi.weixin.qq.com`. |

The credentials are resolved per request or push, so rotation affects the next callback or push without reloading the plugin.

<a id="callback-contract"></a>
## Callback contract

The URL-verification `GET` requires the `msg_signature`, `timestamp`, `nonce`, and `echostr` query members, verifies the SHA-1 signature over the sorted `[token, timestamp, nonce, echostr]` join timing-safely, and answers with the decrypted echo string. Only `POST` with `text/xml` or `application/xml` is accepted; the route reads a bounded raw body, requires the outer envelope's `Encrypt`, `MsgSignature`, `TimeStamp`, and `Nonce` members, verifies the same signature over the encrypted body, and decrypts the AES-256-CBC envelope. The decrypted receive id must equal the resolved corp id. It never logs secrets or payloads.

| Status | Meaning |
|---|---|
| `200` | Message admitted, callback acknowledged, or echo string answered. |
| `400` | Undecodable body, a structurally invalid envelope, or missing query members. |
| `401` | A non-verifying signature or a foreign receive id. |
| `405` | Method was not `GET` or `POST`. |
| `413` | Streamed body exceeded `maxBodyBytes`. |
| `415` | Media type was not XML. |
| `503` | A callback credential or connector delivery was unavailable. |

`200` states that a message reached durable delivery admission (queued or duplicate), never that a rule matched or a Session answered.

<a id="inbound-messages"></a>
## Inbound messages

The route consumes decrypted text messages with non-empty `Content`: the `FromUserName` member is both the channel and the sender — WeCom application messages are one-to-one, so the reply target is the member who wrote in — and `MsgId` is the dedup key, so one platform retry of the same message is admitted once. A `template_card_event` whose `EventKey` carries the adapter's `dsh-` prefix becomes a resolution message whose message id pairs the card's `TaskId` with the clicked key, so a repeat click on the same button is deduplicated while a click on a different button of the same card is a distinct delivery. Card events with any other key, other message types, and other events are acknowledged without delivery.

<a id="outbound-replies"></a>
## Outbound replies

The provider exchanges the corp id and application secret for an access token — cached until shortly before expiry and shared across concurrent sends — and posts the text (an optional title rendered as the first line) to the addressed member via `message/send` with the resolved `agentid`. Outbound actions are rendered as a `template_card` of type `text_notice`; each button key carries its action id behind the `dsh-` prefix, so a click returns through the callback route as the matching resolution and the interactive loop (`dsh-connector-approval`) has a WeCom surface.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-connector`: this adapter contributes no prompt or tool schema; the bound webhook Session machinery owns the model-visible text its deliveries produce.

#### KV Cache effect

Independent. Signature verification, decryption, and delivery admission do not touch a model request; any new Session prefix belongs to the bound webhook runtime.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No replay window** — the WeCom callback protocol has no timestamp window; a replayed callback is admitted through its dedup key (`MsgId`, or `TaskId:EventKey` for clicks) and the durable outbox, so a genuinely fresh message that repeats an id is dropped.
- **No TLS** — the injected development WebServer is normally loopback-only behind a TLS reverse proxy or tunnel.
- **Text only inbound** — image, voice, and other callback types are acknowledged and ignored.
- **One application per route** — the corp credentials, agent id, and callback token are shared by every message on the route; multi-agent routing is not modeled.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Authentication and input validation occur at the exact HTTP operation; dsh-host-webserver owns route/disposer symmetry.

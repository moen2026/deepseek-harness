---
description: "Package map for the IM connector family: verified platform messages into deterministic Session conversations, with outbound pushes and process-local channel bindings."
kind: "package-group"
---

# connector/ — IM platform channels to DSH Sessions

English | [中文](README.zh.md)

## Summary

The Connector family turns verified Feishu, DingTalk, Slack, Telegram, and Discord traffic into ordinary DSH Sessions and routes outbound text back to the platform. The `connector` seam owns the provider registry, the inbound rule, the outbound route, and the process-local channel bindings; provider packages own callback verification, message translation, and platform delivery. Mount it as an opt-in overlay next to [`dsh-webhook`](../webhook/webhook/README.md) and the durable outbox.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`connector/`](connector/README.md) | Provider registry, inbound Session continuation, outbound routing, and channel bindings | `ctx.connector` |
| [`connector-feishu/`](connector-feishu/README.md) | Feishu (Lark) callback verification, text translation, and tenant-token pushes | consumes `ctx.connector` and `ctx.webServer` |
| [`connector-dingtalk/`](connector-dingtalk/README.md) | DingTalk signed-callback verification, text translation, and session-webhook replies | consumes `ctx.connector` and `ctx.webServer` |
| [`connector-discord/`](connector-discord/README.md) | Discord Gateway intake, dispatch translation, and bot-token REST pushes with action-row buttons | consumes `ctx.connector` |
| [`connector-slack/`](connector-slack/README.md) | Slack signed-callback verification, Events API/Block Kit translation, and chat.postMessage pushes with interactive buttons | consumes `ctx.connector` and `ctx.webServer` |
| [`connector-telegram/`](connector-telegram/README.md) | Telegram webhook-secret verification, update translation, and sendMessage pushes with inline-keyboard actions | consumes `ctx.connector` and `ctx.webServer` |
| [`connector-wecom/`](connector-wecom/README.md) | WeCom signed-callback verification, AES envelope decryption, and template-card pushes with button resolutions | consumes `ctx.connector` and `ctx.webServer` |

<a id="related-documentation"></a>
## Related documentation

The seam admits every inbound message through [`ctx.webhookOutbox`](../webhook/webhook-outbox/README.md), so a platform redelivery deduplicates and a message survives a failing rule run. The [Connector subsystem reference](../../docs/subsystems/connector.md) owns the shared types and route contracts. The [`im-connectors` example](../../apps/cli/config/examples/im-connectors/feishu.cordis.yml) is the per-platform opt-in composition.

<a id="dev-note"></a>
## Dev Note

None.

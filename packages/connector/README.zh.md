---
description: "IM 连接器家族的包映射：已验证的平台消息进入确定性会话，配合出站推送与进程内 channel 绑定。"
kind: "package-group"
---

# connector/ — IM 平台频道到 DSH Session

[English](README.md) | 中文

## 概述

Connector 家族把已验证的飞书、钉钉、Slack、Telegram 与 Discord 流量转换为普通 DSH Session，并把出站文本路由回平台。`connector` seam 拥有 provider 注册表、入站规则、出站路由与进程内 channel 绑定；provider 包拥有回调验签、消息翻译与平台投递。把它作为 opt-in overlay 挂载在 [`dsh-webhook`](../webhook/webhook/README.zh.md) 与持久化 outbox 之后。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx key |
|---|---|---|
| [`connector/`](connector/README.zh.md) | provider 注册表、入站 Session 续写、出站路由与 channel 绑定 | `ctx.connector` |
| [`connector-feishu/`](connector-feishu/README.zh.md) | 飞书（Lark）回调验签、文本翻译与 tenant-token 推送 | 消费 `ctx.connector` 与 `ctx.webServer` |
| [`connector-dingtalk/`](connector-dingtalk/README.zh.md) | 钉钉签名回调验证、文本翻译与会话 webhook 回复 | 消费 `ctx.connector` 与 `ctx.webServer` |
| [`connector-discord/`](connector-discord/README.zh.md) | Discord Gateway 接收、dispatch 翻译与 bot token REST 推送（动作行按钮） | 消费 `ctx.connector` |
| [`connector-slack/`](connector-slack/README.zh.md) | Slack 签名回调验证、Events API/Block Kit 翻译与带交互按钮的 chat.postMessage 推送 | 消费 `ctx.connector` 与 `ctx.webServer` |
| [`connector-telegram/`](connector-telegram/README.zh.md) | Telegram webhook secret 验证、更新翻译与带 inline keyboard 动作的 sendMessage 推送 | 消费 `ctx.connector` 与 `ctx.webServer` |
| [`connector-wecom/`](connector-wecom/README.zh.md) | WeCom 签名回调验证、AES 信封解密与带按钮决议的模板卡片推送 | 消费 `ctx.connector` 与 `ctx.webServer` |

<a id="related-documentation"></a>
## 相关文档

seam 把每条入站消息经 [`ctx.webhookOutbox`](../webhook/webhook-outbox/README.zh.md) 接纳，因此平台的重复投递会被去重，消息也能在规则运行失败后存活。[Connector 子系统参考](../../docs/subsystems/connector.zh.md)拥有共享类型与路由约定。[`im-connectors` 示例](../../apps/cli/config/examples/im-connectors/feishu.cordis.yml)是按平台拆分的 opt-in 组合。

<a id="dev-note"></a>
## 开发备注

无。

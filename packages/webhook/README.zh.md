---
description: "经验证的外部事件、程序化规则与即发即弃 DSH 会话创建的包映射。"
kind: "package-group"
---

# webhook/ — 从已验证外部事件到 DSH 会话

[English](README.md) | 中文

## 概述

Webhook 系列接收通过身份验证的提供方事件，并运行受信任的程序化规则。规则可以在 Web Workspace 中创建普通根会话。分发仅存在于进程内并采用 fire-and-forget；可选的 [`webhook-outbox/`](webhook-outbox/README.zh.md) 增加一个持久化 at-least-once 队列，runtime 本身仍不拥有交付数据库、队列、重试、去重或 agent（智能体）完成状态。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx key |
|---|---|---|
| [`webhook/`](webhook/README.zh.md) | 规则注册表、回调生命周期与基于 Workspace 的会话创建 | `ctx.webhookRuntime` |
| [`webhook-github/`](webhook-github/README.zh.md) | GitHub HTTP 签名验证适配器 | 消费 `ctx.webhookRuntime` 与 `ctx.webServer` |
| [`webhook-outbox/`](webhook-outbox/README.zh.md) | 持久化 at-least-once 投递队列，带重试、重放与保留 | `ctx.webhookOutbox` |
| [`tool-github/`](tool-github/README.zh.md) | 供审查会话使用的可选出站 `github_comment` 工具 | 消费 `ctx.tools` 与 `ctx.credentials` |

<a id="related-documentation"></a>
## 相关文档

提供方适配器负责验证身份并规范化交付。规则拥有任意条件和外部调用，随后返回 `null` 或一个会话请求。[Webhook 子系统参考](../../docs/subsystems/webhook.zh.md)拥有共享类型与时序保证；[`webhook-outbox/`](webhook-outbox/README.zh.md) 为不能丢失投递的部署提供确认式接口。[tool-github/](tool-github/README.zh.md) 向反方向补全闭环：规则创建的审查会话可以把审查结论以 PR 评论的形式发布回去。

<a id="dev-note"></a>
## 开发备注

无。

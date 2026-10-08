---
description: "面向把已验证的机器人消息回调路由到会话、并以会话 webhook 回复文本的部署，说明钉钉回调适配器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-connector-dingtalk

[English](README.md) | 中文

## 概述

`dsh-connector-dingtalk` 会在注入的 `ctx.webServer` 上注册一条精确 HTTP 路由，并在 `ctx.connector` 上注册一个 `dingtalk` provider。路由限制并验证机器人消息回调（带时间戳的 `sign` HMAC），记住每条文本消息到达时携带的回复会话 webhook，并通过 `ctx.connector.deliver()` 接纳文本消息；provider 通过记住的会话 webhook 以文本回复。部署需要以钉钉作为 Agent 文本通道时，请使用它。

## 目录

- [配置](#configuration)
- [回调约定](#callback-contract)
- [入站消息](#inbound-messages)
- [出站回复](#outbound-replies)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="configuration"></a>
## 配置

| Key | 含义 |
|---|---|
| `path` | 不带尾随斜杠、查询或片段的精确非根路径，例如 `/dingtalk`。 |
| `appSecretEnv` | 包含用于签名验证的钉钉应用密钥的凭据引用。 |
| `maxBodyBytes` | 未改动请求 body 的正安全整数上限。 |
| `timeoutMs` | 每次出站请求的超时毫秒数；默认为 `10000`。 |

每次请求都会重新解析应用密钥凭据，因此轮换会在下一次回调生效，而无需重新加载插件。

<a id="callback-contract"></a>
## 回调约定

只接受 `POST application/json`。路由读取有界原始 body，要求 `timestamp` 与 `sign` header 各自唯一，并在执行一小时重放窗口检查之前验证 `timestamp\nappSecret` 上的 base64 HMAC-SHA256。它绝不记录密钥或 payload。

| 状态 | 含义 |
|---|---|
| `200` | 消息已接纳，或回调已确认。 |
| `400` | body 无法解码，或回调结构无效。 |
| `401` | 签名缺失、重复、过期或不匹配。 |
| `405` | 方法不是 `POST`。 |
| `413` | 流式 body 超过 `maxBodyBytes`。 |
| `415` | media type 不是 `application/json`。 |
| `503` | 应用密钥凭据或连接器交付不可用。 |

`200` 只表示消息已到达持久化交付准入（已排队或重复），从不表示任何规则已匹配或会话已作答。

<a id="inbound-messages"></a>
## 入站消息

路由消费 `msgtype` 为 `text` 的回调：`text.content`、`conversationId`、`msgId` 与发送者 staff id（回退到发送者 id）组合为一条 `ConnectorInboundMessage`，交付给 `ctx.connector`。`sessionWebhook` 及其声明的过期时间按会话记住，供出站回复使用。其他消息类型只被确认而不交付。

<a id="outbound-replies"></a>
## 出站回复

provider 向目标会话记住的会话 webhook 发送 `{"msgtype":"text","text":{"content":...}}`，并在声明过期时间前 60 秒停止使用。钉钉没有应用级 token，因此回复要求该会话的回调在其会话 webhook 有效期内到达；可选的消息标题会渲染为正文上方的首行。出站动作会被忽略：会话 webhook 的 actionCard 按钮仅支持 URL 跳转、没有回调机制，因此交互式决议闭环（`dsh-connector-approval`）在钉钉上没有落点。

<a id="model-experience"></a>
## 模型体验

通过 `dsh-connector` 间接产生影响：此适配器不贡献提示词或工具 schema；模型可见文本由绑定的 webhook 会话机制拥有。

#### KV 缓存影响

相互独立。回调验证与交付准入不触碰模型请求；任何新会话前缀都属于绑定的 webhook 运行时。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **无 TLS**：注入的开发 WebServer 通常只监听 loopback，并位于 TLS 反向代理或 tunnel 后。
- **仅可回复**：钉钉不提供应用级主动发送，出站消息要求近期出现过会话 webhook。
- **会话 webhook 只存内存**：重启会遗忘已记住的会话，直到该会话再次发言。
- **一小时重放窗口**：超出 ±1 小时的时间戳会因过期被拒绝。
- **仅文本**：图片、文件与富卡片会被确认并忽略。
- **无交互动作**：会话 webhook 的 actionCard 按钮仅支持 URL 跳转、没有回调机制，出站动作会被忽略，决议无法经钉钉返回。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。authentication 与 input validation 在对应 HTTP 操作中完成；route/disposer 对称性由 `dsh-host-webserver` 负责。

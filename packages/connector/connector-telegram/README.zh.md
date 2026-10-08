---
description: "面向把 Bot API webhook 更新路由到会话、并以 sendMessage 回复与 inline keyboard 动作发布的部署，说明 Telegram 回调适配器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-connector-telegram

[English](README.md) | 中文

## 概述

`dsh-connector-telegram` 会在注入的 `ctx.webServer` 上注册一条精确 HTTP 路由，并在 `ctx.connector` 上注册一个 `telegram` provider。路由以 timing-safe 比较可选验证 `X-Telegram-Bot-Api-Secret-Token` header，并通过 `ctx.connector.deliver()` 接纳文本消息与 inline keyboard 回调查询，同时 best-effort 确认每一次回调查询以停止客户端的 spinner；provider 通过 `sendMessage` 发布回复，并把出站动作渲染为 inline keyboard——按钮以 `callback_data` 携带自己的动作 id。部署需要以 Telegram 作为 Agent 文本通道时，请使用它。

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
| `path` | 不带尾随斜杠、查询或片段的精确非根路径，例如 `/telegram`。 |
| `botTokenEnv` | 包含出站发布与回调确认所用 bot token 的凭据引用。 |
| `webhookSecretEnv` | 可选的包含 webhook secret token 的凭据引用；省略则接受所有调用方。 |
| `maxBodyBytes` | 未改动请求 body 的正安全整数上限。 |
| `timeoutMs` | 每次出站请求的超时毫秒数；默认为 `10000`。 |
| `apiBaseUrl` | 可选的 `https` origin 覆盖，不带查询或片段，例如 Bot API 本地服务器；默认为 `https://api.telegram.org`。 |

两个凭据都按请求重新解析，因此轮换会在下一次回调或推送生效，而无需重新加载插件。

<a id="callback-contract"></a>
## 回调约定

只接受 `POST application/json`。路由读取有界原始 body；配置了 `webhookSecretEnv` 时，要求 `X-Telegram-Bot-Api-Secret-Token` header 各自唯一，并以 timing-safe 比较与解析出的 secret 对照。Telegram 对每个更新至少投递一次并重试直到被确认，因此路由只在交付准入之后应答。它绝不记录密钥或 payload。

| 状态 | 含义 |
|---|---|
| `200` | 消息已接纳，回调已确认，或更新已忽略。 |
| `400` | body 无法解码，或更新结构无效。 |
| `401` | webhook secret token header 不匹配。 |
| `405` | 方法不是 `POST`。 |
| `413` | 流式 body 超过 `maxBodyBytes`。 |
| `415` | media type 不是 `application/json`。 |
| `503` | webhook secret 凭据或连接器交付不可用。 |

`200` 只表示消息已到达持久化交付准入（已排队或重复），从不表示任何规则已匹配或会话已作答。

<a id="inbound-messages"></a>
## 入站消息

路由消费 `message` 带非空文本的更新：`text`、`chat.id`、发送者 `from.id` 与该更新的 `update_id` 组合为一条 `ConnectorInboundMessage`，交付给 `ctx.connector`；数字 id 会被转为字符串，`update_id` 是去重键，因此 Telegram 对同一更新的一次重试只会被接纳一次。`message` 无文本的更新（照片、贴纸、编辑）与不含 `message` 的更新只被确认而不交付。带 `callback_query` 的更新会被翻译为一条决议消息：按钮的 `callback_data`——本适配器将其设为动作 id——就是决议，`callback_query.id` 是消息 id，因此每次重复点击都是一次独立交付，由决议处理器在其请求不再 pending 时丢弃。

<a id="outbound-replies"></a>
## 出站回复

provider 以 token 作用域的方法 URL 通过 `sendMessage` 向目标会话发布文本（可选标题渲染为首行）。出站动作会渲染为 inline keyboard，每个动作一个按钮、`callback_data` 携带动作 id，因此点击会以对应决议的形式经 webhook 返回，交互式决议闭环（`dsh-connector-approval`）在 Telegram 上有落点。每条入站回调查询都以 `answerCallbackQuery` best-effort 确认：确认失败只记录日志、绝不算致命，因为无论 seam 是否接纳该点击，客户端的 spinner 都必须停止。

<a id="model-experience"></a>
## 模型体验

通过 `dsh-connector` 间接产生影响：此适配器不贡献提示词或工具 schema；模型可见文本由绑定的 webhook 会话机制拥有。

#### KV 缓存影响

相互独立。secret 验证与交付准入不触碰模型请求；任何新会话前缀都属于绑定的 webhook 运行时。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **无 TLS**：注入的开发 WebServer 通常只监听 loopback，并位于 TLS 反向代理或 tunnel 后。
- **secret token 是可选的**：不配置 `webhookSecretEnv` 时会接受所有调用方，因此公开路由应始终配置它。
- **bot token 在 URL path 中**：Bot API 以 `bot<token>` 作用域方法，记录完整 URL 的代理会看到 token；在意时请使用自有的 `apiBaseUrl`。
- **仅文本入站**：照片、贴纸与编辑会被确认并忽略。
- **点击不去重**：`callback_query.id` 每次点击唯一，重复点击的去重属于决议处理器的 pending 请求生命周期。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。authentication 与 input validation 在对应 HTTP 操作中完成；route/disposer 对称性由 `dsh-host-webserver` 负责。

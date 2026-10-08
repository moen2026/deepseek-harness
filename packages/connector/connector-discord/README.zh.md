---
description: "面向把机器人账号的 Gateway WebSocket 长连接接入会话、并以 bot token REST 文本与动作行按钮发布的部署，说明 Discord Gateway 适配器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-connector-discord

[English](README.md) | 中文

## 概述

`dsh-connector-discord` 会以 bot token 在 Gateway WebSocket 上建立一条长连接并完成身份标识，同时在 `ctx.connector` 上注册一个 `discord` provider。文本消息与消息组件交互经 Gateway 到达并进入 `ctx.connector.deliver()`；组件交互在交付前以 deferred-update callback 确认，停止客户端的加载状态。provider 通过 REST API 发布文本回复，并把出站动作渲染为动作行按钮——点击经同一条 Gateway 返回。部署需要以 Discord 作为 Agent 文本通道时，请使用它。

## 目录

- [配置](#configuration)
- [Gateway 约定](#gateway-contract)
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
| `botTokenEnv` | 包含 bot token 的凭据引用，用于 Gateway 身份标识与发布回复。 |
| `intents` | 身份标识时请求的 intent 位域；默认为 `GUILD_MESSAGES \| DIRECT_MESSAGES \| MESSAGE_CONTENT`。 |
| `timeoutMs` | 每次REST 请求的超时毫秒数；默认为 `10000`。 |
| `apiBaseUrl` | 可选的 `https` REST origin 覆盖，不带查询或片段；默认为 `https://discord.com/api/v10`。 |
| `gatewayUrl` | 可选的 `wss` Gateway 端点覆盖；默认为 `wss://gateway.discord.gg/?v=10&encoding=json`。 |
| `reconnectDelayMs` | 断线后重连的固定延迟毫秒数；默认为 `5000`。 |

bot token 在每次标识与每个 REST 请求时重新解析，因此轮换在下一次连接或推送生效，而无需重新加载插件。

<a id="gateway-contract"></a>
## Gateway 约定

适配器连接 Gateway，应答 `Hello` payload 的 heartbeat interval，并以配置的 intents 完成身份标识。`Reconnect` 或 `Invalid Session` op 会关闭 socket；任何断线都在固定延迟后以全新标识重连。连接从不 resume，因此离线期间的消息不会被重放。认证即连接本身——没有逐消息的回调签名需要验证，适配器绝不记录 token 或 payload。

<a id="inbound-messages"></a>
## 入站消息

Gateway 消费带非空文本的 `MESSAGE_CREATE` 事件：`content`、`channel_id`、snowflake 消息 `id` 与作者 id 组合为一条 `ConnectorInboundMessage`，交付给 `ctx.connector`；消息 id 是去重键。bot 作者的消息（包括本应用自己的回复）与系统消息会被忽略，使会话循环无法自我回声。消息组件交互（按钮点击，`INTERACTION_CREATE` type 3）会被翻译为一条决议消息：组件的 `custom_id`——本适配器将其设为动作 id——就是决议，交互 id 是消息 id，因此每次重复点击都是一次独立交付，由决议处理器在其请求不再 pending 时丢弃。交互在交付前以 deferred-update callback best-effort 确认：确认失败只记录日志、绝不算致命。

<a id="outbound-replies"></a>
## 出站回复

provider 以解析出的 bot token 通过 REST API 向目标频道发布文本（可选标题渲染为首行）。出站动作会渲染为一行动作按钮；每个按钮以 `custom_id` 携带自己的动作 id，因此点击会以对应决议的形式经 Gateway 返回，交互式决议闭环（`dsh-connector-approval`）在 Discord 上有落点。

<a id="model-experience"></a>
## 模型体验

通过 `dsh-connector` 间接产生影响：此适配器不贡献提示词或工具 schema；模型可见文本由绑定的 webhook 会话机制拥有。

#### KV 缓存影响

相互独立。Gateway 接收与交付准入不触碰模型请求；任何新会话前缀都属于绑定的 webhook 运行时。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **不 resume**：断线以全新标识重连，离线期间的消息不会被重放；持久 outbox 会为到达的消息去重。
- **特权 intent**：必须在 Discord 开发者门户为该 bot 启用 `MESSAGE_CONTENT`，否则 `content` 到达为空、消息被忽略。
- **连接路径无明文选项**：两个默认值都是 `wss`/`https` 且覆盖必须匹配，没有明文选项。
- **仅文本入站**：附件、embed 与表情回应会被忽略。
- **点击不去重**：交互 id 每次点击唯一，重复点击的去重属于决议处理器的 pending 请求生命周期。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。authentication 发生在 Gateway 标识与 REST `Bot` authorization header；交付准入由 connector seam 负责，本适配器没有 HTTP 路由。

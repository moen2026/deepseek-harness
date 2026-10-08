---
description: "面向把已验证签名的 Events API 与 Block Kit 回调路由到会话、并以 chat.postMessage 回复的部署，说明 Slack 回调适配器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-connector-slack

[English](README.md) | 中文

## 概述

`dsh-connector-slack` 会在注入的 `ctx.webServer` 上注册一条精确 HTTP 路由，并在 `ctx.connector` 上注册一个 `slack` provider。路由以 Slack 签名密钥 HMAC 验证每一次回调（每请求重新解析凭据，五分钟重放窗口），同时接受 JSON Events API 与 urlencoded Block Kit interactivity 两种 payload，并通过 `ctx.connector.deliver()` 接纳文本消息与按钮点击；provider 通过 `chat.postMessage` 发布回复，并把出站动作渲染为 Block Kit 按钮——点击经同一条路由返回。部署需要以 Slack 作为 Agent 文本通道时，请使用它。

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
| `path` | 不带尾随斜杠、查询或片段的精确非根路径，例如 `/slack`。 |
| `signingSecretEnv` | 包含用于签名验证的 Slack 签名密钥的凭据引用。 |
| `botTokenEnv` | 包含出站发布所用 bot 用户 OAuth token 的凭据引用。 |
| `maxBodyBytes` | 未改动请求 body 的正安全整数上限。 |
| `timeoutMs` | 每次出站请求的超时毫秒数；默认为 `10000`。 |
| `apiBaseUrl` | 可选的 `https` origin 覆盖，不带查询或片段；默认为 `https://slack.com`。 |

两个凭据都按请求重新解析，因此轮换会在下一次回调或推送生效，而无需重新加载插件。

<a id="callback-contract"></a>
## 回调约定

只接受 `POST`，media type 为 `application/json`（Events API，包括 `url_verification` challenge）或 `application/x-www-form-urlencoded`（Block Kit interactivity 的 `payload=` 字段）。路由读取有界原始 body，要求 `x-slack-request-timestamp` 与 `x-slack-signature` header 各自唯一，并在执行五分钟重放窗口检查之前验证 `v0:timestamp:body` 上的 `v0=` 十六进制 HMAC-SHA256。它绝不记录密钥或 payload。

| 状态 | 含义 |
|---|---|
| `200` | 消息已接纳，回调已确认，或 challenge 已回应。 |
| `400` | body 无法解码，或回调结构无效。 |
| `401` | 签名缺失、过期或不匹配。 |
| `405` | 方法不是 `POST`。 |
| `413` | 流式 body 超过 `maxBodyBytes`。 |
| `415` | media type 既不是 JSON 也不是 urlencoded。 |
| `503` | 签名密钥凭据或连接器交付不可用。 |

`200` 只表示消息已到达持久化交付准入（已排队或重复），从不表示任何规则已匹配或会话已作答。

<a id="inbound-messages"></a>
## 入站消息

路由消费 `event_callback` 中带非空文本的 `message` 事件：`text`、`channel`、`event_id` 与发送者用户 id 组合为一条 `ConnectorInboundMessage`，交付给 `ctx.connector`；`event_id` 是去重键，因此 Slack 对同一事件的一次重试只会被接纳一次。携带 `bot_id` 的事件（包括本应用自己的发言）与带 `subtype` 的消息只被确认而不交付。`block_actions` interactive payload 会被翻译为一条决议消息，其消息 id 由被点击消息的时间戳与被点击的 `action_id` 拼接而成，因此同一按钮的重复点击会被去重，而同一消息上不同按钮的点击是各自独立的交付。`url_verification` payload 在签名验证通过后以其 `challenge` 回应。

<a id="outbound-replies"></a>
## 出站回复

provider 以解析出的 bot token 通过 `chat.postMessage` 向目标频道发布文本（可选标题渲染为首行）。出站动作会渲染为 `section` 块下方的 Block Kit `actions` 按钮；每个按钮在 `action_id` 与 `value` 中都携带自己的动作 id，因此点击会以对应决议的形式经 interactive 路由返回，交互式决议闭环（`dsh-connector-approval`）在 Slack 上有落点。

<a id="model-experience"></a>
## 模型体验

通过 `dsh-connector` 间接产生影响：此适配器不贡献提示词或工具 schema；模型可见文本由绑定的 webhook 会话机制拥有。

#### KV 缓存影响

相互独立。签名验证与交付准入不触碰模型请求；任何新会话前缀都属于绑定的 webhook 运行时。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **无 TLS**：注入的开发 WebServer 通常只监听 loopback，并位于 TLS 反向代理或 tunnel 后。
- **五分钟重放窗口**：超出 ±5 分钟的时间戳会因过期被拒绝。
- **仅文本入站**：没有纯文本的文件、图片与富 block 布局会被确认并忽略。
- **只取首个动作**：包含多个已点击动作的 `block_actions` payload 只交付第一个。
- **bot 回声过滤依赖 bot 用户**：只有应用的 bot 用户安装到 workspace 后事件才携带 `bot_id`，因此自我回声抑制依赖该安装。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。authentication 与 input validation 在对应 HTTP 操作中完成；route/disposer 对称性由 `dsh-host-webserver` 负责。

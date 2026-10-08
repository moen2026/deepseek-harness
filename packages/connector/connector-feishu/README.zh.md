---
description: "面向把已验证的平台消息路由到会话、并以 tenant token 外发文本的部署，说明飞书（Lark）回调适配器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-connector-feishu

[English](README.md) | 中文

## 概述

`dsh-connector-feishu` 会在注入的 `ctx.webServer` 上注册一条精确 HTTP 路由，并在 `ctx.connector` 上注册一个 `feishu` provider。路由限制并验证飞书回调（加密密钥签名或校验 token），应答 URL 校验 challenge，并通过 `ctx.connector.deliver()` 接纳文本消息；provider 通过获取 tenant access token 并向目标会话发送文本来外发消息。部署需要以飞书或 Lark 作为 Agent 文本通道时，请使用它。

## 目录

- [配置](#configuration)
- [回调约定](#callback-contract)
- [入站消息](#inbound-messages)
- [出站推送](#outbound-pushes)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="configuration"></a>
## 配置

| Key | 含义 |
|---|---|
| `path` | 不带尾随斜杠、查询或片段的精确非根路径，例如 `/feishu`。 |
| `appId` | 随 tenant token 请求发送的非空、无首尾空白的飞书应用 id。 |
| `appSecretEnv` | 包含飞书应用密钥的凭据引用。 |
| `verificationTokenEnv` | 包含事件校验 token 的凭据引用。 |
| `encryptKeyEnv` | 包含事件加密密钥的凭据引用；仅明文回调时可省略。 |
| `maxBodyBytes` | 未改动请求 body 的正安全整数上限。 |
| `timeoutMs` | 每次出站请求的超时毫秒数；默认为 `10000`。 |
| `apiBaseUrl` | Lark 的 API origin 覆盖，例如 `https://open.larksuite.com`；默认为 `https://open.feishu.cn`。 |

每次请求都会重新解析凭据引用，因此轮换会在下一次回调或推送生效，而无需重新加载插件。

<a id="callback-contract"></a>
## 回调约定

只接受 `POST application/json`。路由读取有界原始 body；当 body 携带 `encrypt` 信封时必须提供 `X-Lark-Request-Timestamp`、`X-Lark-Request-Nonce` 与 `X-Lark-Signature`，在解密之前对未改动字节验证签名，然后校验事件校验 token。它绝不记录 token、密钥或 payload。

| 状态 | 含义 |
|---|---|
| `200` | challenge 已回显、消息已接纳，或事件已确认。 |
| `400` | header 缺失或重复、body 无法解码，或回调结构无效。 |
| `401` | 签名或校验 token 无效。 |
| `405` | 方法不是 `POST`。 |
| `413` | 流式 body 超过 `maxBodyBytes`。 |
| `415` | media type 不是 `application/json`。 |
| `503` | 凭据、加密密钥或连接器交付不可用。 |

`200` 只表示消息已到达持久化交付准入（已排队或重复），从不表示任何规则已匹配或会话已作答。

<a id="inbound-messages"></a>
## 入站消息

路由消费 `message_type` 为 `text` 的 `im.message.receive_v1` 事件：JSON `content.text`、`chat_id`、`message_id` 与发送者 open id（回退到发送者 user id）组合为一条 `ConnectorInboundMessage`，交付给 `ctx.connector`。`card.action.trigger` 事件会翻译为一条决议消息：被点击按钮的 `value.actionId` 作为 `resolution` 传递，卡片上下文提供通道，操作者即发送者，header 的事件 id 作为去重键，因此平台对同一次点击的重试只会被受理一次。其他事件与非文本消息只被确认而不交付；URL 校验调用会回显其 `challenge`。

<a id="outbound-pushes"></a>
## 出站推送

provider 为每个应用获取一次 tenant access token（`auth/v3/tenant_access_token/internal`），缓存至其声明过期时间前 60 秒，然后向 `im/v1/messages?receive_id_type=chat_id` 发送以频道 id（飞书 chat id）寻址的消息。普通消息发送 `{"text": ...}`，可选标题渲染为首行；携带 `actions` 的消息发送交互卡片，其 `action` 按钮在每个按钮 `value` 中回传动作 id，因此 `card.action.trigger` 回调能经 connector seam 的决议路由应答。

<a id="model-experience"></a>
## 模型体验

通过 `dsh-connector` 间接产生影响：此适配器不贡献提示词或工具 schema；模型可见文本由绑定的 webhook 会话机制拥有。

#### KV 缓存影响

相互独立。回调验证与交付准入不触碰模型请求；任何新会话前缀都属于绑定的 webhook 运行时。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **无 TLS**：注入的开发 WebServer 通常只监听 loopback，并位于 TLS 反向代理或 tunnel 后。
- **入站仅文本**：图片、文件与非文本消息会被确认并忽略；交互卡片点击只作为决议被消费。
- **签名只覆盖加密回调**：明文回调仅由校验 token 认证。
- **每个进程一个 provider id**：两个飞书应用不能同时注册 `feishu`；不同应用请运行不同 profile。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。authentication 与 input validation 在对应 HTTP 操作中完成；route/disposer 对称性由 `dsh-host-webserver` 负责。

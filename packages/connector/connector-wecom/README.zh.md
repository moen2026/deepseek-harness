---
description: "面向把签名验证、AES 加密的企业应用回调路由进会话、并以企业应用消息发布的部署，说明 WeCom 回调适配器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-connector-wecom

[English](README.md) | 中文

## 概述

`dsh-connector-wecom` 会在注入的 `ctx.webServer` 上注册一条精确 HTTP 路由，并在 `ctx.connector` 上注册一个 `wecom` provider。路由以 WeCom 回调 token 的 SHA-1 签名验证每条回调并解密 AES-256-CBC 信封，将文本消息与模板卡片按钮点击经 `ctx.connector.deliver()` 准入；provider 以企业凭据换取 access token，经 `message/send` 发布回复，并把出站动作渲染为一张模板卡片——按钮点击经同一路由返回。部署需要以 WeCom 作为 Agent 文本通道时，请使用它。

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
| `path` | 精确的非根路径名，不带尾斜杠、查询或片段，例如 `/wecom`。 |
| `callbackTokenEnv` | 包含 WeCom 回调 token 的凭据引用，用于签名验证。 |
| `encodingAesKeyEnv` | 包含 43 字符 EncodingAESKey 的凭据引用，用于解密回调信封。 |
| `corpIdEnv` | 包含企业 ID 的凭据引用，用于校验解密出的 receive id 并换取 token。 |
| `corpSecretEnv` | 包含应用 secret 的凭据引用，用于换取 token。 |
| `agentId` | 每条出站消息以其发布的正整数应用 agentid。 |
| `maxBodyBytes` | 未触碰请求体的正 safe-integer 上限。 |
| `timeoutMs` | 每次出站请求的超时毫秒数；默认为 `10000`。 |
| `apiBaseUrl` | 可选的 `https` origin 覆盖，不带查询或片段；默认为 `https://qyapi.weixin.qq.com`。 |

凭据在每次回调或推送时解析，因此轮换在下一次回调或推送生效，而无需重新加载插件。

<a id="callback-contract"></a>
## 回调约定

URL 验证 `GET` 要求 `msg_signature`、`timestamp`、`nonce`、`echostr` 查询成员，对排序后的 `[token, timestamp, nonce, echostr]` 拼接以 timing-safe 方式验证 SHA-1 签名，并以解密出的明文 echo 字符串应答。仅接受 `text/xml` 或 `application/xml` 的 `POST`；路由读取有界原始 body，要求外层信封的 `Encrypt`、`MsgSignature`、`TimeStamp`、`Nonce` 成员，对加密 body 验证同一签名并解密 AES-256-CBC 信封。解密出的 receive id 必须等于解析出的企业 ID。适配器绝不记录密钥或 payload。

| 状态码 | 含义 |
|---|---|
| `200` | 消息已准入、回调已确认，或 echo 明文已应答。 |
| `400` | 不可解码 body、结构无效的信封，或缺失查询成员。 |
| `401` | 验签不通过，或外部 receive id。 |
| `405` | 方法不是 `GET` 或 `POST`。 |
| `413` | 流式 body 超出 `maxBodyBytes`。 |
| `415` | 媒体类型不是 XML。 |
| `503` | 回调凭据或连接器交付不可用。 |

`200` 表示一条消息到达了持久交付准入（已排队或重复），从不表示某条规则命中或某个会话已应答。

<a id="inbound-messages"></a>
## 入站消息

路由消费带非空 `Content` 的解密文本消息：`FromUserName` 成员同时作为 channel 与 sender——企业应用消息是一对一的，回复对象就是写消息的成员——`MsgId` 是去重键，因此同一条消息的一次平台重试只准入一次。`EventKey` 带本适配器 `dsh-` 前缀的 `template_card_event` 会被翻译为一条决议消息，其消息 id 把卡片的 `TaskId` 与被点击的键配对，因此对同一按钮的重复点击会被去重，而对同一卡片另一按钮的点击是一次独立交付。携带其他键的卡片事件、其他消息类型与其他事件被确认但不交付。

<a id="outbound-replies"></a>
## 出站回复

provider 以企业 ID 与应用 secret 换取 access token——缓存至临近过期并跨并发发送共享——并以解析出的 `agentid` 经 `message/send` 向目标成员发布文本（可选标题渲染为首行）。出站动作渲染为 `text_notice` 类型的 `template_card`；每个按钮 key 在 `dsh-` 前缀之后携带自己的动作 id，因此点击会以对应决议的形式经回调路由返回，交互式决议闭环（`dsh-connector-approval`）在 WeCom 上有落点。

<a id="model-experience"></a>
## 模型体验

通过 `dsh-connector` 间接产生影响：此适配器不贡献提示词或工具 schema；模型可见文本由绑定的 webhook 会话机制拥有。

#### KV 缓存影响

相互独立。签名验证、解密与交付准入不触碰模型请求；任何新会话前缀都属于绑定的 webhook 运行时。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **无重放窗口**：WeCom 回调协议没有时间戳窗口；重放的回调靠其去重键（文本的 `MsgId`、点击的 `TaskId:EventKey`）与持久 outbox 准入，因此重复同一 id 的全新消息会被丢弃。
- **无 TLS**：注入的开发 WebServer 通常仅回环，处于 TLS 反向代理或隧道之后。
- **仅文本入站**：image、voice 与其他回调类型被确认并忽略。
- **每路由一个应用**：企业凭据、agentid 与回调 token 由路由上的每条消息共享；多应用路由未被建模。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。认证与输入验证发生在确切的 HTTP 操作；dsh-host-webserver 拥有 route/disposer 对称。

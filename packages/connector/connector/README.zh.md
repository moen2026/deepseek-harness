---
description: "面向维护者的双向 IM 连接器 seam：把经验证的平台消息接入 Session，并把 Session 事件送回聊天平台。"
kind: "package-reference"
---

# @deepseek-ai/dsh-connector

[English](README.md) | 中文

## 概述

`dsh-connector` 提供 Host 侧的 `ctx.connector` 能力 seam：一个多提供方注册表，以及共享同一张“通道—Session”绑定表的两条路由。`deliver()` 校验提供方从经验证的平台回调翻译出的消息，并将其受理为持久化的 webhook 投递——经 `ctx.webhookOutbox` 去重与重放——由该提供方的入站规则为每条通道派生出唯一的确定性 Session 并续写（live、恢复或新建）。`push()` 把出站消息经寻址的提供方路由出去。验签、翻译与平台投递由提供方负责。

## 目录

- [提供方注册表](#provider-registry)
- [入站路由](#inbound-route)
- [交互式决议](#interactive-resolutions)
- [入站附件](#inbound-attachments)
- [出站路由](#outbound-route)
- [通道绑定](#channel-bindings)
- [组合](#composition)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="provider-registry"></a>
## 提供方注册表

`registerProvider()` 认领一个平台 id，如 `feishu` 或 `dingtalk`。它在发布任何内容之前先校验 id、校验 `push()` 并做冲突检查，因此非法或重复的注册不会改变任何状态；返回的同步 disposer 释放该认领，注册所在 fiber 卸载时也会释放。多个提供方可以并存：每条消息按其 `provider` 字段路由。

<a id="inbound-route"></a>
## 入站路由

提供方适配器验证平台回调，将其翻译为一条 `ConnectorInboundMessage`，然后调用 `deliver()`。seam 校验每个字段，构造一条以平台消息 id 为去重键的 `VerifiedWebhookDelivery`，交给 `ctx.webhookOutbox`；`'queued'` 与 `'duplicate'` 与那份台账一致，因此重复回调绝不会让规则运行两次。

`inbound()` 为提供方注册唯一的 webhook 规则。对每条被受理的消息，规则根据“提供方 + 通道”派生出唯一的确定性 Session id 并续写该 Session：本进程持有就用 live 句柄，否则恢复持久化的 Session，再否则返回 `WebhookSessionRequest`，由 `ctx.webhookRuntime` 以完整的校验与回滚创建。重启因此绝不会分叉出第二个 Session，创建失败也会在下一条消息时自愈。

<a id="interactive-resolutions"></a>
## 交互式决议

应答已渲染动作集的回调——携带 `resolution`（`actionId` 与字符串 `value`）的入站消息——绝不会作为聊天文本重入 Session。`deliver()` 经同一张 outbox 去重台账持久化它，然后路由给该提供方的 `resolutions()` 消费者；没有注册消费者时投递以 `CONNECTOR_INBOUND_UNAVAILABLE` 失败，而不是被丢弃。决议的文本不受约束，因为 seam 从不把它当聊天。

<a id="inbound-attachments"></a>
## 入站附件

入站消息可携带 `attachments`：适配器每下载一份平台媒体，就转发一个 base64 编码的图片（`mediaType`、`data`、可选 `name`）或文件（`data`、可选 `name`）。`deliver()` 在写入持久化记录之前校验数组——条目类型、规范 base64、接受的栅格媒体类型——因此畸形载荷在适配器处就失败，而不是污染 outbox。入站规则把每个附件经 `ctx.attachments` 受理——图片按部署的图片限额归一化为持久化引用，文件经 `saveFile` 原样提交——并把得到的引用块追加在提示词文本之后，因此 Session 只会收到该能力已持久化的附件。不带附件的消息不执行任何存储操作，且该能力是惰性解析的：只有携带附件的消息才需要 `ctx.attachments`，否则投递以 `CONNECTOR_ATTACHMENTS_UNAVAILABLE` 失败。受理失败会让投递失败，由平台重试而不是把附件静默丢弃；决议消息不得携带附件，因为决议永远不会变成提示词材料。

<a id="outbound-route"></a>
## 出站路由

`push(channel, message, signal)` 解析通道注册的提供方并把投递委托给它；未注册的提供方以 `CONNECTOR_UNKNOWN_PROVIDER` 拒绝。消息可携带 `actions`——每个可点击选项一个后端无关的 id/label/style 组合；渲染（交互卡片、按钮或纯文本）由提供方拥有，因此载荷保持平台中立。对 Session 事件作出反应的调用方先用 `channelOf(sessionId)` 解析目的地。

<a id="channel-bindings"></a>
## 通道绑定

`bind()` 记录“通道—Session”的 1:1 配对；重绑任一侧都会释放冲突的配对，因此一个通道至多寻址一个 Session，一个 Session 至多对应一个通道。该表刻意保持进程内、不持久化：出站推送由 live Session 的事件触发，而入站规则总是先绑定通道——绑到同一个派生 id——其 Session 才可能触发事件，所以重启后每条绑定都会随下一条消息重建。

<a id="composition"></a>
## 组合

在 Host 平面上、[`dsh-webhook`](../../webhook/webhook/README.zh.md) 与 agent 栈之后挂载；插件注入 `webhookRuntime`、`webhookOutbox`、`agents`、`agentPresets` 与 `sessionPersistence`，且不接受 `config`：

```yaml
- id: connector
  name: '@deepseek-ai/dsh-connector'
```

提供方在运行时到达：适配器包调用 `ctx.connector.registerProvider(provider)`，每个需要把消息变成 Session 的平台再调用一次 `ctx.connector.inbound({ provider, workspacePath, agentPreset, permissionPreset })`。

<a id="model-experience"></a>
## 模型体验

间接：平台消息文本以及入站规则追加到所绑定 Session 提示词中的已受理附件引用进入模型；面向模型的渲染归 webhook 的 Session 机制所有。

#### KV 缓存影响

无；连接器只做路由与校验，从不组装或发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **每通道一个 Session** — 一个通道恰好寻址一个 Session；同一通道内的多会话不在范围内。
- **绑定为进程内** — 第二个 Host 进程在下一条消息重绑通道之前看不到第一个进程的绑定。
- **没有出站触发规则** — 本包只路由 `push()`；由哪些 Session 事件推送什么内容属于消费者。
- **适配器尚未发送附件** — 只要提供方翻译出 `attachments`，seam 就会受理；内置的飞书与钉钉适配器目前仍只投递文本。
- **字段校验而非协议校验** — seam 只检查字段的存在与类型；平台协议细节留在适配器中。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

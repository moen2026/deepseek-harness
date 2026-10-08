---
description: "connector seam 之上的审批桥：平台交互卡片点击以持久化决议应答审批请求。"
kind: "package-reference"
---

# @deepseek-ai/dsh-connector-approval

[English](README.md) | 中文

## 概述

`dsh-connector-approval` 通过推送一张交互卡片、由平台点击决定结果的方式应答已绑定 connector 通道的 Session 的 `approval/request` waterfall 事件。一个插件实例服务配置中列出的 connector 提供方；未绑定通道的 Session 保持原有应答链。本桥消费 connector seam 的交互式决议路由，绝不重入 Session。

## 目录

- [配置](#configuration)
- [请求流程](#request-flow)
- [决议路由](#decision-routing)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="configuration"></a>
## 配置

| 键 | 含义 |
|---|---|
| `providers` | 本桥应答的 connector 提供方 id 非空列表，如 `['feishu']`。 |
| `allowLabel` | 决定 `allowed-once` 的按钮文案；默认 `Approve`。 |
| `rejectLabel` | 决定 `rejected` 的按钮文案；默认 `Reject`。 |
| `approvers` | 可选映射：平台发送者 id → 人工可读身份。配置后，来自任何未映射发送者的决议会被拒绝（默认拒绝）；未配置时，通道内每个成员都可以决议。 |

空的提供方列表会让插件在加载时失败；`approvers` 映射若不包含至少一个非空的“发送者 → 身份”条目，同样会在加载时失败。

<a id="request-flow"></a>
## 请求流程

对一条 id 已通过 `ctx.connector.channelOf()` 绑定的 Session 的 `approval/request`，本桥生成一个 correlation id，推送一张携带主色调允许按钮与危险色拒绝按钮的卡片，然后等待。请求的 abort signal 会将其落定为 `'cancelled'`；推送失败会像其它不可用应答方一样 fail-closed；桥卸载会取消所有等待。未绑定通道的 Session 原样委托给 `next()`。

<a id="decision-routing"></a>
## 决议路由

本桥为每个配置的提供方注册一个 `ctx.connector.resolutions()` 消费者。每个按钮 id 编码为 `dsh-approval:<correlationId>:<outcome>`；动作 id 不是本桥铸造的回调、或其请求已不在等待中的回调，会被记录并丢弃。点击结果以 `allowed-once` 或 `rejected` 应答 waterfall；平台只需原样回传按钮 value。

配置 `approvers` 后，授权在应用结果之前执行：来自映射之外发送者的决议会被记录发送者 id，并把其等待中的请求落定为 `rejected`——默认拒绝，因此未映射的群成员能让工具调用被拒，但永远无法批准。已映射的决议会连同映射身份、发送者 id 与结果一起记录。

<a id="model-experience"></a>
## 模型体验

无，因为本桥位于审批 seam 与 connector seam 之上；不贡献提示词、工具 schema 或 session 事件。审批结果仍由 `dsh-user-approval` 照常审计。

#### KV 缓存影响

无直接影响；不组装也不修改任何模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **correlation 只在进程内**——等待项存于内存：桥卸载会取消它们，等待项消失后（迟到或重启后）到达的点击会被丢弃。
- **每请求一次决议**——一个 correlation id 的第一条决议应答它；同一卡片上的后续点击会被丢弃。
- **依赖提供方渲染**——忽略 `actions` 的提供方渲染不出按钮，其请求会一直等待直至 abort。
- **发送者身份由部署配置**——本桥只认平台 id 形式的发送者；`approvers` 需要人工与平台成员保持同步，未映射的合法审批人在映射之前会被拒绝。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本桥只观察一条 waterfall 与一条决议路由，二者归属其它包。

---
description: "面向将可靠 webhook 入口接入规则运行时的维护者，说明持久化的 at-least-once 投递队列。"
kind: "package-reference"
---

# @deepseek-ai/dsh-webhook-outbox

[English](README.md) | 中文

## 概述

`dsh-webhook-outbox` 提供 Host 侧的 `ctx.webhookOutbox`：一条位于已验证提供方投递与 `ctx.webhookRuntime` 之间的持久化 at-least-once 队列。`deliver()` 在任何规则运行前先持久化一份冻结快照，并返回 `'queued'` 或 `'duplicate'`；未被确认的 dispatch 按配置的退避重试，`pending` 记录在下次打开时按接收顺序重放。超过保留窗口的终态记录会被清理。当投递必须扛过进程崩溃或规则运行失败时选择它；纯 `dispatch()` 仍是 fire-and-forget。

## 目录

- [投递台账](#delivery-ledger)
- [调度与重试](#dispatch-and-retry)
- [重放与保留](#replay-and-retention)
- [组合](#composition)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="delivery-ledger"></a>
## 投递台账

每条投递对应 `webhook_outbox` 存储域（`per-record` 布局）中的一条记录，键是经 base64url 编码的 `[kind, source, deliveryId]` 三元组。记录保存冻结的投递快照、`state`（`pending`、`delivered`、`failed`）、`attempts`、`updatedAt`，以及 `lastError` 中最近一次渲染后的失败文本。

`deliver()` 先同步校验并快照投递，再排队进入队列的 ingest 串行链：`pending` 记录，或仍在保留窗口内的 `delivered` 记录，返回 `'duplicate'`；其余情况（记录不存在、`failed`、或已过期的 `delivered`）写入一条全新的 `pending` 记录并返回 `'queued'`。因此在记录被保留期间，重复投递绝不会让规则运行两次。

<a id="dispatch-and-retry"></a>
## 调度与重试

每条排队投递通过 `ctx.webhookRuntime.dispatchAcknowledged(delivery)` 调度：仅当所有匹配的规则调用都成功结束时才解析为 `true`，没有任何规则匹配或任一调用失败时为 `false`。被确认的记录变为 `delivered`。未被确认或抛出异常的 dispatch 会递增 `attempts`，记录保持 `pending` 并挂一个 `retryBackoffMs` 的重试定时器；一旦 `attempts` 达到 `maxAttempts`，记录变为 `failed` 且不再重试——下一次相同投递会开启一条全新的 `pending` 记录。

调度是串行的：同一时刻只有一条投递在途，按准入顺序执行；已准入的 dispatch 会在域关闭前排空。

<a id="replay-and-retention"></a>
## 重放与保留

打开域时会按接收顺序重放所有 `pending` 记录，并清理早于 `retentionMs` 的终态记录；`pending` 记录永不清理，清理失败只记录日志、不影响打开。已过期的 `delivered` 记录会在同一条投递再次到达时惰性重投。

卸载会将队列标记为 closing（此后调用 `deliver()` 会抛错）、取消重试定时器、排空两条串行链并关闭域；在卸载期间落定的 dispatch 只记录结果，不再挂新定时器或触发清理。后台持久化失败只记录日志，保留原有记录，由下一次重试或启动重放重新尝试。

<a id="composition"></a>
## 组合

在 Host 平面上、[`dsh-webhook`](../webhook/README.zh.md) 与存储栈之后挂载。三个字段全部必填——尝试上限、重试节奏与保留期都是部署选择，没有普遍正确的取值：

```yaml
- id: webhook-outbox
  name: '@deepseek-ai/dsh-webhook-outbox'
  config:
    maxAttempts: 3
    retryBackoffMs: 30000
    retentionMs: 604800000
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxAttempts` | 必填 | 每条投递在记录变为 `failed` 前允许的调度次数 |
| `retryBackoffMs` | 必填 | dispatch 未被确认后的重试延迟 |
| `retentionMs` | 必填 | 终态记录的保留窗口；更早的记录会被清理 |

插件注入 `webhookRuntime` 与 `storageDomain`。生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-webhook-outbox)是全部可接受字段的完整来源。

<a id="model-experience"></a>
## 模型体验

无：outbox 只调度受信任的规则回调，不注册任何面向模型的内容。

#### KV 缓存影响

无；outbox 只排队调度，从不组装或发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **固定退避，非指数退避** — 每次重试都恰好等待 `retryBackoffMs`；抖动与退避增长不在本包范围内。
- **at-least-once，而非 exactly-once** — 保留记录过期后投递可能再次运行；或在 dispatch 成功与写入 `delivered` 之间发生崩溃，使记录保持 `pending` 被重放。
- **没有死信查看界面** — `failed` 记录在被清理前只能通过读取域表查看。
- **每个 pending 记录一个定时器** — 一批失败投递会各挂一个定时器；没有共享调度器。
- **保留仅按时间** — 窗口内保留的记录数量没有上限。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

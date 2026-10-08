# Agent Note：持久化 webhook 投递 outbox

Status: implemented

[English](2026-09-28-durable-webhook-delivery-outbox.md) | 中文

## 问题

Webhook 入口是 fire-and-forget 的：`ctx.webhookRuntime.dispatch()` 启动规则回调后不再追踪，进程退出或某次调用失败都会静默丢失投递，而提供方的重复投递还可能重复创建会话。路线图的 IM 连接器工作（C8：飞书与钉钉频道）不该按适配器各自实现入口可靠性；而提供方恰是传输层自身会重试的唯一入口路径——交付标识已经存在，重复项可以在规则运行前被去重。

## 决策

投递队列以 [dsh-webhook-outbox](../../../../packages/webhook/webhook-outbox) 落地在 webhook 组：一条位于已验证投递与规则运行时之间的持久化 at-least-once outbox。

- **运行时获得确认式调度面。** `dispatchAcknowledged(delivery)` 启动与 `dispatch()` 相同的匹配调用，并解析是否每个已启动的调用都成功结束；`dispatch()` 保持其已文档化的 fire-and-forget 合同。运行时的校验边界（`snapshotDelivery`）改为导出，使 outbox 与运行时经同一实现接纳投递。
- **每条投递一条记录**，存入 `webhook_outbox` 存储域（`per-record` 布局），键为经 base64url 编码的 `[kind, source, deliveryId]` 三元组。`deliver()` 先同步校验并快照，在任何调度前完成持久化，并返回 `'queued'` 或 `'duplicate'`；`pending` 记录或仍在保留窗口内的 `delivered` 记录会去重，而 `failed` 与已过期记录会被全新的 `pending` 记录替换，使重复投递成为一次重试而不是丢失事件。
- **重试与重放是队列的职责。** 每次未被确认的调度用一个定时器按 `retryBackoffMs` 重试；达到 `maxAttempts` 次失败后记录落定为 `failed`，在重复投递或清理之前为终态。打开域时按接收顺序重放 `pending` 记录。终态记录在超过 `retentionMs` 后被清理；`pending` 记录永不清理。
- **卸载是 closing 闸门。** `deliver` 拒绝新投递、取消重试定时器、排空两条串行链，然后关闭域。在排空期间落定的工作只记录结果，不再挂新定时器或触发清理；后台持久化失败只记录日志并保留原有记录，供下一次重试或启动重放使用。`[Service.init]` 等待持久化激活，使 `ctx.plugin()` 能上报打开或重放失败，而不是带病激活。
- **三个字段全部必填。** `maxAttempts`、`retryBackoffMs` 与 `retentionMs` 都是没有普遍正确取值的部署选择。

## 已考虑的替代方案

**把重试放进规则运行时。** 给 `dispatch()` 加队列与定时器会让每个规则插件背负它未必想要的持久化，并改变运行时 fire-and-forget 的合同。确认式接口让运行时保持无决策，把持久化放进由 profile 选择加入的独立包。

**内存队列或按适配器重试。** 内存队列恰好丢失它本应扛住的崩溃场景；让每个连接器适配器各自重试会按提供方重复持久化逻辑并在去重上分叉。一条持久化 outbox 经确认式接口服务所有适配器。

**exactly-once 去重。** exactly-once 需要运行时无法提供的规则侧幂等性，而交付标识只是来源信息——按运行时已文档化的行为，重复 id 会再次运行规则。at-least-once 加保留窗口去重才是诚实的合同。

## 后果

- `deliver()` 返回 `'queued'` 或 `'duplicate'`；未被确认的调度以 `pending` 记录跨重启存活，适配器入口因此成为 at-least-once。
- webhook 组的 README 记录了确认式接口；`webhook_outbox` 域进入持久化目录，三个配置字段进入生成的配置目录。
- 路线图的飞书与钉钉连接器将消费 `ctx.webhookOutbox.deliver()` 处理入口事件，并把提供方关注点（验签、消息翻译）留在自己一侧。

# Agent Note：IM 连接器 seam

Status: implemented

[English](2026-09-28-im-connector-seam.md) | 中文

## 问题

路线图的 IM 连接器工作（C8）必须让飞书和钉钉成为普通 agent 频道：一条平台消息打开或续写一个 Session，源自 Session 的文本到达平台。若各适配器自行实现，每个都会重新发明 Session 连续性、去重与出站寻址；而 webhook 入口已经拥有已验证投递的接收路径，并配有按交付 id 去重、对失败规则运行重试的持久化 outbox。

## 决策

连接器以 `packages/connector/` 组落地：一个 seam 包（`dsh-connector`）加上每平台一个 provider 包（`dsh-connector-feishu`、`dsh-connector-dingtalk`）。

- **位于 webhook 运行时与平台适配器之间的能力 seam。** `ctx.connector` 拥有 provider 注册表、入站规则、出站路由与 channel 到 Session 的绑定表。provider 拥有回调验签、消息翻译与平台投递；seam 不暴露协议逃生舱。
- **入站消息走持久化 outbox。** `deliver()` 校验翻译后消息的每个字段，要求 provider 已注册且有入站规则，并经 `ctx.webhookOutbox` 以平台消息 id 为键把它接纳为 `VerifiedWebhookDelivery`——去重与崩溃重放属于 outbox，而非各适配器代码。
- **每个 channel 一个确定性 Session。** 入站规则从 provider 与 channel 派生 Session id，然后续写它：活动句柄优先，否则恢复已持久 Session，再否则返回 `WebhookSessionRequest`，其创建保持 webhook 运行时的校验与回滚。重启不会分叉出第二个 Session。
- **绑定是进程内的。** `bind()`/`unbind()`/`sessionOf()`/`channelOf()` 在内存中镜像 1:1 的 channel 到 Session 配对：channel 会在其 Session 能发出出站推送之前重新绑定，因此持久化该表只会存储派生事实的重启可恢复副本。
- **激活是 opt-in overlay。** 随发行版交付的 Web 组成没有 webhook 运行时，因此 `apps/cli/config/examples/im-connectors/` 提供按平台拆分的 overlay（连同 `dsh-webhook` 与 `dsh-webhook-outbox`），而非默认挂载。

## 已考虑的替代方案

**每平台自包含包。** 每个适配器各自打包 Session 连续性、去重与出站寻址，会按 provider 重复可靠性逻辑并在去重上分叉；seam 保持单一实现。

**把连接器并入 webhook 运行时。** Webhook 是通用已验证事件入口，其规则是任意的；IM 对话增加的 channel 身份、Session 连续性与出站路由会给每个 webhook 部署带来负担。连接器消费 webhook 运行时而不改动它。

**持久化 channel 绑定。** 绑定派生自活跃 Session 的入站消息；持久化表需要为下一条消息即可重建的事实引入陈旧治理。

**把连接器挂进随发行版交付的 Web profile。** 那会把 webhook 栈拖进每一次 Web 启动；overlay 保持默认组成不变。

## 后果

- 平台回调现在按 channel 创建或续写一个持久 Session，并经 outbox 按平台消息 id 去重。
- webhook 组获得确认式接口的文档；连接器组、其子系统页与生成的目录记录该 seam。
- 出站触发仍是消费方的决定：seam 路由 `push()`，但不拥有"哪些 Session 事件推送什么"的规则。

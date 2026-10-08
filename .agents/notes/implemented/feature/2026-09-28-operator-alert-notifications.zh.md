# Agent Note：操作员告警通知

Status: implemented

[English](2026-09-28-operator-alert-notifications.md) | 中文

## 问题

会话会产生离开对话的人也应注意到的主机事件：等待输入的审批、长回合结束、计划提醒到期、目标被武装。Desktop 壳与 Web 是不同的部署、不同的呈现通道——Electron 壳能显示原生通知，浏览器能显示 Web Notifications——而此前没有任何东西共享同一套"发出告警"的词汇，每个宿主信号都得各自长出按交互面分别交付的代码。Qoder 对齐（路线图 D11）要求操作员通知。

## 决策

通知以标准三层家族落地在新的 `packages/notification` 组：[dsh-notification](../../../../packages/notification/notification) 接缝（`ctx.notification`：单提供方保留加路由的 `notify` 操作）、交互面提供方 [dsh-notification-desktop](../../../../packages/notification/notification-desktop)（把已接受的告警经 Desktop Host IPC 通道转发给 Electron 壳）与 [dsh-notification-web](../../../../packages/notification/notification-web)（把已接受的告警重发为 `notification/raised` 事件，由 API remote 白名单携往 Client 交互面），以及消费者 [dsh-notification-triggers](../../../../packages/notification/notification-triggers)。

三个立场定义了接缝的合同：

- **一项可选能力、尽力而为的交付。** 通知不属于 agent-loop 主干；未注册提供方时 `notify` 抛出 `NOTIFICATION_UNAVAILABLE`，交付失败只被记录，绝不让提升它的宿主信号失败——调用方把失败视为缺失的提醒。没有任何内容到达模型请求，因此会话日志与 `SessionEventMap` 保持不变。
- **交互面是部署级选择。** 每个 profile 恰好挂载一个提供方（桌面与 Web 补丁互斥），第二次注册是 `NOTIFICATION_CONFLICT`；桌面提供方在缺少 IPC 通道时于加载时失败，而不是退化为静默丢弃告警。
- **策略留在调用方。** 接缝对每个被接受的请求原样路由——没有限流、免打扰时段或内容边界——触发阈值是带 schema 默认值的受验证 `Config` 字段（`approvalWaitSeconds` 60、`turnCompleteMinSeconds` 30，加上按事件的开关），因此部署可以从 cordis.yml 调整告警，settings 交互面无需额外代码即可渲染这些开关。

浏览器半场（[dsh-client-ui-notification](../../../../packages/client/ui-notification)）仅在权限已被授予时经 Web Notification API 呈现每个转发的告警——权限由用户决定，永远不是告警的副作用。

## 已考虑的替代方案

**不经接缝的按交互面分头交付。** 让 schedule、approval 与 goal 信号直接对话 Electron 壳和浏览器会按交互面重复触发逻辑，并让同一部署经两条通道重复通知。一个接缝配一个已挂载提供方，让触发保持交互面中立，并使"每部署只通知一次"成为结构性事实。

**交互面缺失时静默退化。** 没有 IPC 通道就 no-op 的桌面提供方产生的告警与"无可上报"无法区分。误配置改为在加载时显式失败。

**接缝自带限流、免打扰或紧迫度映射。** 这些是调用方拥有的呈现策略；把它们挡在接缝之外，只留一套每个生产者都能提升、而无需知道告警落在何处的词汇（title、body、tag、urgency）。

## 后果

- 每个 profile 恰好挂载一个交互面：桌面是 Electron 通知，Web 是浏览器通知，并在 Client 端受权限门控。
- 告警失败永不影响提升它的宿主信号；浏览器权限未授予的用户只是从 Web 交互面看不到任何东西。
- `docs/subsystems/notification.md` 获得生成的 Cordis API 节，触发开关编目在 `docs/config-catalog.md`，本组出现在 capability-seams、module-graph 与包目录中。

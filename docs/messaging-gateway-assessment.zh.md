# 消息平台网关立项评估

[English](messaging-gateway-assessment.md) | 中文

## 摘要

本评估用于判断扩展 Damon 消息平台网关是否值得单独立项，以及该项目应覆盖的范围。结论：传输 seam 已经存在——[Connector 子系统](subsystems/connector.zh.md)已落地，具备回调验证、持久分发、频道到 Session 的绑定与两个平台适配器——剩余工作是结构化平台交互、双向附件、按发送者授权和更多平台接入。这些都不属于任何一个适配器包的职责，因此需要单独立项。

## 现状

- **路由 seam。** `ctx.connector`（[connector/](../packages/connector/connector/README.zh.md)）拥有 provider 注册表、把每个平台频道派生为一个持久 Session 的入站规则、从 Session 事件出发的出站路由，以及 1:1 的频道-Session 绑定表。[已实现的决策](../.agents/notes/implemented/architecture/2026-09-28-im-connector-seam.zh.md)记录了该 seam 位于 webhook 运行时与平台适配器之间的原因。
- **已验证的入口与持久分发。** [webhook 包族](../packages/webhook/README.zh.md)验证 provider 回调并以完整校验与回滚创建 Session；outbox 增加了 at-least-once 队列，其去重键是平台消息 id，因此重复投递的回调不会运行两次。
- **两个平台适配器。** `connector-feishu` 与 `connector-dingtalk` 拥有各自平台的回调验证、消息翻译与平台投递。
- **Session 侧原语。** 审批等待与用户提问已经产生 Session 事件与 Surface-provider 告警，[notification seam](subsystems/notification.zh.md) 按 profile 路由 Host 告警。

## 差距分析

以下四个差距按其对实际使用的约束程度排序；每一项都是共享词汇或生命周期的变更，而不是某个适配器的局部改动。

1. **结构化出站。** `ConnectorOutboundMessage` 只携带可选 `title` 和必填 `text`。审批等待因此只能以纯文本到达平台，回复也是自由文本，需要适配器去解析。交互卡（飞书卡片、钉钉动作卡片、Slack Block Kit）需要可合并扩展的出站载荷和一条交互回调路由，且回调必须作为持久决议重新进入 Session，而不是被解析成聊天文本。
2. **按发送者授权。** 入站选项对一个 provider 的所有消息应用同一个 `permissionPreset`，`sender` 被记录但未映射。群频道中一名成员替所有人批准文件写入是长期存在的隐患；本项目需要显式的发送者-身份映射，并对审批决议采用默认拒绝的文档化姿态。
3. **附件。** `ConnectorInboundMessage` 仅支持文本，发送到聊天的图片与文档无法到达 Session。入站附件可映射到现有准入词汇（`AttachmentAdmissionPart`）；出站附件需要各适配器的平台上传规则。
4. **平台覆盖。** Telegram、Slack、Discord、企业微信适配器尚不存在。在既有 `ConnectorProvider` 契约下，每个适配器都是一个内聚的包；差距 1–3 确定共享词汇后，覆盖可线性扩展。

## 建议分期

- **P1 — 交互式出站：** 用结构化动作扩展出站词汇，增加决议的入站回调路由，并让两个既有适配器的审批呈现建立在它之上。
- **P2 — 发送者身份与附件：** 增加默认拒绝审批决议的发送者-身份映射，并把入站附件映射到 prompt 准入。
- **P3 — 覆盖：** 在定稿的契约上增加 Telegram、Slack、Discord、企业微信适配器。

## 风险与开放问题

- **安全面。** 公网回调端点是一条远程 prompt 准入路径。回调验证、防重放与发送者映射在 P1 落地前需要拥有安全不变量的人员评审。
- **范围控制。** 交互卡因平台而异；出站载荷必须保持后端无关（provider 拥有渲染，正如今天对文本一样），否则 seam 会退化为最小公分母泄漏。
- **开放问题 — 长轮次体验。** 一次长轮次最终只产生一条回复；中间的工具叙述是否进入聊天、以何种节流进入，是本评估有意留给产品决策的问题。

## 相关文档

- [Connector seam](subsystems/connector.zh.md) — 路由 seam 的类型与语义。
- [Webhook 包图](../packages/webhook/README.zh.md) — 已验证入口、规则与 Session 创建。
- [Notification seam](subsystems/notification.zh.md) — 网关可复用于投递通知的 Host 告警路由。

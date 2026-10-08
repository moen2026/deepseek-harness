---
description: "notification 组地图：操作员告警接缝、其桌面与 Web 交互面提供方及触发规则，面向导航本组的用户与维护者。"
kind: "package-group"
---

# notification/ — 面向会话的操作员告警

[English](README.md) | 中文

## 概述

notification 组呈现操作员告警：一个宿主侧接缝、一个按部署选择的交互面提供方，以及决定何时值得发出告警的触发规则。`ctx.notification` 把单个 `notify` 请求路由给已挂载的提供方——桌面提供方转发到 Electron 壳，Web 提供方重发 `notification/raised` 事件，由 API remote 白名单携往浏览器交互面。告警可选且尽力而为：未挂载提供方时 `notify` 以 `NOTIFICATION_UNAVAILABLE` 失败，交付失败只被记录，绝不让提升它的宿主信号失败。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`notification/`](notification/README.zh.md) | 定义告警接缝：单提供方保留与路由的 `notify` 操作 | `ctx.notification` |
| [`notification-desktop/`](notification-desktop/README.zh.md) | 把已接受的告警经 Desktop Host IPC 通道转发到 Electron 壳 | 注册于 `ctx.notification` |
| [`notification-web/`](notification-web/README.zh.md) | 把已接受的告警重发为 `notification/raised` 事件供浏览器交互面消费 | 注册于 `ctx.notification` |
| [`notification-triggers/`](notification-triggers/README.zh.md) | 观察审批等待、长回合、已投递提醒与已武装目标以发出告警 | 调用 `ctx.notification` |

接缝是一项可选能力，交互面是部署级选择：桌面与 Web 提供方按 profile 互斥，挂载本组永远不需要第二条通知通道。

-----

<a id="related-documentation"></a>
## 相关文档

- [notification 子系统](../../docs/subsystems/notification.zh.md)——本组的注册面与各包的组合方式。
- [配置目录](../../docs/config-catalog.zh.md)——触发规则的受验证配置字段。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>

---
description: "浏览器侧通知交互面：把 Host 提升的提醒经 Web Notification API 呈现，受权限门控。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-notification

[English](README.md) | 中文

## 概述

`dsh-client-ui-notification` 通过浏览器的 Web Notification API 呈现 Host 提升的提醒。每个被接受的提醒经转发的 `notification/raised` 事件到达，插件只在浏览器已为本源授予权限时展示它——请求权限不在本交互面的职责内，也永远不会是提醒的副作用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

通过 web-app 清单加载本插件。node 半场是让包对宿主 Loader 可见的空插件；浏览器半场经 `./client` 导出分发，通过 `dsh.client` 声明被发现，因此普通部署无需额外接线即可挂载——且在 Host 提升提醒之前保持静默。

### 提醒按原样呈现

每个被接受的提醒直接映射为一条 Web Notification：`title` 成为通知标题，`body` 成为正文，可选的 `tag` 原样传递为平台的分组键，浏览器按 tag 合并同类提醒时，后者会替换前者。`urgency` 不映射到任何 Web Notification 选项——该 API 没有显著性概念——因此在本交互面不被使用。

### 权限由用户决定

插件从不弹窗请求权限。仅当 `Notification.permission` 为 `'granted'` 时呈现，其余一律丢弃，包括交互面完全没有 Notification API 的情况；被丢弃的提醒是静默的——不会有错误到达提升它的调用方。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

宿主半场（[`src/index.ts`](src/index.ts)）是让包出现在宿主 cordis.yml 与 Loader 中的空 `apply`；浏览器半场（[`src/client/index.ts`](src/client/index.ts)）注册一个 `ctx.effect`，订阅 `ctx.remote.$on('notification/raised')`。呈现是对提醒与平台构造函数的纯函数，browser-plugin 规范替换该构造函数以观测标题、选项、权限门控与释放。

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 保持包可加载的空宿主半场 |
| [`src/client/index.ts`](src/client/index.ts) | 订阅、权限门与呈现函数 |
| [`tests/browser-plugin.client.spec.ts`](tests/browser-plugin.client.spec.ts) | 基于替换构造函数的呈现与释放用例 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`dsh-notification`](../../notification/notification/README.zh.md) —— 接受提醒的 seam、提供方注册表与 `NotificationRequest` 词汇表。
- [`dsh-notification-web`](../../notification/notification-web/README.zh.md) —— 把已接受的提醒重发为 `notification/raised` 的 Host 侧提供方。
- [`dsh-api-remotes`](../../api/remotes/README.zh.md) —— 把白名单宿主事件转发到 Client 交互面的 Remote 层。

-----

<a id="model-experience"></a>
## 模型体验

无。本包向人类呈现 Host 提升的提醒，不触碰任何提示词、消息、schema、流或工具结果。

#### KV 缓存影响

无；本包从不组装或发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定当前包约束，不是任务清单。

- **从不请求权限**——插件只在用户已授予权限处呈现；弹窗请求属于本交互面之外的交互式工作。
- **`urgency` 没有 Web 映射**——Web Notification API 不暴露显著性控制，所有紧迫度呈现一致。
- **点击无动作**——已呈现的通知不携带进入会话的点击跳转。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作语境——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包不持有跨插件可变状态，也不发出 Cordis 事件；其唯一的 effect 注册——对 `notification/raised` 的订阅——通过 browser-plugin 规范验证了资源释放行为。

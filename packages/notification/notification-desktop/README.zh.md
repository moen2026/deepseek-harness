---
description: "DeepSeek Harness 通知接缝的桌面展示面提供方——保留 ctx.notification 并把每个被接受的告警作为一条 desktop-notification 消息经 Desktop Host IPC 通道转发，由 Electron 壳触发平台原生通知。"
kind: "package-reference"
---

# @deepseek-ai/dsh-notification-desktop

[English](README.md) | 中文

## 概述

使用 `dsh-notification-desktop` 为桌面部署提供原生操作者告警：它保留 `ctx.notification`，把每个被接受的告警作为一条 `desktop-notification` 消息经 Desktop Host IPC 通道转发，由 Electron 壳触发平台原生通知。在没有该通道处挂载会在加载时失败，而不是静默丢弃告警。它是两个展示提供方之一——浏览器部署选择 [dsh-notification-web](../notification-web/README.zh.md)——并且需要 [dsh-notification](../notification/README.zh.md) 以及诸如 [dsh-notification-triggers](../notification-triggers/README.zh.md) 的告警发出规则才能做事。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与推迟工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Desktop Host 进程中挂载本提供方。它是 [dsh-notification](../notification/README.zh.md) 的展示提供方：它说接缝的提供方合同，拥有它转发的 IPC 消息，自身不定义路由、触发或偏好。

### 何时选用

当操作者告警必须经桌面壳的原生通知展示时，选用本提供方。Host 进程没有自己的告警展示面；提供方把每条告警交给 Host 自身的 IPC 通道，Electron 壳接收后原生触发平台通知。没有桌面壳的部署挂载另一提供方——接缝只容纳一个。

### 组合通知栈

```yaml
- name: '@deepseek-ai/dsh-notification'
- name: '@deepseek-ai/dsh-notification-triggers'
- name: '@deepseek-ai/dsh-notification-desktop'
```

### 转发的消息

每个被接受的请求变成一条 `DesktopAlertMessage`：一个 `type: 'desktop-notification'` 标记、请求的 `title` 与 `body`，以及仅当调用方提供时才出现的请求 `tag` 与 `urgency`。缺省字段在线路上保持缺省，因此壳侧看到的正是调用方发出的告警。

### 失败与恢复

Host IPC 通道缺失时，`apply` 在加载时以 `NOTIFICATION_UNAVAILABLE` 失败——在 Desktop Host 之外挂载桌面提供方是配置错误，而不是静默无操作。越过这一点后提供方是同步的：`notify` 把消息交给通道并 resolve；壳如何展示它——焦点、权限、声音、点击行为——仍是壳侧的事。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释提供方背后的设计决策及其在代码中的位置；可观察行为见[使用本包](#use-this-package)。

### 设计理念

- **展示提供方角色。** 本包拥有一个展示面：以稳定 id `desktop` 声明 `ctx.notification` 并应答 `notify`；告警何时发出归调用规则，接缝词汇保持固定。
- **以 Host IPC 为投递路径。** Host 进程自身的 `process.send` 就是通道；提供方以绑定到 `process` 的方式调用它，因此消息经壳已校验为平台事件的同一通道传递。
- **失败即响的挂载。** 通道缺失在加载时抛错，而不是静默丢弃告警——配置错误绝不能退化为"通知永远不到"。
- **缺省即缺省。** 可选请求字段从消息中省略而不是以 `undefined` 转发，因此线上消息携带调用方的确切字段。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`createDesktopNotificationProvider`、`apply`、`DesktopAlertMessage` |
| — | 不发布运行时不变式伴生入口；提供方不持有可供独立比较的状态——它转发接缝已接受的内容，保留的错用已由接缝失败即响地拒绝。 |

### 通道与错误传播

`apply` 在加载时确认 Host IPC 通道存在，缺失即失败即响；此后每条告警以方法调用 `process.send` 转发，原生发送器保持其接收者，之后关闭的通道在调用点自行暴露。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级合同不够时阅读这些页面。它们从本提供方回到它所服务的接缝与发出告警的规则。

- [dsh-notification](../notification/README.zh.md)——本提供方保留的接缝及其转发的请求词汇。
- [dsh-notification-triggers](../notification-triggers/README.zh.md)——观察宿主事件并经接缝发出告警的规则。
- [dsh-notification-web](../notification-web/README.zh.md)——无桌面壳部署的浏览器展示面提供方。
- [notification 组地图](../README.zh.md)——包家族与其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

无，展示提供方不注册任何面向模型的内容。

#### KV Cache 效应

无；本提供方既不组装也不发送提供方请求。

## 已知限制与推迟工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义提供方当前的范围。它们是包约束，不是任务清单。

- **仅限桌面壳**——提供方需要 Desktop Host IPC 通道，缺失时加载即失败；浏览器部署改为挂载 `dsh-notification-web`。
- **无投递回执**——`notify` 在消息离开 Host 后 resolve；壳是否展示、合并或抑制通知在接缝之外。
- **无紧急度映射**——消息原样携带请求的 `urgency` 提示；把它映射到平台重要度是壳侧的取舍。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>

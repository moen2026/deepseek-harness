---
description: "DeepSeek Harness 通知接缝的浏览器展示面提供方——保留 ctx.notification 并把每个被接受的告警再发布为进程内 notification/raised 事件，交由 API remote 转发白名单携带到 Client 展示面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-notification-web

[English](README.md) | 中文

## 概述

使用 `dsh-notification-web` 面向展示面是浏览器的部署：它保留 `ctx.notification`，把每个被接受的告警再发布为 `notification/raised` 宿主事件。Host 自身不呈现任何内容——事件就是交接点，[API remote 转发白名单](../../api/remotes/README.zh.md) 把它携带到 Client 展示面，由后者经浏览器通知 API 呈现。它与 [dsh-notification](../notification/README.zh.md) 以及诸如 [dsh-notification-triggers](../notification-triggers/README.zh.md) 的告警发出规则组合；桌面部署改为挂载 [dsh-notification-desktop](../notification-desktop/README.zh.md)。

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

在 Host 进程中挂载本提供方；它只增加再发布这一跳，别无其他。它是 [dsh-notification](../notification/README.zh.md) 的展示提供方：它说接缝的提供方合同，自身不定义路由、触发或呈现。

### 何时选用

当部署的展示面是由 Host 服务的浏览器会话时选用本提供方——Web profile，或任何没有桌面壳的部署。提供方自身不需要任何浏览器能力：它把被接受的告警发布为进程内事件，呈现在监听它的 Client 展示面发生。浏览器的权限模型在 Client 门控视觉通知，而不是在这里。

### 组合通知栈

```yaml
- name: '@deepseek-ai/dsh-notification'
- name: '@deepseek-ai/dsh-notification-triggers'
- name: '@deepseek-ai/dsh-notification-web'
```

### 再发布的事件

`notification/raised(alert)` 携带与调用方发出时完全一致的 `NotificationRequest`——接缝已接受的同一请求，而不是渲染后的消息。事件由接缝声明，因此 Host 与 Client 对"发出了什么"共享同一套词汇。

### 失败与恢复

本提供方不新增失败模式：再发布是进程内 emit，`notify` 按接缝合同 resolve。事件到达无监听处时——白名单没有条目、Client 展示面未挂载——告警只是不被展示；接缝的尽力而为合同已覆盖该结果。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释提供方背后的设计决策及其在代码中的位置；可观察行为见[使用本包](#use-this-package)。

### 设计理念

- **再发布，不呈现。** 提供方只拥有第一跳——把被接受的请求变成进程内事件；呈现它是 Client 展示面的事，两跳保持可独立替换。
- **接缝声明的词汇。** `notification/raised` 事件声明在接缝定义其请求词汇之处，因此不认识该事件的构建是拒绝而不是猜测。
- **白名单携带这一跳。** 哪些事件从 Host 到 Client 由 `dsh-api-remotes` 白名单决定，而不是本提供方；提供方无条件 emit，使转发策略保持唯一。
- **无隐藏策略。** 提供方不检查任何东西——不按 `tag` 去重、无免打扰时段、无紧急度过滤；每个被接受的请求原样再发布。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`createWebNotificationProvider`、`apply`、`WEB_PROVIDER_ID` |
| — | 不发布运行时不变式伴生入口；提供方不持有可供独立比较的状态——它再发布接缝已接受的内容，emit 就是它的全部效果。 |

### 两跳路径

到浏览器的投递横跨三个组件：本提供方在 Host 中发布 `notification/raised`，`dsh-api-remotes` 转发白名单把该事件声明为面向 Client，Client 展示面——Web 客户端的通知 UI——经浏览器通知 API 呈现它。每一跳归其包所有，因此部署可以替换呈现而不触碰告警如何发出。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级合同不够时阅读这些页面。它们从本提供方移动到它所服务的接缝、发出告警的规则，以及把事件携带到 Client 的白名单。

- [dsh-notification](../notification/README.zh.md)——本提供方保留的接缝及其再发布所用的词汇。
- [dsh-notification-triggers](../notification-triggers/README.zh.md)——观察宿主事件并经接缝发出告警的规则。
- [dsh-notification-desktop](../notification-desktop/README.zh.md)——桌面部署的原生通知提供方。
- [dsh-api-remotes](../../api/remotes/README.zh.md)——把 `notification/raised` 声明为面向 Client 的转发白名单。
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

- **再发布，不呈现**——只挂载本提供方在浏览器中不显示任何东西；转发白名单条目与 Client 展示面必须同时存在。
- **Host 不处理权限**——浏览器权限状态是 Client 的事，Host 既不观察也不请求。
- **无回执**——Client 的呈现结果从不回到 Host，因此接缝保持发出即忘的合同。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>

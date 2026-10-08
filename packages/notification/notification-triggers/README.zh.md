---
description: "DeepSeek Harness 通知接缝的告警发出规则——观察等待中的审批、长时间回合完成、已投递的定时提醒与进入 armed 的目标，并把每个信号作为提供方无关的告警交给 ctx.notification。"
kind: "package-reference"
---

# @deepseek-ai/dsh-notification-triggers

[English](README.md) | 中文

## 概述

使用 `dsh-notification-triggers` 把宿主状态变化变成操作者告警：它观察四个信号——审批等待超过阈值、回合在最短时长后完成、定时提醒被投递、目标进入 armed——并经 [dsh-notification](../notification/README.zh.md) 把每个信号作为提供方无关的告警发出。每条规则都是带 schema 默认值的可配置开关或阈值，因此设置页无需额外代码即可呈现这些旋钮。插件不注册工具、不注册任何面向模型的内容；失败的告警被记录，而不会让触发它的宿主信号失败。把它与接缝和一个展示提供方——[dsh-notification-desktop](../notification-desktop/README.zh.md) 或 [dsh-notification-web](../notification-web/README.zh.md)——一起挂载。

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

在接缝挂载之处挂载这些规则。它是 [dsh-notification](../notification/README.zh.md) 的消费者：它定义哪些状态变化值得告警并经接缝发出；告警如何到达操作者是提供方的事。

### 何时选用

当等待中的审批、长时间回合、已投递的提醒或 armed 目标应当无须有人盯着对话记录就到达操作者时选用它。没有挂载提供方时告警仍会发出但会被记录为未送达；没有本插件时接缝保持沉默。

### 组合通知栈

```yaml
- name: '@deepseek-ai/dsh-notification'
- name: '@deepseek-ai/dsh-notification-triggers'
- name: '@deepseek-ai/dsh-notification-desktop'
```

### 配置

| 字段 | 默认值 | 作用 |
|---|---|---|
| `approvalWaitSeconds` | 60 | 审批可等待多少秒后发出告警。 |
| `turnCompleteMinSeconds` | 30 | 触发告警的最短回合时长（秒）；更短的回合保持沉默。 |
| `notifyScheduled` | true | 已投递的定时提醒是否发出告警。 |
| `notifyGoalActivation` | true | 目标进入 armed 是否发出告警。 |

schema 自带每个默认值，因此 Loader 解析缺省，设置页无需额外代码即可把这些字段作为用户偏好呈现。

### 每条规则发出的告警

| 信号 | 告警标题 | 告警 tag |
|---|---|---|
| 审批超过阈值仍在等待 | `Approval is waiting` | `approval:<callId 或 agent id>` |
| 回合完成且达到最短时长 | `Turn finished` | `turn:<sessionId>` |
| 定时提醒已投递 | `Reminder delivered` | `schedule:<scheduleId>` |
| 目标进入 armed | `Goal armed` | `goal:<sessionId>` |

### 失败与恢复

告警是尽力而为的：发出的告警绝不阻塞它所报告的状态变化，`notify` 的拒绝被记录为 `notification-triggers: alert was not delivered: …`，而不是向外传播。审批定时器经过 `unref`，因此等待中的告警绝不会让进程保持存活。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释规则背后的设计决策及其在代码中的位置；可观察行为见[使用本包](#use-this-package)。

### 设计理念

- **规则，而不是通道。** 插件观察宿主事件并调用接缝；投递机制、平台能力检查与回退行为归已挂载的提供方。
- **阈值即配置。** 每个随部署而变的数字都是带 schema 默认值的受校验 `Config` 字段——不是常量——因此部署可以从 cordis.yml 与偏好页重新调整告警。
- **尽力而为的发出。** `notify` 以即发即弃方式调用；拒绝被记录，因此坏掉的提供方绝不能让触发告警的审批、回合、投递或目标信号失败。
- **按会话追踪回合。** 回合开始时间放在一个以 `SessionId` 为键的进程内 `Map`；`api-session/removed` 删除条目，已关闭的会话绝不留下泄漏。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`name`、`inject`、`Config`、含四条告警规则的 `apply` |
| — | 不发布运行时不变式伴生入口；规则除回合映射外不持有独立可观察状态，而已发布的告警本身就是接缝的可观察事件。 |

### 事件与规则

| 事件 | 规则 |
|---|---|
| `approval/request`（waterfall） | 为每个进行中的决策武装一个 `approvalWaitSeconds` 定时器，随后 await `next()`；定时器在 `finally` 中清除，因此先到的决策保持沉默。 |
| `api-session/status` | `running: true` 时记录开始时刻；完成时仅在经过秒数达到 `turnCompleteMinSeconds` 时发出。 |
| `api-session/removed` | 删除该会话记录的开始时刻，之后完成的回合不再发出任何内容。 |
| `schedule/delivered` | 发出提醒告警，受 `notifyScheduled` 门控。 |
| `goal/activation-changed` | 仅对 `activation: 'armed'` 发出目标告警，受 `notifyGoalActivation` 门控。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级合同不够时阅读这些页面。它们从规则出发，回到它喂养的接缝与投递其告警的展示面。

- [dsh-notification](../notification/README.zh.md)——这些规则调用的接缝及其构建的请求词汇。
- [dsh-notification-desktop](../notification-desktop/README.zh.md)——桌面部署上投递告警的桌面展示面提供方。
- [dsh-notification-web](../notification-web/README.zh.md)——无桌面壳部署的浏览器展示面提供方。
- [notification 组地图](../README.zh.md)——包家族与其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

无，告警规则不注册任何面向模型的内容。

#### KV Cache 效应

无；本插件既不组装也不发送提供方请求。

## 已知限制与推迟工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义规则当前的范围。它们是包约束，不是任务清单。

- **无投递保证或重试**——被拒绝的告警被记录并丢弃；接缝只路由一次，规则从不重发。
- **固定的告警文案**——标题与正文是规则自己拥有的固定英文；面向操作者的展示本地化留给展示提供方及其壳。
- **仅进程内追踪**——回合开始时刻是进程内的、不持久化；Host 重启会忘记进行中的回合。
- **依赖插件的信号**——定时提醒与目标规则仅在 `dsh-schedule` 或 `dsh-goal` 挂载并发出相应事件时触发。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>

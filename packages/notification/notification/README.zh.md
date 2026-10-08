---
description: "通知能力接缝（ctx.notification）：单提供方保留注册表加一条与顺序无关的路由——notify——作用于与提供方无关的告警，面向为部署组合或扩展操作者提醒的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-notification

[English](README.md) | 中文

## 概述

使用 `dsh-notification` 为部署提供一个操作者告警通道：`notify` 路由接受标题、正文以及可选的去重与紧急度提示，并交给已注册的提供方，因此平台的投递机制永远不会改变消费者发出告警的方式。单个提供方独占保留接缝且注册是原子的：无效或冲突的声明不发布任何内容。与 `dsh-notification-triggers` 以及 `dsh-notification-desktop` 或 `dsh-notification-web` 之类的展示提供方组合使用；单独存在时不响应任何调用并抛出 `NOTIFICATION_UNAVAILABLE`。接缝不提供投递保证——告警是否展示取决于平台。

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

挂载服务、展示提供方以及发出告警的规则。本包是这些包注册与调用的服务；它自身不定义展示、触发或偏好。

### 何时选用

当部署希望从宿主事件发出操作者告警——定时的 follow-up 到期、审批等待超过阈值、一轮对话结束、目标达到标记——而不让每个调用方学习平台的告警 API 时，选用本服务。它只覆盖一条路由——notify——投递机制归提供方所有；请求词汇由接缝固定，因此替换提供方不会改变调用方发出告警的方式。接缝是宿主能力：它不注册任何面向模型的内容。

### 组合通知栈

接缝需要提供方与调用方才能做事。最小组合挂载服务、触发规则与展示提供方：

```yaml
- name: '@deepseek-ai/dsh-notification'
- name: '@deepseek-ai/dsh-notification-triggers'
- name: '@deepseek-ai/dsh-notification-desktop'
```

规则拥有告警何时发出，提供方拥有它如何展示；见 [dsh-notification-triggers](../notification-triggers/README.zh.md)、[dsh-notification-desktop](../notification-desktop/README.zh.md) 与 [dsh-notification-web](../notification-web/README.zh.md)。

### 操作

`notify(request, signal?)` 接受一个 `NotificationRequest`——必填的 `title` 与 `body`，加上可选的 `tag`（用于去重）与可选的 `urgency`（`low`、`normal`、`critical`）——并在提供方接受告警后 resolve。接缝不施加任何速率限制、免打扰策略或内容边界，因此这些策略归调用方。

### 失败与恢复

未注册提供方时，调用以结构化错误 `NOTIFICATION_UNAVAILABLE` 失败——挂载提供方或继续不作提醒。无效或冲突的注册在发布任何路由之前就以 `NOTIFICATION_INVALID_PROVIDER` 或 `NOTIFICATION_CONFLICT` 失败，平台侧故障以 `NOTIFICATION_PROVIDER_FAILED` 失败。调用方捕获 `NotificationError` 并依据其稳定的 `code` 路由；提醒是尽力而为的，因此调用方把失败视为缺少一次提醒，而不是丢失任务。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释接缝背后的设计决策及其在代码中的位置；可观察行为见[使用本包](#use-this-package)。

### 设计理念

- **能力接缝，Service Definition 角色。** 本包拥有 `ctx.notification` 与提供方注册表；提供方说平台协议，不说规则，告警何时发出由 `dsh-notification-triggers` 拥有。
- **整部署独占保留。** 同一时刻只有一个提供方持有接缝；告警通道是整部署的选择，因此第二次注册是冲突而不是共存的第二条路由。
- **原子注册。** `registerProvider()` 在变更之前先校验并检查冲突：无效或冲突的注册不发布任何内容，其释放器解除保留。
- **与顺序无关的路由。** 路由经 `ctx.effect()` 转发给唯一已注册的提供方，因此保留随注册 fiber 一同存亡；注册与 HMR 顺序永远不改变由哪个提供方应答。
- **封闭、与提供方无关的词汇。** 请求字段在各平台之间固定——新增一项精化是接缝、提供方与调用方之间的编译期联动变更。没有协议逃生门。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Notification` 服务、`registerProvider`/`notify`、`NotificationError` 错误码 |
| [`src/types.ts`](src/types.ts) | 接缝词汇：请求、提供方与服务合同 |
| — | 不发布运行时不变式伴生入口；提供方保留是私有的、以原子方式更新的状态；该接缝既不公开可枚举快照，也不公开可供独立比较的生命周期事件。 |

### 注册与释放生命周期

注册与释放经 `ctx.effect()` 运行，因此提供方路由随注册 fiber 一同存亡。`registerProvider()` 返回同步释放器；接缝丢弃该 effect 总是 resolve 的 promise，使释放器 API 保持同步。`NotificationError` 扩展 `HarnessError`，携带稳定代码（`NOTIFICATION_INVALID_PROVIDER`、`NOTIFICATION_CONFLICT`、`NOTIFICATION_UNAVAILABLE`、`NOTIFICATION_PROVIDER_FAILED`），调用方依据它们路由而不是解析 `message`。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级合同不够时阅读这些页面。它们从共享的告警路由移动到发出告警的规则与两个展示提供方。

- [dsh-notification-triggers](../notification-triggers/README.zh.md)——观察宿主事件并经本接缝发出告警的规则。
- [dsh-notification-desktop](../notification-desktop/README.zh.md)——把告警转发到 Electron 壳的桌面提供方。
- [dsh-notification-web](../notification-web/README.zh.md)——把告警转发到浏览器展示面的 Web 提供方。
- [notification 组地图](../README.zh.md)——包家族与其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

无，宿主告警接缝不注册任何面向模型的内容。

#### KV Cache 效应

无；本包既不组装也不发送提供方请求。

## 已知限制与推迟工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义接缝当前的范围。它们是包约束，不是任务清单。

- **每运行时单提供方**——告警通道是整部署的声明，因此第二次注册是冲突而不是共存。若一个告警必须送达多个展示面，预期的扩展是在接缝之上做部署配置的分发。
- **无投递回执**——`notify` 在提供方接受告警后 resolve；平台权限或焦点状态仍可能抑制视觉展示，接缝不观察这一点。
- **无速率或免打扰策略**——去重策略、免打扰时段与按来源开关归调用规则；接缝不检查地路由每一次被接受的调用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>

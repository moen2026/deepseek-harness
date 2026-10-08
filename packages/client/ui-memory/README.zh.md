---
description: "Web 记忆中心：右侧边栏列出本部署存储的记忆条目的页面，并附 memory_write 调用的 Turn 卡片。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-memory

[English](README.md) | 中文

## Summary

一个右侧边栏页面类型，列出本部署存储的记忆条目，展示每条内容的文本、创建日期、命名空间与标签，并支持删除条目、在 Remote 确认后刷新。未配置记忆提供方的部署会渲染明确的不可用状态，而不是一次读取失败。本包还从原始会话事件派生，为已完成的 `memory_write` 工具调用渲染逐 Turn 卡片。

## Table of Contents

- [Use this package（使用本包）](#use-this-package)
- [Understand the implementation（理解实现）](#understand-the-implementation)
- [Further Exploration（延伸阅读）](#further-exploration)
- [Model Experience（模型体验）](#model-experience)
- [Known Limitations and Deferred Work（已知限制与延期工作）](#known-limitations-and-deferred-work)
- [Dev Note（开发备注）](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package（使用本包）

随附的 Web bundle 将本包与 Host 记忆组一同挂载。侧边栏引导页承载记忆中心入口；点击它即打开页面，页签文字读取该命名空间的标签。每一行展示存储的文本、按查看者语言格式化的创建日期（无法解析的时间戳回退为存储原值）、可选的命名空间，以及标签。删除操作在删除进行期间禁用，该行保留可见直到一次权威读取确认移除。读取失败时保留最后已知记录并提供重试。写入与搜索记忆仍是模型侧工具操作；页面无法创建或编辑内容。在会话中，回复之后的 Turn 卡片列出该 Turn 已完成的 `memory_write` 调用产生的记忆条目。

<a id="understand-the-implementation"></a>
## Understand the implementation（理解实现）

<details>
<summary>实现细节 — 点击展开</summary>

浏览器入口分两阶段注册页类型 `@deepseek-ai/dsh-client-ui-memory`（kind 为 `memory`）：先把定义注册到 `ctx.sidebarRightTabs`（携带打开它的引导入口），再把正文注册到该定义 id 对应的 `sidebar.right.pane.tab` 键位。一个 catalog source 支撑整个页面，构建于 Remote 面 `ctx.remote.memory`（`status`、`list`、`forget`）之上，以连接重置事件为失效来源。每次读取先探测 `status`：未持有的 seam 以 `available: false` 结束页面且不发起列表读取，因此不可用状态不会与重试即可消除的查询失败混淆。删除遵循共享 catalog 模式：Remote 调用期间挂起标记、向调用方解决 `deleted`/`failed`/`pending` 之一，确认移除后发起全新读取而不是搭上可能更早发出的读取。订阅只在框架观察该 source 期间存在；最后一次取消订阅会释放重置监听并使在途响应失效。Turn 卡片注册一个会话节点定义，按 Turn 累积 `tool_memory` 的 `memory_write` 调用——匹配调用、收窄完成的结果 JSON、丢弃畸形或非 ok 的载荷——并以 `memory-remembered` 键发布到 `ConversationTurnDataMap`；一个 `conversation.chat.turnTail` 键位渲染卡片，以 Turn 记录的结束序号为界。Host 面（[@deepseek-ai/dsh-memory/browser](../../memory/memory/README.zh.md)）路由到 `ctx.memory`，自身不持有存储。

本包不发布运行时 invariant companion，因为目录呈现 Host 拥有的存储记忆，自身只拥有可丢弃的查询和删除交互状态。

</details>

<a id="further-exploration"></a>
## Further Exploration（延伸阅读）

- [Memory](../../memory/memory/README.zh.md) 拥有 seam、存储 provider 与模型侧工具。
- [Slots](../../../docs/subsystems/slots.zh.md) 记录注入的钩子与面板贡献。

<a id="model-experience"></a>
## Model Experience（模型体验）

无；本浏览器 UI 不注册面向模型的工具或消息，记忆召回由记忆工具服务。

#### KV Cache effect

无。目录呈现与 Turn 卡片不进入模型请求。

## Known Limitations and Deferred Work（已知限制与延期工作）

<a id="known-limitations-and-deferred-work"></a>

- 页面列出整个存储，无搜索或过滤；相关记忆的发现仍由模型侧记忆工具承担。
- 删除是硬删除：provider 移除存储的条目，页面不提供撤销或归档。

<a id="dev-note"></a>
### Dev Note（开发备注）

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

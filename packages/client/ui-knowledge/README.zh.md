---
description: "Web 知识中心：右侧边栏列出本部署存储的知识文档的页面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-knowledge

[English](README.md) | 中文

## Summary

一个右侧边栏页面类型，列出本部署存储的知识文档，展示文档标题、创建日期、来源与正文摘录，并支持删除文档、在 Remote 确认后刷新。未配置知识提供方的部署会渲染明确的不可用状态，而不是一次读取失败。

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

随附的 Web bundle 将本包与 Host 知识组一同挂载。侧边栏引导页承载知识中心入口；点击它即打开页面，页签文字读取该命名空间的标签。每一行展示存储的标题、按查看者语言格式化的创建日期（无法解析的时间戳回退为存储原值）、可选的来源，以及正文的两行摘录。删除操作在删除进行期间禁用，该行保留可见直到一次权威读取确认移除。读取失败时保留最后已知记录并提供重试。摄取与搜索仍是模型侧操作；页面无法写入语料内容。

<a id="understand-the-implementation"></a>
## Understand the implementation（理解实现）

<details>
<summary>实现细节 — 点击展开</summary>

浏览器入口分两阶段注册页类型 `@deepseek-ai/dsh-client-ui-knowledge`（kind 为 `knowledge`）：先把定义注册到 `ctx.sidebarRightTabs`（携带打开它的引导入口），再把正文注册到该定义 id 对应的 `sidebar.right.pane.tab` 键位。一个 catalog source 支撑整个页面，构建于 Remote 面 `ctx.remote.knowledge`（`status`、`list`、`remove`）之上，以连接重置事件为失效来源。每次读取先探测 `status`：未持有的 seam 以 `available: false` 结束页面且不发起列表读取，因此不可用状态不会与重试即可消除的查询失败混淆。删除遵循共享 catalog 模式：Remote 调用期间挂起标记、向调用方解决 `deleted`/`failed`/`pending` 之一，确认移除后发起全新读取而不是搭上可能更早发出的读取。订阅只在框架观察该 source 期间存在；最后一次取消订阅会释放重置监听并使在途响应失效。Host 面（[@deepseek-ai/dsh-knowledge/browser](../../knowledge/knowledge/README.zh.md)）路由到 `ctx.knowledge`，自身不持有存储。

本包不发布运行时 invariant companion，因为目录呈现 Host 拥有的存储文档，自身只拥有可丢弃的查询和删除交互状态。

</details>

<a id="further-exploration"></a>
## Further Exploration（延伸阅读）

- [Knowledge](../../knowledge/knowledge/README.zh.md) 拥有 seam、SQLite provider 与模型侧工具。
- [Slots](../../../docs/subsystems/slots.zh.md) 记录注入的钩子与面板贡献。

<a id="model-experience"></a>
## Model Experience（模型体验）

无；本浏览器 UI 不注册面向模型的工具或消息，知识文档查询由知识工具服务。

#### KV Cache effect

无。目录呈现不进入模型请求。

## Known Limitations and Deferred Work（已知限制与延期工作）

<a id="known-limitations-and-deferred-work"></a>

- 页面列出整个语料，无搜索或过滤；相关文档的发现仍由模型侧知识工具承担。
- 删除是硬删除：provider 移除存储的文档，页面不提供撤销或归档。

<a id="dev-note"></a>
### Dev Note（开发备注）

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

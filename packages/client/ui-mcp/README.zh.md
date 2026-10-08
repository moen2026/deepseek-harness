---
description: "Web MCP 面板：右侧边栏列出本部署连接的 MCP 服务器及其工具与资源的页面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mcp

[English](README.md) | 中文

## Summary

一个右侧边栏页面类型，列出本部署连接的 MCP 服务器，展示每台服务器面向模型的工具名称及其报告的资源（URI、显示名称、MIME 类型）。资源发现不被支持或读取失败的服务器在标注说明后保留其工具列表；未连接任何服务器的部署渲染明确的不可用状态，而不是一次读取失败。本面板只呈现已有的发现状态；连接服务器与读取资源仍由连接插件和模型侧资源工具承担。

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

base 配置在 `mcp-resources` 旁挂载 Host `mcp-browser` 面，随附的 Web bundle 在名册中挂载本包。侧边栏引导页承载面板入口；点击它即打开页面，页签文字读取该命名空间的标签。每一台服务器一行，展示配置的服务器名、每个已注册的 `mcp__<server>__<raw>` 工具的片签（悬停显示描述），以及服务器报告的第一页资源（含 URI 与 MIME 类型）。`resourcesNote` 会取代资源列表：服务器未报告资源，或读取失败——包括不支持资源发现的服务器。读取失败时保留最后已知的服务器并提供重试。会话内的资源读取经由普通工具呈现；面板不新增第二条连接路径，也没有面向模型的外观。

<a id="understand-the-implementation"></a>
## Understand the implementation（理解实现）

<details>
<summary>实现细节 — 点击展开</summary>

浏览器入口分两阶段注册页类型 `@deepseek-ai/dsh-client-ui-mcp`（kind 为 `mcp`）：先把定义注册到 `ctx.sidebarRightTabs`（携带打开它的引导入口），再把正文注册到该定义 id 对应的 `sidebar.right.pane.tab` 键位。一个 catalog source 支撑整个页面，构建于 Remote 面 `ctx.remote.mcp`（`status`、`servers`）之上，以连接重置事件为失效来源。每次读取先探测 `status`：无服务器的部署以 `available: false` 结束页面且不发起服务器读取，因此不可用状态不会与重试即可消除的查询失败混淆。订阅只在框架观察该 source 期间存在；最后一次取消订阅会释放重置监听并使在途响应失效。Host 面（[@deepseek-ai/dsh-mcp-resources/browser](../../mcp/mcp-resources/README.zh.md)）读取资源运行时的全局服务器层与工具注册表视图，每台服务器的资源页来自一次合成的 `resources/list` 执行，连接只读取其取消信号；单台服务器读取失败降级为 `failed` 说明，不拖垮整个列表。

本包不发布运行时 invariant companion，因为面板呈现服务器报告的发现状态，自身只拥有可丢弃的读取交互状态。

</details>

<a id="further-exploration"></a>
## Further Exploration（延伸阅读）

- [MCP resources](../../mcp/mcp-resources/README.zh.md) 拥有资源运行时、共享资源工具与浏览器 Remote 面。
- [Slots](../../../docs/subsystems/slots.zh.md) 记录注入的钩子与面板贡献。

<a id="model-experience"></a>
## Model Experience（模型体验）

无；本浏览器 UI 不注册面向模型的工具或消息，模型由资源工具和各服务器的工具服务。

#### KV Cache effect

无。面板呈现不进入模型请求。

## Known Limitations and Deferred Work（已知限制与延期工作）

<a id="known-limitations-and-deferred-work"></a>

- 面板展示每台服务器报告的第一页资源；翻页与模板展开仍由模型侧资源工具承担。
- 服务器连接状态反映读取时刻的注册表成员关系，不是实时传输健康度；连接断开表现为其工具的执行失败。

<a id="dev-note"></a>
### Dev Note（开发备注）

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

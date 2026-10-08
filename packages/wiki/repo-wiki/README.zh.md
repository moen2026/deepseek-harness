---
description: "仓库 wiki 能力接缝（ctx.repoWiki）：单提供方保留注册表加三条只读路由——getPage、listPages、outline——作用于生成的 Markdown wiki 页面，面向组合或扩展 agent 仓库文档的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-repo-wiki

[English](README.md) | 中文

## 概述

使用 `dsh-repo-wiki` 为 agent 提供整合生成的仓库文档视图：作用于 wiki 页面的只读路由，每页由 wiki 相对 `.md` 路径标识，携带标题、staleness（过期）标志与生成的 Markdown 正文。单个提供方独占保留接缝且注册是原子的：无效或冲突的声明不发布任何内容。接缝只暴露读路由——写页面完全归提供方私有。与 `dsh-repo-wiki-generator` 之类的提供方和面向模型的 `dsh-tool-repo-wiki` 组合使用；单独存在时抛出 `REPO_WIKI_UNAVAILABLE`。源已变化的页面以 `stale` 元数据读回，永远不会被自动重写。

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

当你希望 agent 基于生成、整合的文档回答仓库问题时挂载本接缝；注册一个提供方来填充它。

### 提供方合同

提供方实现 `RepoWikiProvider`：不透明的 `id` 加三条读路由——`getPage(path)` 返回一页完整内容、`listPages()` 返回按路径排序的每页摘要、`outline()` 返回每页的标题结构。提供方拥有页面生成、存储与 staleness 追踪；这些都不出现在接缝上。

### 页面词汇表

页面是 `WikiPage`：wiki 相对 `.md` `path`、由页面首个一级标题派生的人类可读 `title`、`stale` 标志，以及完整的 Markdown `content`。摘要（`WikiPageSummary`）去掉正文；大纲条目（`WikiOutlineEntry`）加上页面 `#` 前缀的标题行（按文档顺序）。清单（`WikiListing`）是每页摘要的有序集合。

### 路径归一化

路径在接缝处归一化：`normalizeWikiPath` 去空白、把反斜杠转换为正斜杠，并拒绝空白路径、不带 `.md` 后缀的路径、绝对路径与任何含 `..` 的路径，因此读取永远不会逃出 wiki 根目录。

### 失败

`RepoWikiError` 扩展 `HarnessError`，携带稳定代码：`REPO_WIKI_INVALID_PROVIDER`（提供方 id 为空白）、`REPO_WIKI_CONFLICT`（接缝已被占用）、`REPO_WIKI_UNAVAILABLE`（未注册提供方）、`REPO_WIKI_INVALID_PATH`（页面路径畸形）与 `REPO_WIKI_NOT_FOUND`（该路径无页面）。调用方依据 `code` 路由，而不是解析 `message`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释接缝背后的设计决策及其在代码中的位置；可观察行为见[使用本包](#use-this-package)。

### 设计注记

- **单提供方保留。** wiki 是对整个仓库的声明，因此接缝被占用时的第二次注册抛出 `REPO_WIKI_CONFLICT`；释放器解除保留，读路由重新报告 `REPO_WIKI_UNAVAILABLE`。
- **变更前先校验与冲突检查。** `registerProvider` 在发布任何内容之前检查 id 与保留状态，被拒绝的注册使接缝保持原样。
- **经 `ctx.effect` 原子发布。** 提供方与其释放器在一个 effect 内一起填充与清除，因此路由始终有活的提供方；同步释放器 API 丢弃该 effect 总是 resolve 的 promise。
- **读取先归一化再路由。** `getPage` 在接缝处归一化路径，因此提供方收到规范路径，畸形输入在提供方代码运行之前就以 `REPO_WIKI_INVALID_PATH` 呈现。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`RepoWiki` 服务、提供方保留与路由读操作 |
| [`src/types.ts`](src/types.ts) | 页面词汇表、提供方合同、错误码与路径归一化 |
| — | 不发布运行时不变式伴生入口；提供方保留是私有的、以原子方式更新的状态；该接缝既不公开可枚举快照，也不公开可供独立比较的生命周期事件。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级合同不够时阅读这些页面。它们从接缝移动到其提供方与面向模型的消费者。

- [仓库 wiki 子系统](../../../docs/subsystems/repo-wiki.zh.md)——三包拆分、存储布局与 staleness 语义的整体语境。
- [`dsh-repo-wiki-generator`](../repo-wiki-generator/README.zh.md)——从工作区源生成页面并服务本接缝读路由的文件系统提供方。
- [`dsh-tool-repo-wiki`](../tool-repo-wiki/README.zh.md)——把本接缝变成 agent 能力的面向模型 `read_wiki` 工具。
- [工具 Schema 目录](../../../docs/tool-catalog.zh.md)——贡献给 `ctx.tools` 的每个工具，包括 `read_wiki`。

<a id="model-experience"></a>
## 模型体验

间接地，通过 `dsh-tool-repo-wiki`——它拥有面向模型的 `read_wiki` schema、提示词指引与渲染结果，而本注册表自身不贡献任何提示词或 schema。

#### KV Cache 效应

无直接失效；`dsh-tool-repo-wiki` 拥有请求前缀变更。

## 已知限制与推迟工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义接缝何时是糟糕的匹配。它们是当前的包约束，不是任务清单。

- **单提供方**——接缝只持有一个提供方；没有按目录树路由或回退链。
- **只读面**——接缝不暴露生成或写路由；填充 wiki 完全是提供方的私有关注点。
- **无提供方即无应答**——未注册提供方时，每条路由抛出 `REPO_WIKI_UNAVAILABLE`；没有内置的空 wiki。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>

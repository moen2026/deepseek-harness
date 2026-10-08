---
description: "作用于 ctx.repoWiki 接缝的面向模型 read_wiki 工具：读取一页生成的 wiki 页面（或其标题大纲）、列出整个 wiki，并看到每页的 staleness，未挂载提供方时返回可操作的不可用应答，面向组合仓库文档工作流的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-repo-wiki

[English](README.md) | 中文

## 概述

`dsh-tool-repo-wiki` 为模型提供作用于 `ctx.repoWiki` 的一个工具：`read_wiki` 读取一页生成的 wiki 页面的完整 Markdown 内容（可选为标题大纲），或不带参数列出每页的路径、标题与 staleness 标志。在 repo-wiki 提供方挂载之前工具不可用；没有提供方时它返回可操作的"repo wiki 不可用"消息，而不是让会话失败。生成后源已变化的页面携带 staleness 提示，使模型在需要精确性时可对照活动文件验证。该包仅运行时注入 `tools`、`repoWiki` 与 `systemPrompt`，不导入任何提供方。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与推迟工作](#known-limitations-and-deferred-work)
- [开发注记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当模型需要整合的仓库文档时调用 `read_wiki`；工具的提示词指引告诉它回答架构问题前先查 wiki，而在能力未配置时回退到 search/read。

### 工具

`read_wiki` 接受可选的 `path` 与可选的 `outline` 标志。省略 `path` 列出每页；仅 `path` 返回一页完整内容；`path` 加 `outline=true` 则返回该页的标题结构。参数在接缝之前修剪并校验——空白或非 `.md` 路径、或没有 `path` 的 `outline`，都是可操作的参数错误而不是崩溃。

### 模型得到什么

清单渲染每页一行 `path — title [stale]`；大纲在每行 `path — title` 下加该页缩进的 `#` 前缀标题行；页面读取渲染页面的 Markdown 内容，生成后源已变化时加 `[stale: …]` 前缀提示。空 wiki 渲染 `The wiki has no pages yet.`。所有渲染都以 `maxResultChars` 为界，截断提示计入上限。没有提供方挂载时，渲染是可操作的不可用消息而不是错误。

### 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `maxResultChars` | `16000` | 最大完整渲染结果，含截断提示 |
| `timeoutMs` | `30000` | 工具调用超时预算，覆盖一次提供方读取 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-repo-wiki)是每个可接受字段的穷尽来源。

### 失败与恢复

来自接缝的 `REPO_WIKI_UNAVAILABLE` 被捕获并返回为 `status: 'unavailable'`，使会话继续运行。`REPO_WIKI_NOT_FOUND`（请求路径无页面，包括大纲请求）与任何其他 `RepoWikiError` 作为模型可读、可路由的结构化工具错误传播。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释工具背后的设计决策及其在代码中的位置；可观察行为见[使用本包](#use-this-package)。

### 设计注记

- **纯消费者。** 工具仅运行时注入 `tools`、`repoWiki` 与 `systemPrompt`，不导入提供方，也不传递取消信号——一次 wiki 读取快速且幂等。
- **接缝前的参数归一化。** `parseReadWikiArgs` 修剪输入并强制 `.md` 后缀与 `outline`-需要-`path` 规则，因此提供方收到规范请求，畸形输入是可操作错误而不是崩溃。
- **可用性是数据，不是崩溃。** `execute` 捕获代码为 `REPO_WIKI_UNAVAILABLE` 的 `RepoWikiError` 并返回 `unavailable` 状态；任何其他错误重新抛出，真正损坏的提供方仍被呈现。
- **有界渲染。** `boundResult` 限制完整渲染文本，截断提示计入上限。
- **并发安全读取。** `read_wiki` 返回 `isConcurrencySafe: () => true`——只读路由，无共享可变状态。
- **search 类调用卡。** `presentReadWikiCall` 渲染 `{ card: 'generic', kind: 'search', title }`——页面读取为 `Read wiki: <path>`，清单为 `Read wiki: list pages`。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：config schema、提示词节、`read_wiki` 注册与执行 |
| [`src/render.ts`](src/render.ts) | 纯参数校验、带结果上限的清单/大纲/页面渲染、UI 呈现 |
| — | 不发布运行时不变式伴生入口；该无状态适配器提供一个工具和一个提示词区段，而页面生命周期与 staleness 关系仍由它所组合的 repo-wiki 接缝负责。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级合同不够时阅读这些页面。它们从面向模型的面移动到接缝与提供方。

- [仓库 wiki 子系统](../../../docs/subsystems/repo-wiki.zh.md)——三包拆分、存储布局与 staleness 语义的整体语境。
- [`dsh-repo-wiki`](../repo-wiki/README.zh.md)——本工具读取所经的接缝。
- [`dsh-repo-wiki-generator`](../repo-wiki-generator/README.zh.md)——生成并存储本工具所服务页面的提供方。
- [工具 Schema 目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-repo-wiki)——本页记录的生成 schema。

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到什么

一个系统提示词节（一方 order 2260）把 wiki 定位在仓库阅读工具之中，文本如下：

##### 逐字指引

```markdown
Before answering questions about this repository's architecture, packages, or documented behavior, check read_wiki: the repo wiki holds generated, consolidated pages (with a per-page heading outline) that are cheaper to read than re-deriving the same picture from source. Pages marked stale may be outdated — verify against the live files when precision matters. The wiki is unavailable until a repo-wiki provider is configured; then fall back to search/read.
```

#### Token 效应

插件活动期间每个请求的固定指引成本。

#### KV Cache 效应

插件作用域与指引文本不变时前缀稳定；激活或释放可能使本节的重用失效。

### 工具 Schema

#### 模型看到什么

模型看到生成的 [`read_wiki` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-repo-wiki)。

#### Token 效应

启用期间每个请求的固定 schema 成本；`timeoutMs` 预算从不发给模型。

#### KV Cache 效应

可见工具定义与顺序不变时前缀稳定；注册生命周期或作用域限制可能从第一个变更的 schema token 起使重用失效。

### 结果

#### 模型看到什么

清单渲染每页一行 `path — title [stale]`；大纲在每行下加缩进标题；页面读取渲染页面的 Markdown，源已变化时带 stale 提示。所有渲染以 `maxResultChars` 为界。没有提供方挂载时，结果是可操作的不可用消息而不是错误。

#### Token 效应

无论 wiki 多大，每个渲染结果都受 `maxResultChars` 限制。

#### KV Cache 效应

工具结果追加在缓存请求前缀之后，不直接使其失效。

### UI 呈现

#### 模型看到什么

无。客户端渲染通用卡——`{ card: 'generic', kind: 'search', title }`——标题为 `Read wiki: <path>` 或 `Read wiki: list pages`；没有渲染目标，因此不附加位置。

#### Token 效应

零直接 token 效应，因为渲染只在客户端。

#### KV Cache 效应

无；UI 呈现位于模型请求之外。

## 已知限制与推迟工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义工具何时是糟糕的匹配。它们是当前的包约束，不是任务清单。

- **提供方门控可用性**——未挂载 repo-wiki 提供方时工具总是返回不可用消息；它自己从不生成页面，因此部署必须挂载 `dsh-repo-wiki-generator`（或其他提供方）才有真实内容。
- **每次调用一页或一次清单**——读多页是多次调用；没有多页参数。
- **无写入或搜索面**——工具只读页面、大纲与清单；没有 wiki 侧搜索，文本搜索属于工作区工具。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>

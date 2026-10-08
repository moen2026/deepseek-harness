---
description: "文件系统 repo-wiki 提供方（dsh-repo-wiki-generator）：经部署配置的 LLM 路由从工作区源文档生成 Markdown wiki 页面，在 front matter 中记录每页的源指纹，并从 <root>/.dsh/wiki/ 服务 ctx.repoWiki 的读路由。"
kind: "package-reference"
---

# @deepseek-ai/dsh-repo-wiki-generator

[English](README.md) | 中文

## 概述

使用 `dsh-repo-wiki-generator` 填充 repo-wiki 接缝：它遍历配置的源 glob，经部署的 LLM 路由为每个源生成一页整合的 Markdown wiki 页面，并从 `<root>/.dsh/wiki/` 下的普通文件服务接缝的读路由。每页的 front matter 记录其源路径与生成时指纹，因此已变化的源以 `stale` 读回——生成器永远不会在读者背后重写页面，重新生成只在显式启动时运行。页面是可直接阅读、可提交到 Git 供团队共享的普通 Markdown。

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

以工作区根与一条 LLM 路由挂载插件；它保留接缝并默认在启动时开启一轮重新生成。

### 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `root` | *（必填）* | wiki 描述的绝对工作区根，页面也存储在其下 |
| `outDir` | `.dsh/wiki` | 相对 `root` 的 wiki 存储目录 |
| `sources` | `['docs/subsystems/*.md', 'packages/*/README.md', 'packages/*/*/README.md']` | 源文档的 glob 模式，相对 `root` |
| `llmProvider` | *（必填）* | 拥有生成路由的 LLM 提供方名称 |
| `llmModel` | *（必填）* | 用于生成的 LLM 模型名称 |
| `maxSourceChars` | `24000` | 每次生成调用的最大源摘录，按字符计 |
| `maxTokens` | `4096` | 生成调用的输出 token 预算 |
| `timeoutMs` | `300000` | 每次生成调用的超时预算（ms） |
| `regenerateAt` | `startup` | `apply` 是否在启动时开启一轮重新生成（`startup` 或 `never`） |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-repo-wiki-generator)是每个可接受字段的穷尽来源。

### 存储布局与 staleness

每个源成为一页扁平页面（例如 `packages/wiki/tool-repo-wiki/README.md` 变为 `packages-wiki-tool-repo-wiki-README.md`）；非字母数字串折叠为连字符。页面是带 front-matter 块的 Markdown，记录 `dsh-wiki-source`（工作区相对源路径）与 `dsh-wiki-fingerprint`（生成时取的 size 加 mtime 指纹）。读取把记录的指纹与源当前的 stat 比较，因此 staleness 不需要旁表；front matter 不完整的页面仍可读，只是标记为 `stale`。一轮重新生成为新源或已变源生成页面、保持匹配页面不动，并删除源已消失的页面。启动时重新生成失败会被吞掉，因此坏掉的 LLM 路由永远不会阻塞启动。

### 失败

一次生成调用超过 `timeoutMs` 时呈现 `REPO_WIKI_GENERATION_TIMEOUT`。模型响应不含文本内容是错误——该轮经被吞掉的启动路径上报，或拒绝调用方的 `regenerate` promise。畸形配置（非正整数、空白 `outDir`）在插件加载时大声失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释提供方背后的设计决策及其在代码中的位置；可观察行为见[使用本包](#use-this-package)。

### 设计注记

- **staleness 是元数据，不是触发器。** 生成器不会因为源变化而重写页面；重新生成只在一轮运行时发生，在此之前读者看到的是 `stale: true` 加未变的内容。
- **front matter 是唯一的记账。** 源路径与指纹存放在每页内部，因此 wiki 是自描述的、可作为普通文件阅读，并且无需数据库即可经 Git 共享。
- **每源一页，每页一次调用。** `buildGenerationRequest` 用固定系统提示词框定一份截断的源摘录，要求写出一页保留具体事实的独立页面；`extractText` 拒绝空响应而不是写出空页面。
- **确定性助手保持纯函数。** 命名、（反）序列化、指纹、提示词构造与大纲提取都在 `pages.ts`，在不涉 I/O 或 LLM 的情况下单测。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：config schema、`FsWikiProvider` 注册与重新生成轮 |
| [`src/pages.ts`](src/pages.ts) | 纯助手：页面命名、front-matter（反）序列化、指纹、提示词框定、大纲提取 |
| — | 不发布运行时不变式伴生入口；wiki 目录、页面 front matter 与重新生成轮是私有实现状态，且该提供方不发布独立的生命周期事件流或可枚举快照。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级合同不够时阅读这些页面。它们从提供方移动到其填充的接缝与暴露它的工具。

- [仓库 wiki 子系统](../../../docs/subsystems/repo-wiki.zh.md)——三包拆分、存储布局与 staleness 语义的整体语境。
- [`dsh-repo-wiki`](../repo-wiki/README.zh.md)——本提供方保留并服务的接缝。
- [`dsh-tool-repo-wiki`](../tool-repo-wiki/README.zh.md)——读取本生成器所写页面的面向模型 `read_wiki` 工具。

<a id="model-experience"></a>
## 模型体验

无，因为该提供方生成并存储 wiki 页面，不向 agent 模型请求贡献任何内容；`dsh-tool-repo-wiki` 拥有面向模型的 schema 与渲染。

#### KV Cache 效应

无效应；该提供方不向 agent 模型请求贡献任何内容。

## 已知限制与推迟工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义提供方何时是糟糕的匹配。它们是当前的包约束，不是任务清单。

- **每源文档一页**——wiki 的粒度跟随其源；生成器不能把多个源合并为一页，也不能把一个源拆到多页。
- **size 加 mtime 指纹**——保持大小不变的 touch 会把页面标为 stale，而同时保留大小与 mtime 的编辑则让它保持新鲜；内容哈希被推迟。
- **启动失败静默**——启动重新生成轮失败按设计被吞掉，使启动永不阻塞；观察页面的 `stale` 标志，而不是期待错误上报。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>

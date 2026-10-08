---
description: "面向模型的 create_document 工具，覆盖 ctx.documents seam 与 ctx.fs：把标题与内容块发给已保留的提供方，把生成的 Office 字节持久写入 Session 工作区，并经共享 deliverables 链声明文件；未挂载提供方时返回可操作的不可用应答，供组合 Office 文档生成能力的用户与维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-document

[English](README.md) | 中文

## 概述

`dsh-tool-document` 给模型一个覆盖 `ctx.documents` 的工具：`create_document` 把标题与有序内容块发给已保留的提供方，把生成的字节持久写入 Session 工作区中调用方指定、永不覆盖的路径，并经共享的 `deliverables/presented` 链——与 `present` 工具相同的展示路径——声明该文件，让模型与用户都看到生成了什么。未挂载提供方时，它返回可操作的"文档生成不可用"消息而不是让会话失败。本包只运行时注入 `tools`、`fs`、`documents`、`systemPrompt` 与 `sessionProjections`，不导入任何提供方。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当用户要 Word、Excel 或 PowerPoint 文件时，模型调用 `create_document`；能力未配置时，工具的提示指导它改写纯文本文件。

### 工具

`create_document` 接收必填的 `format`（`docx`、`xlsx` 或 `pptx`）、`title`、`file_path` 与有序 `blocks`（heading、text、bullets、table 或 chartPlaceholder 对象）。它在触碰 seam 之前把每个 block 校验进 seam 的中立词汇表，畸形输入是可操作的参数错误而不是崩溃。提供方选择、引擎与限额在模型输入之外；它们属于挂载的提供方。

### 模型得到什么

工具返回封闭结果：`status` `ok` 携带 `path`（后端解析的工作区路径）、`mediaType` 与 `bytes`，或 `unavailable`。渲染输出 `<type>document</type>` envelope，说明路径、media type 与字节数，并在工具结果落定时声明交付。被占用的 `file_path` 永不覆盖既有文件——它以可操作的"换一个 file_path"消息失败。未挂载提供方时，渲染结果是可操作的不可用消息而不是错误。

### 配置

| Key | Default | Meaning |
|---|---|---|
| `timeoutMs` | `180000` | 工具调用超时预算，覆盖一次引擎转换 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-document)是所有接受字段的穷尽来源。

### 失败与恢复

seam 的 `DOCUMENTS_UNAVAILABLE` 被捕获并返回为 `status: 'unavailable'`，会话继续运行。`FS_NOT_OBSERVED`（目标路径已有文件）变成可操作的重试消息，绝不触碰持久历史。任何其他错误——提供方失败、无效请求——作为结构化工具错误向上传播，模型可读可路由。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

本节解释工具背后的设计决策及其在代码中的落点；可观察行为见 [Use this package](#use-this-package)。

### 设计笔记

- **纯 Consumer。** 工具只运行时注入 `tools`、`fs`、`documents`、`systemPrompt` 与 `sessionProjections`，不导入任何提供方，只把 `exec.signal` 传给 seam。
- **seam 之前完成参数规范化。** `parseCreateDocumentArgs` 修剪标量并以可操作的字段名拒绝畸形 block，提供方收到的是规范请求。
- **只创建，不覆盖。** 生成的字节经 `fs.writeBytes` 以 `createIfAbsent` 意图写入，被占用的路径是可操作错误，文件带着 `fs/observed` 版本记录落入工作区。
- **落定后交付。** 与 `present` 一样，`deliverables/presented` 事件在工具结果落定时追加，声明只属于成功的调用，并携带已落定的 turn 号。
- **可用性是数据，不是崩溃。** `execute` 捕获 seam 的 `DOCUMENTS_UNAVAILABLE` 并返回 `unavailable` 状态；其他所有错误重新抛出，真正坏掉的提供方仍会浮出。
- **generic 卡片呈现。** `presentCreateDocumentCall` 渲染 `{ card: 'generic', kind: 'other', title }`，标题为请求的文件名。

### 源码地图

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：config schema、prompt section、`create_document` 注册与执行、交付追加 |
| [`src/render.ts`](src/index.ts) | 纯参数校验、生成文档 envelope、UI 呈现 |
| [`src/types.ts`](src/types.ts) | 交付事件复用：`deliverables/presented` 声明由 present 工具的包持有 |
| — | 不发布运行时不变式伴生入口；该无状态适配器提供一个工具和一个提示词区段，而创建生命周期与结果关系仍由它所组合的 documents seam 负责。 |

</details>

-----

<a id="further-exploration"></a>
## 深入探索

当包级契约不够时读这些页面。它们从面向模型的表面走向 seam 与提供方。

- [dsh-documents](../documents/README.zh.md) — 本工具查询的 seam。
- [dsh-office-create](../office-create/README.zh.md) — 应答生成的提供方。
- [document group map](../README.zh.md) — 包家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示

#### What the model sees

一个 system-prompt section（第一方 order 2457）定位生成工具及其可选性，文本如下：

##### Verbatim guidance

```markdown
Use create_document to produce an Office file (Word DOCX, Excel XLSX, or PowerPoint PPTX) from a title and content blocks. It is unavailable until a documents provider is configured — then write plain text files instead, for example by suggesting the user configure one.
```

#### Token effect

插件活跃期间每个请求的固定指导成本。

#### KV Cache effect

插件作用域与指导文本不变时前缀稳定；激活或释放可能使本节的复用失效。

### 工具模式

#### What the model sees

模型看到生成的 [`create_document` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-document)。

#### Token effect

启用期间每个请求的固定 schema 成本；`timeoutMs` 预算从不发送给模型。

#### KV Cache effect

可见工具定义与顺序不变时前缀稳定；注册生命周期或作用域限制可能从第一个变更的 schema token 起使复用失效。

### 结果

#### What the model sees

ok 结果渲染 `<type>document</type>` envelope，说明工作区路径、media type 与字节数，交付声明随会话的 `deliverables/presented` 事件。未挂载提供方时，结果是可操作的不可用消息而不是错误。

#### Token effect

envelope 由其说明的路径与 media type 限制；生成的字节从不进入会话。

#### KV Cache effect

工具结果追加在缓存请求前缀之后，不直接使其失效。

### UI 呈现

#### What the model sees

无。客户端渲染 generic 卡片——`{ card: 'generic', kind: 'other', title }`——标题为 `Create document: <file name>`；文档本身经 deliverables 链渲染，与 `present` 结果一样。

#### Token effect

渲染只在客户端，零直接 token 效应。

#### KV Cache effect

无；UI 呈现位于模型请求之外。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义工具何时是糟糕选择。它们是当前包约束，不是任务清单。

- **提供方门控的可用性** — 未挂载文档提供方时工具总返回不可用消息；它自己从不产出字节，部署必须挂载 `dsh-office-create`（或其他提供方）才能得到真实文档。
- **只创建新文件** — 工具创建工件、从不编辑既有文件；修订文档是不同能力，这里没有路由。
- **每次调用一个文件** — 多文档请求是多次调用；结果只建模单一工作区路径。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

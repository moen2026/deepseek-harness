---
description: "文档生成能力 seam（ctx.documents）：单提供方保留注册表与一条顺序无关的路由——create——接收中立内容块、产出 Office 文档字节，供组合或扩展 agent Office 文件生成能力的用户与维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-documents

[English](README.md) | 中文

## 概述

用 `dsh-documents` 给 agent 提供 Office 文件生成：一条 `create` 路由接收格式、标题与有序内容块，返回提供方的文档字节及其 media type，后端的引擎、中间格式与排版策略永远不会改变请求或结果。单一提供方独占保留 seam，注册是原子的：无效或冲突的声明不发布任何内容。与 `dsh-office-create` 这样的提供方及面向模型的 `dsh-tool-document` 组合使用；单独挂载时不响应任何请求并抛出 `DOCUMENTS_UNAVAILABLE`。它自己不持有引擎，也不渲染字节。

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

挂载 documents 提供方与 `create_document` 工具，让模型产出 DOCX、XLSX 或 PPTX 文件。本包是这些包注册所 against 的服务；它自己不定义 UI、工具或生成后端。

### 何时选择它

当部署希望模型可见的 Office 文档生成由模型从不构建或寻址的引擎支撑时选择本服务。它只覆盖一条路由——create——引擎与排版归提供方持有；请求形状与结果形状由 seam 固定，更换提供方不会改变模型看到的内容或提问方式。

### Composing a documents stack

seam 需要提供方与 consumer 才能工作。最小组合挂载服务、本地引擎提供方与工具：

```yaml
- name: '@deepseek-ai/dsh-documents'
- name: '@deepseek-ai/dsh-office-create'
- name: '@deepseek-ai/dsh-tool-document'
```

引擎、中间格式与限额在提供方包中配置；见 [dsh-office-create](../office-create/README.zh.md) 与 [dsh-tool-document](../tool-document/README.zh.md)。

### The operation

`create(request, signal?)` 接收 `DocumentCreateRequest`——必填的 `format`（`docx`、`xlsx` 或 `pptx`）、`title` 与有序 `blocks`——返回 `DocumentResult`，即原始文档 `data` 字节、其可解码的 `mediaType`。block 是 seam 的中立、模板无关词汇表：`heading`、`text`、`bullets`、`table` 与 `chartPlaceholder`。seam 不设定超时或字节上限；consumer 持有这些预算，并在呈现之前经 filesystem 服务把字节持久提交。

### 失败与恢复

未注册提供方时，请求以结构化错误 `DOCUMENTS_UNAVAILABLE` 失败——挂载提供方，或者不使用文档生成。无效或冲突的注册在任何路由发布之前以 `DOCUMENTS_INVALID_PROVIDER` 或 `DOCUMENTS_CONFLICT` 失败，畸形请求以 `DOCUMENTS_INVALID_REQUEST` 失败，后端故障以 `DOCUMENTS_PROVIDER_FAILED` 失败。consumer 捕获 `DocumentsError` 并依据稳定的 `code` 路由；经工具时，未挂载的 seam 表现为模型可读的可操作不可用应答。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

本节解释 seam 背后的设计决策及其在代码中的落点；可观察行为见 [Use this package](#use-this-package)。

### 设计理念

- **能力 seam，Service Definition 角色。** 本包持有 `ctx.documents` 与提供方注册表；提供方持有引擎与中间表示而非工具，`dsh-tool-document` 是面向模型表面的唯一持有者。
- **整格式独占保留。** 一次只有一个提供方持有 seam；生成后端声明部署的 Office 流水线，因此第二次注册是冲突而不是并存路由。
- **原子注册。** `registerProvider()` 在任何变更前完成校验与冲突检查：无效或冲突的注册不发布任何内容，其 disposer 释放保留。
- **顺序无关路由。** 路由经 `ctx.effect()` 转发到唯一已注册的提供方，保留随注册 fiber 生死；注册与 HMR 顺序从不改变哪个提供方应答。
- **封闭、提供方无关的词汇表。** 请求与结果形状跨后端固定——新增 block kind 是跨 seam、提供方与工具的编译期强制变更。没有协议逃生舱。

### 源码地图

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Documents` 服务、`registerProvider`/`create`、`DocumentsError` 代码 |
| [`src/types.ts`](src/types.ts) | seam 词汇表：blocks、请求、结果、提供方与服务契约 |
| — | 不发布运行时不变量伴随；提供方保留是私有的原子更新状态；seam 既不暴露可枚举快照，也没有可独立对比的生命周期事件。 |

### Registration and disposal lifecycle

注册与释放经 `ctx.effect()` 运行，提供方路由随注册 fiber 生死。`registerProvider()` 返回同步 disposer；seam 丢弃总是 resolved 的 effect promise，让 disposer API 保持同步。`DocumentsError` 扩展 `HarnessError`，携带稳定代码（`DOCUMENTS_INVALID_PROVIDER`、`DOCUMENTS_CONFLICT`、`DOCUMENTS_UNAVAILABLE`、`DOCUMENTS_DISPOSED`、`DOCUMENTS_INVALID_REQUEST`、`DOCUMENTS_PROVIDER_FAILED`），调用方依据代码路由而不是解析 `message`。

</details>

-----

<a id="further-exploration"></a>
## 深入探索

当包级契约不够时读这些页面。它们从共享的生成模型走向提供方与工具。

- [dsh-office-create](../office-create/README.zh.md) — 在本 seam 上注册的 LibreOffice kit 驱动提供方。
- [dsh-tool-document](../tool-document/README.zh.md) — 覆盖本 seam 的面向模型工具。
- [document group map](../README.zh.md) — 包家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

间接地，经 `dsh-tool-document`——它持有面向模型的 `create_document` schema、提示指导与结果渲染，本注册表自身不贡献任何 prompt 或 schema。

#### KV Cache effect

无直接失效；`dsh-tool-document` 持有请求前缀变更。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义 seam 当前的范围。它们是包约束，不是任务清单。

- **单提供方** — 生成后端是整格式声明，第二次注册是冲突而不是并存。若未来需要多提供方路由，预期的扩展是注册之上的部署配置选择器。
- **一条路由，无编辑** — seam 只暴露 `create`；打开、编辑或转换既有文档是不同能力（转换由 `office-to-pdf` 覆盖），这里没有路由。
- **无超时或字节上限** — seam 不设上限，consumer 持有字节预算，提供方持有引擎超时。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

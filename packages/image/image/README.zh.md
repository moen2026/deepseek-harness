---
description: "图像生成能力 seam（ctx.image）：单提供方保留注册表加一条顺序无关路由——generate——面向文本提示（可附参考图 URL）与原始图像字节，供组合或扩展面向 Agent 的文生图能力的用户与维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-image

[English](README.md) | 中文

<a id="summary"></a>
## 概述

使用 `dsh-image` 赋予 Agent 文生图能力：一条 `generate` 路由接收文本提示加可选的尺寸、数量与参考图精修，返回提供方的图像字节及其媒体类型，后端的端点、模型与凭据永远不会改变请求或结果。单一提供方排他保留 seam，注册是原子的：无效或冲突的声明不发布任何内容。与提供方（如 `dsh-image-http`）和面向模型的 `dsh-tool-image` 组合使用；单独时它不回答任何请求并抛出 `IMAGE_UNAVAILABLE`。它绝不代表调用方选择生成模型。

<a id="table-of-contents"></a>
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

挂载图像提供方与 `generate_image` 工具，让模型从文本提示创建图像。本包是这些包注册的服务；它自身不定义 UI、工具或生成后端。

### 何时选择它

当部署需要由模型从不构建或寻址的端点支撑的、面向模型的图像生成时，选择本服务。它只覆盖一条路由——generate——协议与凭据归提供方；请求形态、尺寸提示与结果元数据由 seam 固定，更换提供方不会改变模型所见或其请求方式。

### 组合图像栈

seam 需要提供方和 consumer 才能工作。最小组合挂载服务、HTTP 提供方与工具：

```yaml
- name: '@deepseek-ai/dsh-image'
- name: '@deepseek-ai/dsh-image-http'
  config:
    url: https://example.invalid/v1/images/generations
    model: image-1
    authEnv: DSH_IMAGE_API_KEY
- name: '@deepseek-ai/dsh-tool-image'
```

端点、模型与凭据变量在提供方包中配置；见 [dsh-image-http](../image-http/README.zh.md) 与 [dsh-tool-image](../tool-image/README.zh.md)。

### 操作

`generate(request, signal?)` 接收 `ImageGenerateRequest`——必填的文本 `prompt` 加可选的 `size`、`n` 与 `referenceImages`（引导生成的公网可达参考图 URL）——返回 `ImageResult`，即原始图像 `data` 字节、其可解码的 `mediaType`、可选的提供方报告 `revisedPrompt`，以及提供方把生成拆分为图层时的 `layers`（按 `zIndex` 自底向上排序，最低层即 `data` 字节承载的合成背景）。seam 不设超时或大小上限，因此没有 `resolve()` 步骤；这些预算由 consumer 持有，字节经 attachment 服务持久提交。

### 失败与恢复

未注册提供方时，请求以结构化错误 `IMAGE_UNAVAILABLE` 失败——挂载提供方或继续不使用生成。无效或冲突的注册在任何路由发布之前以 `IMAGE_INVALID_PROVIDER` 或 `IMAGE_CONFLICT` 失败，对已释放提供方的操作以 `IMAGE_DISPOSED` 失败，畸形请求以 `IMAGE_INVALID_REQUEST` 失败，后端失败以 `IMAGE_PROVIDER_FAILED` 失败。consumer 捕获 `ImageError` 并依据其稳定 `code` 路由；经工具时，未挂载的 seam 表现为模型可读的可操作不可用应答。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

本节解释 seam 背后的设计决策及其代码落点；可观察行为见 [Use this package](#use-this-package)。

### 设计理念

- **能力 seam，Service Definition 角色。** 本包持有 `ctx.image` 与提供方注册表；提供方提交提示并说端点协议，而不是工具，`dsh-tool-image` 是面向模型面的唯一持有者。
- **排他的整语料保留。** 一次只有一个提供方持有 seam；生成后端声明部署的文生图管线，第二次注册是冲突而不是并存路由。
- **原子注册。** `registerProvider()` 在变更前完成全部校验与冲突检查：无效或冲突的注册不发布任何内容，其 disposer 释放保留。
- **顺序无关路由。** 路由经 `ctx.effect()` 转发到单一已注册提供方，保留随注册 fiber 生死；注册与 HMR 顺序不会改变应答的提供方。
- **封闭、提供方无关的词汇。** 请求与结果形态跨后端固定——新增精修是跨 seam、提供方与工具的编译期强制变更。没有协议逃生口。

### 源码地图

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Image` 服务、`registerProvider`/`generate`、`ImageError` 代码 |
| [`src/types.ts`](src/types.ts) | seam 词汇：请求、结果、提供方与服务契约 |
| — | 未发布运行时不变量伴侣；提供方保留是私有的原子更新状态；seam 既不暴露可枚举快照也不暴露可独立比较的生命周期事件。 |

### 注册与释放生命周期

注册与释放经 `ctx.effect()` 运行，提供方路由随注册 fiber 生死。`registerProvider()` 返回同步 disposer；seam 丢弃始终 resolved 的 effect promise 以保持 disposer API 同步。`ImageError` 扩展 `HarnessError`，携带稳定代码（`IMAGE_INVALID_PROVIDER`、`IMAGE_CONFLICT`、`IMAGE_UNAVAILABLE`、`IMAGE_DISPOSED`、`IMAGE_INVALID_REQUEST`、`IMAGE_PROVIDER_FAILED`），调用方依据代码路由而不是解析 `message`。

</details>

-----

<a id="further-exploration"></a>
## 深入探索

当包级契约不够时阅读这些页面。它们从共享的生成模型走向提供方与工具。

- [dsh-image-http](../image-http/README.zh.md) — 向本 seam 注册的 OpenAI 兼容 HTTP 提供方。
- [dsh-image-wuyinkeji](../image-wuyinkeji/README.zh.md) — 向本 seam 注册的异步任务提供方。
- [dsh-tool-image](../tool-image/README.zh.md) — 本 seam 上面向模型的工具。
- [image 组地图](../README.zh.md) — 四包家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

间接影响；面向模型的模式与渲染由 `dsh-tool-image` 持有，本注册表自身不贡献任何提示或 schema。

#### KV Cache 影响

无直接影响；`dsh-tool-image` 持有请求前缀变更。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义 seam 的当前范围。它们是包约束，不是任务清单。

- **每运行时单提供方** —— 一个生成后端是整语料声明，第二次注册是冲突而不是并存。若未来需要多提供方路由，注册之上的部署配置选择器是预期的扩展点。
- **单路由，无编辑** —— seam 只暴露 `generate`；图像编辑或变体端点是不同能力，这里没有路由。
- **无尺寸或数量上限** —— seam 不设上限，consumer 持有字节与数量预算，提供方持有端点超时。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

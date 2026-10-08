---
description: "语音转写能力接缝（ctx.audio）：单提供者独占注册表与一条顺序无关的路由——transcribe——以原始音频字节为输入，面向组合或扩展智能体语音转写能力的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-audio

[English](README.md) | 中文

## 概述

使用 `dsh-audio` 为智能体提供语音转文本能力：唯一的 `transcribe` 路由接收原始音频字节与可选的格式、语言修饰，并返回提供者的转写文本，使后端的端点、模型与凭据永远不改变请求与结果。单个提供者独占接缝，注册是原子的：无效或冲突的声明不会发布任何内容。将它与 `dsh-audio-http` 之类的提供者和面向模型的 `dsh-tool-audio` 组合使用；单独存在时它不应答任何请求并抛出 `AUDIO_UNAVAILABLE`。它不会替调用者选择转写模型。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [深入探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

挂载音频提供者与 `transcribe_audio` 工具，让模型把工作区音频文件转成文本。本包是这些包注册所依赖的服务；它自身不定义任何 UI、工具或转写后端。

### 何时选择它

当部署希望获得由模型从不构建、从不寻址的端点支撑的、模型可见的转写能力时，选择本服务。它覆盖一条路由——转写——协议与凭据由提供者持有；请求形态、媒体类型提示与转写元数据由接缝固定，因此替换提供者不会改变模型看到的内容或提问方式。

### 组合音频栈

接缝需要提供者与消费者才能工作。最小组合挂载服务、HTTP 提供者与工具：

```yaml
- name: '@deepseek-ai/dsh-audio'
- name: '@deepseek-ai/dsh-audio-http'
  config:
    url: https://example.invalid/v1/audio/transcriptions
    model: whisper-1
    authEnv: DSH_AUDIO_API_KEY
- name: '@deepseek-ai/dsh-tool-audio'
```

端点、模型与凭据变量在提供者包中配置；参见 [dsh-audio-http](../audio-http/README.zh.md) 与 [dsh-tool-audio](../tool-audio/README.zh.md)。

### 该操作

`transcribe(request, signal?)` 接收 `AudioTranscribeRequest`——必需的 `data` 字节载荷加上可选的 `fileName`、`mediaType`、`language`、`prompt`——并返回 `AudioTranscript`，即识别文本与可选的提供者报告的 `language`、`durationSec`。接缝不设超时、字节上限或格式过滤，因此没有 `resolve()` 步骤；这些边界由消费者持有。

### 失败与恢复

未注册提供者时，请求以结构化错误 `AUDIO_UNAVAILABLE` 失败——挂载提供者或继续无转写的会话。无效或冲突的注册在任何路由发布前以 `AUDIO_INVALID_PROVIDER` 或 `AUDIO_CONFLICT` 失败，对已释放提供者的操作以 `AUDIO_DISPOSED` 失败，畸形请求以 `AUDIO_INVALID_REQUEST` 失败，后端失败以 `AUDIO_PROVIDER_FAILED` 失败。消费者捕获 `AudioError` 并按其稳定的 `code` 路由；经由工具，未挂载的接缝表现为模型可读的可操作不可用应答。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本节解释接缝背后的设计决策及其在代码中的落点；可观察行为见[使用本包](#use-this-package)。

### 设计理念

- **能力接缝，Service Definition 角色。** 本包持有 `ctx.audio` 与提供者注册表；提供者上传字节并说端点协议而非工具，`dsh-tool-audio` 是面向模型表面的唯一持有者。
- **独占式整库注册。** 同一时刻只有一个提供者持有接缝；转写后端声明的是部署的语音转写管线，因此第二次注册是冲突而非并存路由。
- **原子注册。** `registerProvider()` 在任何变更前完成校验与冲突检查：无效或冲突的注册不会发布任何内容，其释放器会解除注册。
- **顺序无关路由。** 该路由经 `ctx.effect()` 转发到唯一已注册的提供者，注册随声明它的 fiber 共存亡；注册与 HMR 顺序不会改变应答的提供者。
- **封闭的、提供者无关的词汇表。** 请求与转写文本的形态在所有后端间固定——新增修饰是横跨接缝、提供者与工具的编译期强制变更。这里没有协议逃生舱。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Audio` 服务、`registerProvider`/`transcribe`、`AudioError` 错误码 |
| [`src/types.ts`](src/types.ts) | 接缝词汇表：请求、转写文本、提供者与服务契约 |
| — | 不发布运行时不变量伴侣；提供者注册是私有的、原子更新的状态；接缝既不暴露可枚举快照，也不暴露可独立比对的生命周期事件。 |

### 注册与释放生命周期

注册与释放经 `ctx.effect()` 运行，提供者路由随声明它的 fiber 共存亡。`registerProvider()` 返回同步释放器；接缝丢弃恒为已解决的 effect promise，使其释放器 API 保持同步。`AudioError` 继承 `HarnessError` 并携带稳定错误码（`AUDIO_INVALID_PROVIDER`、`AUDIO_CONFLICT`、`AUDIO_UNAVAILABLE`、`AUDIO_DISPOSED`、`AUDIO_INVALID_REQUEST`、`AUDIO_PROVIDER_FAILED`），调用者按 `code` 路由而非解析 `message`。

</details>

-----

<a id="further-exploration"></a>
## 深入探索

当包级契约不够用时阅读这些页面。它们从共享的转写模型走向提供者与工具。

- [dsh-audio-http](../audio-http/README.zh.md) — 在本接缝上注册的 OpenAI 兼容 HTTP 提供者。
- [dsh-tool-audio](../tool-audio/README.zh.md) — 本接缝之上的面向模型工具。
- [audio 组地图](../README.zh.md) — 三包家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

间接地经由 `dsh-tool-audio`——它持有面向模型的 `transcribe_audio` 模式、提示指导与结果渲染；本注册表自身不贡献任何提示或模式。

#### KV Cache 影响

无直接失效；请求前缀变化由 `dsh-tool-audio` 持有。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义接缝的当前范围。它们是包约束，不是任务清单。

- **每运行时单一提供者** — 一个转写后端是整库声明，因此第二次注册是冲突而非并存。若未来确需多提供者路由，预定的扩展是在注册之上加部署配置的选择器。
- **单路由、无合成** — 接缝只暴露 `transcribe`；文本转语音是另一种能力，这里没有路由。
- **无字节或时长上限** — 接缝不设上限，消费者持有音频大小预算，提供者持有端点超时。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

---
description: "面向模型的 transcribe_audio 工具，架在 ctx.audio 接缝与 ctx.fs 之上：解析工作区音频文件、按预算读取，并把提供者的转写文本返回给模型——无提供者时给出可操作的不可用应答，面向组合语音转写能力的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-audio

[English](README.md) | 中文

## 概述

`dsh-tool-audio` 为模型提供一个架在 `ctx.audio` 之上的工具：`transcribe_audio` 经 `ctx.fs` 解析工作区音频文件，在字节预算内读取，并把提供者的转写文本连同可选的语言与时长元数据返回给模型。挂载音频提供者之前该工具不可用；无提供者时它返回可操作的"音频不可用"应答而非使会话失败。缺失文件、非普通文件或超限文件以结构化文件系统错误呈现；转写文本受 `maxResultChars` 约束。本包运行时只注入 `tools`、`audio`、`fs` 与 `systemPrompt`，不导入任何提供者。

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

当模型需要用户提及的或它在工作区发现的音频文件的内容时，会调用 `transcribe_audio`；工具的提示指导告诉它在能力未配置时继续无转写的会话。

### 该工具

`transcribe_audio` 接收必需的 `file_path`，加上可选的 `language`（ISO 639-1 提示）与 `prompt`（自由文本引导，例如已知术语）。每个输入都会 trim、丢弃空白修饰，并在触碰接缝或文件系统之前，将空白 `file_path` 或非字符串修饰拒绝为可操作的参数错误。提供者选择、端点、凭据与音频格式支持在模型输入之外；它们属于挂载的提供者。

### 模型得到什么

工具返回封闭结果：`status` 为 `ok` 时携带 `path`、`text` 与可选的提供者报告的 `language`、`durationSec`，或 `unavailable` 时携带 `path`。渲染输出 `<path>`/`<type>transcript</type>` 信封，含可选的 `<meta>` 行（`language xx, Ns`）与 `<content>` 内的转写文本，受 `maxResultChars` 约束并计入截断提示。无提供者挂载时，渲染为可操作的不可用应答而非错误。

### 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `maxResultChars` | `8000` | 完整渲染转写的最大字符数，含截断提示 |
| `maxAudioBytes` | `26214400` | 单个转写音频文件的字节上限（25 MiB，含） |
| `timeoutMs` | `120000` | 工具调用超时预算，覆盖一次转写往返 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-audio)是所有接受字段的穷尽来源。

### 失败与恢复

不存在的路径会发出 `fs/observed` absent 事件并抛出 `FS_NOT_FOUND`；目录或其他非普通文件抛出 `FS_NOT_REGULAR_FILE`；超过字节预算的文件抛出文件系统后端的超限读取错误。接缝的 `AUDIO_UNAVAILABLE` 被捕获并返回 `status: 'unavailable'`，会话继续运行。任何其他 `AudioError`（提供者失败、无效请求）作为结构化工具错误向上传播，模型可读取并路由。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本节解释工具背后的设计决策及其在代码中的落点；可观察行为见[使用本包](#use-this-package)。

### 设计要点

- **仅消费者。** 工具运行时只注入 `tools`、`audio`、`fs` 与 `systemPrompt`，不导入任何提供者，只把 `exec.signal` 传给接缝与文件系统。
- **接缝之前的参数规范化。** `parseTranscribeArgs` trim 并收敛输入，因此提供者收到规范的请求，畸形输入是可操作错误而非崩溃。
- **可用性是数据，不是崩溃。** `execute` 捕获 `AUDIO_UNAVAILABLE` 的 `AudioError` 并返回 `unavailable` 状态；其他错误重新抛出，真正损坏的提供者仍会被暴露。
- **有界读取，有界渲染。** 字节预算限制离开工作区的内容；`formatTranscript` 限制进入会话的内容，截断提示计入预算内。
- **并发安全读取。** `transcribe_audio` 返回 `isConcurrencySafe: () => true`——每次调用一个文件，无共享可变状态。
- **通用卡片呈现。** `presentTranscribeCall` 渲染以文件名为题的 `{ card: 'generic', kind: 'other', title }`；无渲染目标，因此不附加位置。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置模式、提示段、`transcribe_audio` 注册与执行 |
| [`src/render.ts`](src/render.ts) | 纯参数校验、含结果上限的转写信封、UI 呈现 |
| — | 不发布运行时不变量伴侣；这个无状态适配器贡献一个工具与一个提示段，提供者生命周期仍由它组合的音频接缝持有。 |

</details>

-----

<a id="further-exploration"></a>
## 深入探索

当包级契约不够用时阅读这些页面。它们从面向模型表面走向接缝与提供者。

- [dsh-audio](../audio/README.zh.md) — 本工具查询的接缝。
- [dsh-audio-http](../audio-http/README.zh.md) — 应答转写的提供者。
- [audio 组地图](../README.zh.md) — 三包家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示

#### 模型看到什么

一个系统提示段（第一方顺序 2455）定位转写工具及其可选性，文本如下：

##### 逐字指导

```markdown
Use transcribe_audio to convert an audio file (MP3, WAV, M4A, AAC, OGG, Opus, FLAC, or WebM) in the workspace into text. It is unavailable until an audio provider is configured — then continue without transcription, for example by suggesting the user configure one.
```

#### Token 影响

插件激活期间每个请求的固定指导成本。

#### KV Cache 影响

插件作用域与指导文本不变时前缀稳定；激活或释放可能使本节的复用失效。

### 工具模式

#### 模型看到什么

模型看到生成的 [`transcribe_audio` 模式](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-audio)。

#### Token 影响

启用期间每个请求的固定模式成本；`timeoutMs` 预算永不发送给模型。

#### KV Cache 影响

可见工具定义与顺序不变时前缀稳定；注册生命周期或作用域限制可能自首个变更的模式 token 起使复用失效。

### 结果

#### 模型看到什么

ok 结果渲染 `<path>`/`<type>transcript</type>` 信封，含可选 `<meta>` 元数据与 `<content>` 内的转写文本，受 `maxResultChars` 约束。无提供者挂载时，结果是可操作的不可用应答而非错误。截断提示计入字符预算内。

#### Token 影响

无论提供者应答多长，转写都受 `maxResultChars` 约束。

#### KV Cache 影响

工具结果追加在缓存请求前缀之后，不直接使其失效。

### UI 呈现

#### 模型看到什么

无。客户端渲染通用卡片——`{ card: 'generic', kind: 'other', title }`——题为 `Transcribe: <文件名>`；无渲染目标，因此不附加位置。

#### Token 影响

渲染仅在客户端进行，无直接 token 影响。

#### KV Cache 影响

无；UI 呈现在模型请求之外。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义工具何时是糟糕选择。它们是当前包约束，不是任务清单。

- **提供者门控可用性** — 未挂载音频提供者时工具总是返回不可用应答；它自身从不转写任何内容，因此部署必须挂载 `dsh-audio-http`（或其他提供者）才能获得真实转写。
- **仅工作区文件** — 工具经 `ctx.fs` 读取，因此音频必须以工作区文件形式存在；不接受模型给的字节或远程 URL。
- **每次调用一个文件** — 一批音频文件是多次调用；没有多文件参数。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

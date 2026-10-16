---
description: "面向模型的 generate_video 工具，基于 ctx.video seam 与 ctx.attachments：将文本提示（加可选的尺寸、时长、宽高比、首尾帧与参考媒体提示）发送到保留的提供方，把生成字节持久提交为文件附件，并在有界文本信封旁返回文件；未挂载提供方或存储时返回可操作的不可用应答，供组合视频生成的用户与维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-video

[English](README.md) | 中文

<a id="summary"></a>
## 概述

`dsh-tool-video` 在 `ctx.video` 上给模型一个工具：`generate_video` 将文本提示（加可选的尺寸、时长、宽高比、首尾帧与参考媒体提示）发送给保留的提供方，把生成字节持久提交为文件附件，并在有界文本信封旁返回文件，让模型与用户都看到创建的内容。没有挂载提供方时它返回可操作的"视频不可用"消息而不是使会话失败。部署无法存储的媒体类型在进入持久历史之前以可操作错误呈现。本包运行时只注入 `tools`、`video` 与 `systemPrompt`，不导入任何提供方。

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

当用户要求短片、镜头或任何文本提示可以描述的运动时，模型调用 `generate_video`；工具的提示指导告诉它在能力未配置时继续不使用生成。

### 工具

`generate_video` 接收必填的 `prompt` 加可选的 `size`（例如 `"1280x720"`）、可选的以秒计的 `duration`、可选的 `aspectRatio`（例如 `"16:9"` 或 `"adaptive"`），以及可选的 `firstFrame`、`lastFrame`、`referenceImage`、`referenceVideo` 与 `referenceAudio`（公网可达的首尾帧图或参考媒体 URL，用于引导生成）。它修剪输入，并在触碰 seam 之前把空白 `prompt`、空白 `size`、非正整数 `duration` 或空白参考 URL 作为可操作的参数错误拒绝。提供方选择、端点、凭据与模型都在模型输入之外；它们属于挂载的提供方。

### 模型得到什么

工具返回封闭结果：`status` `ok` 带 `video`（持久附件引用——`attachmentId`、`name`、`bytes`、`mediaType`），或 `unavailable`。渲染在 `<type>video</type>` 信封旁发出文件块本身，信封指明媒体类型与字节数，以 `maxResultChars` 为界。未挂载提供方时，渲染是可操作的不可用消息而不是错误。

### 配置

| Key | Default | Meaning |
|---|---|---|
| `maxResultChars` | `8000` | 最大完整渲染信封，含任何截断 |
| `timeoutMs` | `660000` | 工具调用超时预算，覆盖一次生成往返 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-video)是每个可接受字段的穷尽来源。

### 失败与恢复

未挂载 attachment 存储时在任何生成 I/O 之前返回 `status: 'unavailable'`，拒绝永远不会花费调用方的提供方预算。seam 抛出的 `VIDEO_UNAVAILABLE` 被捕获并返回 `status: 'unavailable'`，会话继续运行。部署可存储集合（MP4/WebM/MOV）之外的媒体类型抛出指明违规类型的可操作错误；任何其他 `VideoError`（提供方失败、无效请求）作为模型可读可路由的结构化工具错误传播。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

本节解释工具背后的设计决策及其代码落点；可观察行为见 [Use this package](#use-this-package)。

### 设计笔记

- **仅 Consumer。** 工具运行时只注入 `tools`、`video` 与 `systemPrompt`，不导入提供方，只把 `exec.signal` 传给 seam。
- **先把关再花费。** 生成调用之前检查 attachment 存储，无法持久提交字节的部署永远不为生成付费。
- **先持久再返回。** 视频在构建工具结果之前经 `attachments.saveFile()` 提交，因此 tool/result 事件追加时文件块始终引用持久提交的对象。
- **seam 之前的参数规范化。** `parseGenerateVideoArgs` 修剪并规范化输入，提供方收到规范请求，畸形输入是可操作错误而不是崩溃。
- **可用性是数据，不是崩溃。** `execute` 捕获代码为 `VIDEO_UNAVAILABLE` 的 `VideoError` 并返回 `unavailable` 状态；其余错误重新抛出，真正损坏的提供方仍然可见。
- **有界渲染。** `formatGeneratedVideo` 限制进入对话的内容；视频字节本身由相邻文件块承载，绝不进入文本信封。
- **并发安全的生成。** `generate_video` 返回 `isConcurrencySafe: () => true` —— 生成无状态且内容寻址的附件写入幂等。
- **通用卡片呈现。** `presentGenerateVideoCall` 渲染 `{ card: 'generic', kind: 'other', title }`，标题为有界提示标签，并附上尺寸、时长、宽高比与参考媒体注记。

### 源码地图

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、提示段、`generate_video` 注册与执行 |
| [`src/render.ts`](src/render.ts) | 纯参数校验、带结果上限的生成视频信封、UI 呈现 |
| — | 未发布运行时不变量伴侣；这个无状态适配器贡献一个工具与一个提示段，提供方生命周期归它组合的 video seam 持有。 |

</details>

-----

<a id="further-exploration"></a>
## 深入探索

当包级契约不够时阅读这些页面。它们从面向模型面走向 seam 与提供方。

- [dsh-video](../video/README.zh.md) — 本工具查询的 seam。
- [dsh-video-wuyinkeji](../video-wuyinkeji/README.zh.md) — 经速创视频任务 API（配置 `model` 选择的端点）应答生成的异步任务提供方。
- [dsh-video-volc](../video-volc/README.zh.md) — 向火山引擎 Ark（Seedance）提交任务（chat-completions，或 Seedance 2.5 的 content-generation 家族）、可引用私域 Seedance 素材的提供方。
- [video 组地图](../README.zh.md) — 包家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示

#### What the model sees

一个 system-prompt 段（一方 order 2458）定位生成工具及其可选性，文本如下：

##### Verbatim guidance

```markdown
Use generate_video to create a video from a text prompt. It is unavailable until a video provider is configured — then continue without video generation, for example by suggesting the user configure one.
```

#### Token effect

插件激活期间，每个请求的固定指导成本。

#### KV Cache effect

插件范围与指导文本不变时前缀稳定；激活或释放可能使本段的复用失效。

### 工具模式

#### What the model sees

模型看到生成的 [`generate_video` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-video)。

#### Token effect

启用期间每个请求的固定 schema 成本；`timeoutMs` 预算从不发送给模型。

#### KV Cache effect

可见工具定义与顺序不变时前缀稳定；注册生命周期或范围限制可能从第一个变更的 schema 令牌起使复用失效。

### 结果

#### What the model sees

ok 结果在 `<type>video</type>` 信封旁渲染文件块（作为持久附件承载的生成视频），信封指明媒体类型与字节数，以 `maxResultChars` 为界。未挂载提供方时，结果是可操作的不可用消息而不是错误。

#### Token effect

信封以 `maxResultChars` 为上限；视频本身由文件块承载，不占文本。

#### KV Cache effect

工具结果追加在缓存请求前缀之后，不直接使其失效。

### UI 呈现

#### What the model sees

无。客户端渲染通用卡片——`{ card: 'generic', kind: 'other', title }`——标题为 `Generate video: <prompt label>`，出现尺寸、时长、宽高比与参考媒体时附上相应注记；结算结果的文件块以消息流共用的持久文件卡片呈现，标注文件名、扩展名与字节数。

#### Token effect

零直接影响，因为渲染只在客户端。

#### KV Cache effect

无；UI 呈现在模型请求之外。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义工具何时不适配。它们是当前包约束，不是任务清单。

- **提供方门控的可用性** —— 未挂载视频提供方时工具总是返回不可用消息；它自身从不生成任何内容，部署必须挂载 `dsh-video-wuyinkeji`（或其他提供方）才能得到真实视频。
- **存储门控的持久化** —— 未挂载 attachment 存储时工具在生成之前返回不可用应答，生成字节总有持久归处。
- **参考媒体取决于提供方** —— 工具将首尾帧与参考媒体 URL 作为请求字段透传；端点是否接受是挂载提供方的策略。
- **每次调用一个视频** —— 结果只建模单个文件附件。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

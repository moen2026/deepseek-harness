---
description: "面向模型的 generate_image 工具，基于 ctx.image seam 与 ctx.attachments：将文本提示（加可选的尺寸与参考图提示）发送到保留的提供方，把生成字节持久提交为图像附件，并在有界文本信封旁返回图像；未挂载提供方或存储时返回可操作的不可用应答，供组合图像生成的用户与维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-image

[English](README.md) | 中文

<a id="summary"></a>
## 概述

`dsh-tool-image` 在 `ctx.image` 上给模型一个工具：`generate_image` 将文本提示（加可选的尺寸与参考图提示）发送给保留的提供方，把生成字节持久提交为图像附件，并在有界文本信封旁返回图像，让模型与用户都看到创建的内容。没有挂载提供方时它返回可操作的"图像不可用"消息而不是使会话失败。部署无法存储的媒体类型在进入持久历史之前以可操作错误呈现。本包运行时只注入 `tools`、`image` 与 `systemPrompt`，不导入任何提供方。

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

当用户要求插图、样机或任何文本提示可以描述的图像时，模型调用 `generate_image`；工具的提示指导告诉它在能力未配置时继续不使用生成。

### 工具

`generate_image` 接收必填的 `prompt` 加可选的 `size`（例如 `"1024x1024"`）与可选的 `referenceImages`（公网可达的参考图 URL，用于图生图引导）。它修剪输入、丢弃空白精修，在触碰 seam 之前把空白 `prompt`、非字符串 `size` 或畸形 `referenceImages` 列表作为可操作的参数错误拒绝。不接受参考图的提供方会忽略它们。提供方选择、端点、凭据与模型都在模型输入之外；它们属于挂载的提供方。

### 模型得到什么

工具返回封闭结果：`status` `ok` 带 `image`（持久附件引用——`attachmentId`、`mediaType`、`bytes`、`width`、`height`、可选 `name`）与可选的提供方报告 `revisedPrompt`，或 `unavailable`。渲染在 `<type>image</type>` 信封旁发出图像块本身，信封指明媒体类型、尺寸与字节数，提供方报告时附上 revised prompt，以 `maxResultChars` 为界。提供方应答拆分图层时，每层作为独立附件提交；信封随后逐层列出媒体类型、裁剪尺寸、边界框与端点命名的名称和描述，合成图像块之后按 z 自底向上跟随各层图像块。未挂载提供方时，渲染是可操作的不可用消息而不是错误。

### 配置

| Key | Default | Meaning |
|---|---|---|
| `maxResultChars` | `8000` | 最大完整渲染信封，含任何截断 |
| `timeoutMs` | `180000` | 工具调用超时预算，覆盖一次生成往返 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-image)是每个可接受字段的穷尽来源。

### 失败与恢复

未挂载 attachment 存储时在任何生成 I/O 之前返回 `status: 'unavailable'`，拒绝永远不会花费调用方的提供方预算。seam 抛出的 `IMAGE_UNAVAILABLE` 被捕获并返回 `status: 'unavailable'`，会话继续运行。部署可存储集合（PNG/JPEG/WebP/GIF）之外的媒体类型抛出指明违规类型的可操作错误；任何其他 `ImageError`（提供方失败、无效请求）作为模型可读可路由的结构化工具错误传播。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

本节解释工具背后的设计决策及其代码落点；可观察行为见 [Use this package](#use-this-package)。

### 设计笔记

- **仅 Consumer。** 工具运行时只注入 `tools`、`image` 与 `systemPrompt`，不导入提供方，只把 `exec.signal` 传给 seam。
- **先把关再花费。** 生成调用之前检查 attachment 存储，无法持久提交字节的部署永远不为生成付费。
- **先持久再返回。** 图像在构建工具结果之前经 `attachments.saveImage()` 提交，因此 tool/result 事件追加时图像块始终引用持久提交的对象。
- **seam 之前的参数规范化。** `parseGenerateImageArgs` 修剪并收敛输入，提供方收到规范请求，畸形输入是可操作错误而不是崩溃。
- **可用性是数据，不是崩溃。** `execute` 捕获代码为 `IMAGE_UNAVAILABLE` 的 `ImageError` 并返回 `unavailable` 状态；其余错误重新抛出，真正损坏的提供方仍然可见。
- **有界渲染。** `formatGeneratedImage` 限制进入对话的内容；图像字节本身由相邻图像块承载，绝不进入文本信封。
- **并发安全的生成。** `generate_image` 返回 `isConcurrencySafe: () => true` —— 生成无状态且内容寻址的附件写入幂等。
- **通用卡片呈现。** `presentGenerateImageCall` 渲染 `{ card: 'generic', kind: 'other', title }`，标题为有界提示标签，并附上参考图数量。

### 源码地图

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、提示段、`generate_image` 注册与执行 |
| [`src/render.ts`](src/render.ts) | 纯参数校验、带结果上限的生成图像信封、UI 呈现 |
| — | 未发布运行时不变量伴侣；这个无状态适配器贡献一个工具与一个提示段，提供方生命周期归它组合的 image seam 持有。 |

</details>

-----

<a id="further-exploration"></a>
## 深入探索

当包级契约不够时阅读这些页面。它们从面向模型面走向 seam 与提供方。

- [dsh-image](../image/README.zh.md) — 本工具查询的 seam。
- [dsh-image-http](../image-http/README.zh.md) — OpenAI 兼容的应答生成提供方。
- [dsh-image-wuyinkeji](../image-wuyinkeji/README.zh.md) — 经速创异步图像任务 API（GPT-Image-2.5 或 NanoBanana2Lite）应答生成的异步任务提供方。
- [image 组地图](../README.zh.md) — 四包家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示

#### What the model sees

一个 system-prompt 段（一方 order 2456）定位生成工具及其可选性，文本如下：

##### Verbatim guidance

```markdown
Use generate_image to create an image from a text prompt. It is unavailable until an image provider is configured — then continue without image generation, for example by suggesting the user configure one.
```

#### Token effect

插件激活期间，每个请求的固定指导成本。

#### KV Cache effect

插件范围与指导文本不变时前缀稳定；激活或释放可能使本段的复用失效。

### 工具模式

#### What the model sees

模型看到生成的 [`generate_image` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-image)。

#### Token effect

启用期间每个请求的固定 schema 成本；`timeoutMs` 预算从不发送给模型。

#### KV Cache effect

可见工具定义与顺序不变时前缀稳定；注册生命周期或范围限制可能从第一个变更的 schema 令牌起使复用失效。

### 结果

#### What the model sees

ok 结果在 `<type>image</type>` 信封旁渲染图像块本身（生成的图片），信封指明媒体类型、尺寸与字节数，提供方报告时附上 `revisedPrompt`，以 `maxResultChars` 为界；拆分图层在合成图片之后各自作为图像块跟随，各层事实写入信封。未挂载提供方时，结果是可操作的不可用消息而不是错误。

#### Token effect

信封以 `maxResultChars` 为上限；图像本身由图像块承载，不占文本。

#### KV Cache effect

工具结果追加在缓存请求前缀之后，不直接使其失效。

### UI 呈现

#### What the model sees

无。客户端渲染通用卡片——`{ card: 'generic', kind: 'other', title }`——标题为 `Generate image: <prompt label>`，请求携带参考图时附上参考图数量；图像本身经工具持有的图像槽渲染，与 `read_image` 结果一致。

#### Token effect

零直接影响，因为渲染只在客户端。

#### KV Cache effect

无；UI 呈现在模型请求之外。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义工具何时不适配。它们是当前包约束，不是任务清单。

- **提供方门控的可用性** —— 未挂载图像提供方时工具总是返回不可用消息；它自身从不生成任何内容，部署必须挂载 `dsh-image-http`（或其他提供方）才能得到真实图像。
- **存储门控的持久化** —— 未挂载 attachment 存储时工具在生成之前返回不可用应答，生成字节总有持久归处。
- **参考图取决于提供方** —— 工具将 `referenceImages` 作为请求字段透传；端点是否接受是挂载提供方的策略，不接受参考图的提供方不会发送它们。
- **每次调用一张图** —— 多图请求是多次调用；结果只建模单个附件。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

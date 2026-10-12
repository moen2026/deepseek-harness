---
description: "速创（Wuyinkeji）异步图像生成提供方，用于 DeepSeek Harness image seam（ctx.image）——将文本提示（NanoBanana2Lite 上附带参考图 URL）以 JSON 提交到公开的异步图像任务端点（GPT-Image-2.5 或 NanoBanana2Lite，由 `model` 选定），轮询结果详情直至任务结算，把结算后的图像 URL 下载为原始字节，凭据调用时读取，失败以类型化提供方错误呈现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-image-wuyinkeji

[English](README.md) | 中文

<a id="summary"></a>
## 概述

挂载 `dsh-image-wuyinkeji` 以速创的异步任务 API 支撑 `ctx.image`：每个请求将文本提示以 JSON 提交到 `model` 选定的端点（默认 `gpt-image-2.5`，或 `nano-banana-2-lite`），调用时从 `authEnv` 指定的环境变量读取 API 密钥，轮询结果详情直至任务结算，并把结算后的图像 URL 下载为原始字节；`nano-banana-2-lite` 转发可选的参考图 URL，而 `gpt-image-2.5` 上游拒绝它们。基础 URL、模型、比例默认值与凭据由部署持有。失败以类型化 `IMAGE_PROVIDER_FAILED` 错误呈现——没有本地回退生成。注册是 effect 范围的；释放即注销提供方。

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

### 何时选择它

当部署通过速创的异步任务 API 或速创兼容端点生成图像时，选择本提供方。`authEnv` 是必需配置；`baseURL` 默认指向公开的 `https://api.wuyinkeji.com`，`model` 指定任务端点（默认 `gpt-image-2.5`，或 `nano-banana-2-lite`）及其参考图策略。本提供方不携带密钥材料。

### 配置

```yaml
- name: '@deepseek-ai/dsh-image-wuyinkeji'
  config:
    authEnv: DSH_WUYINKEJI_API_KEY
    model: gpt-image-2.5
    aspectRatio: 1024*1024
    pollIntervalMs: 3000
    timeoutMs: 120000
```

`authEnv` 指定持有 API 密钥的环境变量名——绝不是密钥本身。`model` 选定提交端点及其比例词汇：`gpt-image-2.5`（默认）接受 `1024*1024` 这类像素对比例，`nano-banana-2-lite` 接受 `16:9` 这类冒号比例，并把 `1024x1536` 这类像素对 `size` 归约为最简比。请求的 `referenceImages` URL 仅由 `nano-banana-2-lite` 作为端点的 `urls` 字段发送；`gpt-image-2.5` 端点拒绝携带 `urls` 的提交，因此该模型从不发送它们。`aspectRatio` 是请求未携带 `size` 时发送的线上比例，以所选模型的词汇表达；`pollIntervalMs`（默认 3000）间隔结果详情轮询；`timeoutMs`（默认 120000）一并约束提交、轮询与下载，在内置工具调用预算内到期，使慢速生成报告本类型化超时而非被通用工具截止抢先。密钥在调用时读取，轮换环境变量在下次请求即生效，无需重启。

### 失败与恢复

缺失凭据变量、传输失败、非 2xx 响应、非 JSON 响应体、提交或结果详情被拒绝、未知任务状态、任务失败或整体超时，各自以 `ImageError` `IMAGE_PROVIDER_FAILED` 抛出并在消息中指明失败点。调用方——包括 `dsh-tool-image`——报告失败；不会降级为伪造图像。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

### 设计理念

- **Service Provider 角色。** 本包在 `ctx.image` 上注册一个 `ImageProvider`（`id: image-wuyinkeji`），此外一无所持：没有工具、没有提示、没有存储。
- **凭据按引用。** 配置持有 API 密钥变量的*名称*；机密在调用时从环境读取，从不写入配置、日志或请求体。
- **异步任务生命周期。** 一次提交以任务 id 应答；结果详情轮询报告结算；结算后的图像 URL 被下载为原始字节，这是 seam 面向字节的结果词汇能承载的唯一应答形态。
- **模型选定端点。** `model` 固定提交端点、其比例词汇以及是否转发请求中的参考图 URL；一个实例服务一个模型，结果详情路径、轮询与下载在各模型间保持共享。
- **类型化失败。** 每个端点侧失败都成为 `IMAGE_PROVIDER_FAILED`，调用方依据 `code` 路由而不是解析传输错误。

### 源码地图

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema 与提供方注册 |
| [`src/generate.ts`](src/generate.ts) | 异步客户端：提交（含按模型门控的参考图转发）、结果详情轮询、图像下载、类型化失败 |
| — | 不发布运行时不变式伴生入口；除所属接缝强制执行的约定外，本包没有独立的事件序列或可变数据关系。 |

</details>

-----

<a id="further-exploration"></a>
## 深入探索

- [dsh-image](../image/README.zh.md) — 本提供方注册的 seam。
- [dsh-tool-image](../tool-image/README.zh.md) — 消费生成图像的面向模型工具。
- [image 组地图](../README.zh.md) — 四包家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

无影响；本提供方应答生成请求而不向模型请求贡献任何内容，面向模型的 schema 与渲染由 `dsh-tool-image` 持有。

#### KV Cache 影响

无影响；本提供方不向模型请求贡献任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义提供方的当前范围。它们是包约束，不是任务清单。

- **每实例一个端点** —— 需要多个端点或模型的部署必须挂载多个上下文；seam 的单提供方规则本就禁止并注册。
- **仅取首图** —— 结算任务的 `result` 数组映射第一项；多图结果未建模。
- **透传的比例映射** —— 请求的 `size` 被机械地转成线上比例：`gpt-image-2.5` 把 `x`/`×` 改写为 `*`，`nano-banana-2-lite` 保留冒号比例并把像素对归约为最简比。两种词汇都不在本地校验，不支持的比例在远端以 `IMAGE_PROVIDER_FAILED` 失败。
- **参考图仅限 NanoBanana2Lite** —— seam 的请求词汇携带可选参考图 URL，`nano-banana-2-lite` 将其作为 `urls` 转发；`gpt-image-2.5` 端点在上游拒绝该字段，因此该模型从不发送参考图。
- **无本地引擎** —— 生成依赖配置的端点；离线部署得到可操作的 `IMAGE_PROVIDER_FAILED` 而不是结果。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

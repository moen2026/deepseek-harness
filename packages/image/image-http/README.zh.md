---
description: "OpenAI 兼容的 DeepSeek Harness image seam（ctx.image）HTTP 图像生成提供方——将文本提示以 JSON 提交到部署指定的 /images/generations 端点，凭据调用时读取，失败以类型化提供方错误呈现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-image-http

[English](README.md) | 中文

<a id="summary"></a>
## 概述

挂载 `dsh-image-http` 以 OpenAI 兼容的生成端点支撑 `ctx.image`：每个请求将文本提示以 JSON 提交到配置的 URL 并要求 base64 应答，调用时从 `authEnv` 指定的环境变量读取 bearer 令牌，并把 JSON 应答映射为 seam 的图像结果。端点、模型与凭据由部署持有，DSH 从不选择生成模型。失败以类型化 `IMAGE_PROVIDER_FAILED` 错误呈现——没有本地回退生成。注册是 effect 范围的；释放即注销提供方。

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

当部署已经运营（或购买）OpenAI 兼容的文生图端点时，选择本提供方。端点 URL、模型名与凭据变量是必需配置；本提供方不携带密钥材料、不内置模型、只访问配置的 URL。

### 配置

```yaml
- name: '@deepseek-ai/dsh-image-http'
  config:
    url: https://example.invalid/v1/images/generations
    model: image-1
    authEnv: DSH_IMAGE_API_KEY
    timeoutMs: 120000
```

`authEnv` 指定持有 bearer 令牌的环境变量名——绝不是令牌本身。令牌在调用时读取，轮换环境变量在下次请求即生效，无需重启。

### 失败与恢复

缺失凭据变量、传输失败、非 2xx 响应、非 JSON 响应体或意外的响应形态，各自以 `ImageError` `IMAGE_PROVIDER_FAILED` 抛出并在消息中指明失败点。调用方——包括 `dsh-tool-image`——报告失败；不会降级为伪造图像。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

### 设计理念

- **Service Provider 角色。** 本包在 `ctx.image` 上注册一个 `ImageProvider`（`id: image-http`），此外一无所持：没有工具、没有提示、没有存储。
- **凭据按引用。** 配置持有 bearer 令牌变量的*名称*；机密在调用时从环境读取，从不写入配置、日志或请求体。
- **仅 base64 应答。** 提供方始终请求 `response_format: b64_json`，这是 seam 面向字节的结果词汇能承载的唯一应答形态；图像字节从不是需要调用方再抓取的 URL。
- **类型化失败。** 每个端点侧失败都成为 `IMAGE_PROVIDER_FAILED`，调用方依据 `code` 路由而不是解析传输错误。

### 源码地图

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema 与提供方注册 |
| [`src/generate.ts`](src/generate.ts) | HTTP 客户端：JSON 请求、base64 解码、响应映射、类型化失败 |
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

- **每实例一个端点** —— 需要多个端点的部署必须挂载多个上下文；seam 的单提供方规则本就禁止并注册。
- **仅取首图** —— 端点每次请求返回多图时，提供方映射第一张；`n` 请求精修会透传，但多图结果未建模。
- **无 URL 抓取回退** —— 提供方请求 base64 应答且不抓取 URL 形态的应答；无法返回 `b64_json` 的端点以 `IMAGE_PROVIDER_FAILED` 失败。
- **无本地引擎** —— 生成依赖配置的端点；离线部署得到可操作的 `IMAGE_PROVIDER_FAILED` 而不是结果。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

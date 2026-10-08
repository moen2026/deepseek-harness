---
description: "DeepSeek Harness 音频接缝（ctx.audio）的 OpenAI 兼容 HTTP 转写提供者——将原始音频字节以 multipart 上传到部署指定的 /audio/transcriptions 端点，凭据在调用时读取，失败以类型化错误呈现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-audio-http

[English](README.md) | 中文

## 概述

挂载 `dsh-audio-http`，以 OpenAI 兼容的转写端点支撑 `ctx.audio`：每个请求将原始音频字节以 `multipart/form-data` 上传到配置的 URL，在调用时从 `authEnv` 命名的环境变量读取 bearer 令牌，并把 JSON 应答映射到接缝的转写文本。端点、模型与凭据由部署持有，DSH 从不替你选择转写模型。失败以类型化的 `AUDIO_PROVIDER_FAILED` 错误呈现——没有本地回退转写。注册随 effect 作用域管理；释放即注销提供者。

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

### 何时选择它

当部署已经运营（或购买）OpenAI 兼容的语音转文本端点时，选择本提供者。端点 URL、模型名与凭据变量是必需配置；提供者不携带任何密钥材料、不内置任何模型，只访问配置的 URL。

### 配置

```yaml
- name: '@deepseek-ai/dsh-audio-http'
  config:
    url: https://example.invalid/v1/audio/transcriptions
    model: whisper-1
    authEnv: DSH_AUDIO_API_KEY
    timeoutMs: 60000
```

`authEnv` 命名持有 bearer 令牌的环境变量——绝不是令牌本身。令牌在调用时读取，因此轮换环境变量后，下一次请求即生效而无需重启。

### 失败与恢复

缺失的凭据变量、传输失败、非 2xx 响应、非 JSON 响应体或意外应答形态，都会以 `AudioError` `AUDIO_PROVIDER_FAILED` 抛出，消息中注明失败原因。调用者——包括 `dsh-tool-audio`——负责报告失败；任何路径都不会伪造转写文本。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 设计理念

- **Service Provider 角色。** 本包在 `ctx.audio` 上注册一个 `AudioProvider`（`id: audio-http`），此外一无所有：没有工具、没有提示、没有存储。
- **凭据按引用。** 配置存储的是 bearer 令牌*变量名*；密钥在调用时从环境读取，从不写入配置、日志或请求体。
- **类型化失败。** 每个端点侧失败都变成 `AUDIO_PROVIDER_FAILED`，调用者按 `code` 路由而非解析传输错误。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` 模式与提供者注册 |
| [`src/transcribe.ts`](src/transcribe.ts) | HTTP 客户端：multipart 上传、媒体类型解析、应答映射、类型化失败 |
| — | 不发布运行时不变式伴生入口；除所属接缝强制执行的约定外，本包没有独立的事件序列或可变数据关系。 |

</details>

-----

<a id="further-exploration"></a>
## 深入探索

- [dsh-audio](../audio/README.zh.md) — 本提供者注册的接缝。
- [dsh-tool-audio](../tool-audio/README.zh.md) — 消费转写文本的面向模型工具。
- [audio 组地图](../README.zh.md) — 三包家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

无直接影响；面向模型的模式与渲染由 `dsh-tool-audio` 持有。

#### KV Cache 影响

无影响；本提供者不向模型请求贡献任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义提供者的当前范围。它们是包约束，不是任务清单。

- **每实例一个端点** — 部署若需多个端点必须挂载多个 context；接缝的单一提供者规则本就禁止并注册。
- **无流式与说话人分离** — 提供者对每个请求应答一份完整转写；分段或按说话人归因的结果不在建模范围内。
- **无本地引擎** — 转写依赖配置的端点；离线部署得到可操作的 `AUDIO_PROVIDER_FAILED` 而非结果。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

---
description: "速创（Wuyinkeji）异步视频生成提供方，用于 DeepSeek Harness video seam（ctx.video）——将文本提示（可附尺寸、时长、宽高比、首尾帧与参考媒体提示）以 JSON 提交到配置模型选择的公开视频任务端点（Google-Omni、MiniMax H3 或 Grok Imagine），轮询结果详情直至任务结算，把结算后的视频 URL 下载为原始字节，凭据调用时读取，失败以类型化提供方错误呈现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-video-wuyinkeji

[English](README.md) | 中文

<a id="summary"></a>
## 概述

挂载 `dsh-video-wuyinkeji` 以速创的异步视频任务 API 支撑 `ctx.video`：每个请求将文本提示（可附尺寸、时长、宽高比、首尾帧与参考媒体 URL 提示）以 JSON 提交到配置 `model` 选择的视频任务端点（Google-Omni、MiniMax H3 或 Grok Imagine），调用时从 `authEnv` 指定的环境变量读取 API 密钥，轮询结果详情直至结算，并把结算后的视频 URL 下载为原始字节。基础 URL 与凭据由部署持有。失败以类型化 `VIDEO_PROVIDER_FAILED` 错误呈现——没有本地回退生成。注册是 effect 范围的；释放即注销提供方。

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

当部署通过速创的异步视频任务 API 或速创兼容端点生成视频时，选择本提供方。`authEnv` 是必需配置；`baseURL` 默认指向公开的 `https://api.wuyinkeji.com`，`model` 选择提交路径与请求字段映射（`google-omni`，默认值；`minimax-h3` 或 `grok-imagine`）。本提供方不携带密钥材料。

### 配置

```yaml
- name: '@deepseek-ai/dsh-video-wuyinkeji'
  config:
    authEnv: DSH_WUYINKEJI_API_KEY
    model: minimax-h3
    pollIntervalMs: 10000
    timeoutMs: 600000
```

`authEnv` 指定持有 API 密钥的环境变量名——绝不是密钥本身。配置的 `model` 决定请求的可选精修如何映射到端点字段。`google-omni` 机械地映射：`size` 的乘号被改写（`1280×720` 变为 `1280x720`），`duration` 以字符串发送，`referenceImage` 成为端点的 `images` 字段，`referenceVideo` 成为其 `video` 字段；它们都不在本地校验，不支持的值在远端失败。`minimax-h3` 将 `firstFrame`、`lastFrame`、`referenceImage`、`referenceVideo` 与 `referenceAudio` 转发为 `first_frame`、`last_frame`、`images`、`videos` 与 `audios`，并在本地解读其提示：`duration` 必须是 4–15 秒的整数，`aspectRatio` 必须是可接受的宽高比（`adaptive`、`21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`），`size` 必须是像素对（短边决定 `768P` 或 `2K` 分辨率档，未显式设置 `aspectRatio` 时可约分出宽高比则一并派生）或分辨率 token（`768P`、`2K`）——首尾帧图与参考媒体互斥，违反或无法解读的提示在任何 I/O 之前以 `VIDEO_INVALID_REQUEST` 本地失败。`grok-imagine` 将 `referenceImage` 转发为单元素 `image_urls` 数组，并在本地解读其提示：`duration` 必须是 6–10 秒的整数，`aspectRatio` 必须是 `16:9` 或 `9:16`；端点没有对应字段的提示（首尾帧条件、参考视频、参考音频）被丢弃，违反在任何 I/O 之前以 `VIDEO_INVALID_REQUEST` 本地失败。`pollIntervalMs`（默认 10000）间隔结果详情轮询；`timeoutMs`（默认 600000）一并约束提交、轮询与下载，在内置工具调用预算内到期，使慢速生成报告本类型化超时而非被通用工具截止抢先——视频生成以分钟计，因此预算高于图像提供方。密钥在调用时读取，轮换环境变量在下次请求即生效，无需重启。

### 失败与恢复

缺失凭据变量、传输失败、非 2xx 响应、非 JSON 响应体、提交或结果详情被拒绝、未知任务状态、任务失败或整体超时，各自以 `VideoError` `VIDEO_PROVIDER_FAILED` 抛出并在消息中指明失败点。调用方——包括 `dsh-tool-video`——报告失败；不会降级为伪造视频。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

### 设计理念

- **Service Provider 角色。** 本包在 `ctx.video` 上注册一个 `VideoProvider`（`id: video-wuyinkeji`），此外一无所持：没有工具、没有提示、没有存储。
- **凭据按引用。** 配置持有 API 密钥变量的*名称*；机密在调用时从环境读取，从不写入配置、日志或请求体——端点的协议只把密钥放在请求的凭据槽位中，且传输诊断会将其脱敏。
- **异步任务生命周期。** 一次提交以任务 id 应答；结果详情轮询报告结算；结算后的视频 URL 被下载为原始字节，这是 seam 面向字节的结果词汇能承载的唯一应答形态。
- **模型选择的端点。** 一个实例提交到配置 `model` 选择的视频任务路径，结果详情路径、轮询与下载在各部署间保持共享。
- **类型化失败。** 每个端点侧失败都成为 `VIDEO_PROVIDER_FAILED`，调用方依据 `code` 路由而不是解析传输错误。

### 源码地图

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema 与提供方注册 |
| [`src/generate.ts`](src/generate.ts) | 异步客户端：提交（含精修规范化）、结果详情轮询、视频下载、类型化失败 |
| — | 不发布运行时不变式伴生入口；除所属接缝强制执行的约定外，本包没有独立的事件序列或可变数据关系。 |

</details>

-----

<a id="further-exploration"></a>
## 深入探索

- [dsh-video](../video/README.zh.md) — 本提供方注册的 seam。
- [dsh-tool-video](../tool-video/README.zh.md) — 消费生成视频的面向模型工具。
- [video 组地图](../README.zh.md) — 四包家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

无影响；本提供方应答生成请求而不向模型请求贡献任何内容，面向模型的 schema 与渲染由 `dsh-tool-video` 持有。

#### KV Cache 影响

无影响；本提供方不向模型请求贡献任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义提供方的当前范围。它们是包约束，不是任务清单。

- **每实例一个端点** —— 需要多个端点的部署必须挂载多个上下文；seam 的单提供方规则本就禁止并注册。
- **仅取首个视频** —— 结算任务的 `result` 数组映射第一项；多视频结果未建模。
- **Google-Omni 透传提示** —— 在 `google-omni` 上，请求的 `size`、`duration` 与参考媒体 URL 机械地转为线上字段，仅乘号被改写为 `x`。没有任何本地校验，不支持的值在远端以 `VIDEO_PROVIDER_FAILED` 失败；`minimax-h3` 与 `grok-imagine` 在本地以 `VIDEO_INVALID_REQUEST` 校验其提示。
- **各限一个参考** —— seam 的请求词汇至多携带一个参考图 URL 与一个参考视频 URL；Google-Omni 端点也各至多接受一个，MiniMax H3 与 Grok Imagine 能接受的参考图数量超出词汇所能表达。
- **无本地引擎** —— 生成依赖配置的端点；离线部署得到可操作的 `VIDEO_PROVIDER_FAILED` 而不是结果。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

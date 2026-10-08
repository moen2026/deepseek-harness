---
description: "audio 组地图：经音频接缝的语音转写、凭据由部署持有的 OpenAI 兼容 HTTP 提供者，以及面向模型的 transcribe_audio 工具，面向浏览本组的用户与维护者。"
kind: "package-group"
---

# audio/ — 面向智能体的语音转写

[English](README.md) | 中文

## 概述

audio 组让智能体把工作区音频文件转成文本：`transcribe_audio` 解析文件、在字节预算内读取，并返回提供者的转写文本。用 `audio-http` 以 OpenAI 兼容的 `/audio/transcriptions` 端点支撑接缝——其 URL、模型与凭据由部署持有——并用 `tool-audio` 把转写暴露给模型。共享的 `audio` 包保持请求与转写词汇表与提供者无关，因此替换提供者不会改变模型请求。本组不内置任何转写引擎、不选择任何模型，未挂载提供者时不应答任何请求。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx key |
|---|---|---|
| [`audio/`](audio/README.zh.md) | 定义音频服务：独占式单提供者保留与一条顺序无关路由（transcribe） | `ctx.audio` |
| [`audio-http/`](audio-http/README.zh.md) | 将原始音频字节上传到部署指定的 OpenAI 兼容端点，并把应答映射到接缝的转写文本 | registers on `ctx.audio` |
| [`tool-audio/`](tool-audio/README.zh.md) | 经文件系统把转写以 `transcribe_audio` 暴露给模型 | registers on `ctx.tools` |

提供者上传字节并说端点协议，而非工具：`tool-audio` 是面向模型名称、模式、提示指导与呈现的唯一持有者，因此替换提供者永远不会改变模型请求转写的方式。

-----

<a id="related-documentation"></a>
## 相关文档

- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-audio) — 模型收到的 `transcribe_audio` 模式。
- [audio 子系统](../../docs/subsystems/audio.zh.md) — 本组的注册面与三包组合方式。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

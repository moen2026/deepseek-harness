---
description: "video 组地图：经 video seam 的视频生成、其凭据由部署持有的速创与火山引擎 Ark 异步提供方，以及面向模型的 generate_video 工具，供用户与维护者导航本组。"
kind: "package-group"
---

# video/ — 面向 Agent 的视频生成

[English](README.md) | 中文

<a id="summary"></a>
## 概述

video 组让 Agent 从提示创建视频：`generate_video` 将提示发送给提供方，把生成字节提交为文件附件并在有界文本信封旁返回文件。用 `video-wuyinkeji`（提交到模型所选端点——Google-Omni、MiniMax H3 或 Grok Imagine——轮询后下载）或 `video-volc`（火山引擎 Ark Seedance 任务，轮询后下载）支撑 seam；基础 URL、模型与凭据由部署持有。`tool-video` 将生成能力暴露给模型。共享的 `video` 包保持请求与结果词汇提供方中立，更换提供方绝不改变模型请求。本组不内置生成引擎，未挂载提供方时不回答任何请求。

<a id="table-of-contents"></a>
## 目录

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## 包

| Package | Role | ctx key |
|---|---|---|
| [`video/`](video/README.zh.md) | 定义 video 服务：排他的单提供方保留加一条顺序无关路由（generate） | `ctx.video` |
| [`video-wuyinkeji/`](video-wuyinkeji/README.zh.md) | 将文本提示提交到配置 `model` 选择的速创视频任务端点（Google-Omni、MiniMax H3 或 Grok Imagine），轮询任务直至结算，把结算后的视频 URL 下载为原始字节 | registers on `ctx.video` |
| [`video-volc/`](video-volc/README.zh.md) | 向火山引擎 Ark 推理面（Seedance）提交任务——chat-completions 形态，或 Seedance 2.5 模型的 content-generation 家族——轮询直至结算，把结算后的视频 URL 下载为原始字节；可选地把参考图登记为私域 Seedance 素材 | registers on `ctx.video` |
| [`tool-video/`](tool-video/README.zh.md) | 经 `generate_video` 通过 attachment 存储将生成能力暴露给模型 | registers on `ctx.tools` |

提供方提交提示并说端点协议，而不是工具：`tool-video` 是面向模型名称、schema、提示指导与呈现的唯一持有者，更换提供方不会改变模型请求视频的方式。

-----

<a id="related-documentation"></a>
## 相关文档

- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-video) — 模型收到的 `generate_video` schema。
- [视频子系统](../../docs/subsystems/video.zh.md) — 本组的注册面与各包的组成方式。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

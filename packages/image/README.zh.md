---
description: "image 组地图：经 image seam 的图像生成、其凭据由部署持有的 HTTP 提供方（OpenAI 兼容、火山方舟 Seedream 图层拆分与速创异步），以及面向模型的 generate_image 工具，供用户与维护者导航本组。"
kind: "package-group"
---

# image/ — 面向 Agent 的图像生成

[English](README.md) | 中文

<a id="summary"></a>
## 概述

image 组让 Agent 从文本提示创建图像：`generate_image` 将提示发送给提供方，把生成字节持久提交为图像附件，并在有界文本信封旁返回图像本身。用 `image-http`（OpenAI 兼容的 `/images/generations` 端点）、`image-ark`（火山方舟同步 Seedream 端点，可选拆分为叠放图层）或 `image-wuyinkeji`（速创的异步任务 API：GPT-Image-2.5 或经 `model` 选定的 NanoBanana2Lite）支撑 seam；URL、模型与凭据由部署持有。`tool-image` 将生成能力暴露给模型。共享的 `image` 包保持请求与结果词汇提供方中立，更换提供方不会改变模型请求。本组不内置生成引擎，未挂载提供方时不回答任何请求。

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
| [`image/`](image/README.zh.md) | 定义 image 服务：排他的单提供方保留加一条顺序无关路由（generate） | `ctx.image` |
| [`image-http/`](image-http/README.zh.md) | 将文本提示提交到部署指定的 OpenAI 兼容端点，并把应答映射为 seam 的图像结果 | registers on `ctx.image` |
| [`image-ark/`](image-ark/README.zh.md) | 将文本提示提交到火山方舟同步 Seedream 端点，并把应答——普通图像或拆分图层——映射为 seam 的图像结果 | registers on `ctx.image` |
| [`image-wuyinkeji/`](image-wuyinkeji/README.zh.md) | 将文本提示提交到 `model` 选定的速创异步任务端点（GPT-Image-2.5 或 NanoBanana2Lite），轮询任务直至结算，把结算后的图像 URL 下载为原始字节 | registers on `ctx.image` |
| [`tool-image/`](tool-image/README.zh.md) | 经 `generate_image` 通过 attachment 存储将生成能力暴露给模型 | registers on `ctx.tools` |

提供方提交提示并说端点协议，而不是工具：`tool-image` 是面向模型名称、schema、提示指导与呈现的唯一持有者，更换提供方不会改变模型请求图像的方式。

-----

<a id="related-documentation"></a>
## 相关文档

- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-image) — 模型收到的 `generate_image` schema。
- [图像子系统](../../docs/subsystems/image.zh.md) — 本组的注册面与各包的组成方式。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

---
description: "火山方舟（Seedream）图像生成提供方，接入 DeepSeek Harness 图像缝（ctx.image）——把提示词同步 JSON 提交到方舟 /images/generations 端点，支持参考图条件生成与图层拆分，下载应答中的每个图像 URL 为原始字节，调用时读取凭据，失败以类型化 provider 错误上报。"
kind: "package-reference"
---

# @deepseek-ai/dsh-image-ark

[English](README.md) | 中文

## Summary

挂载 `dsh-image-ark`，用火山方舟的 Seedream 图像生成支撑 `ctx.image`：每次请求把文本提示词同步提交到 `/api/v3/images/generations` 端点，API key 在调用时从 `authEnv` 命名的环境变量读取，应答携带的每个图像 URL 都被下载为原始字节。普通生成应答一张图；`layerDecomposition: true` 让 Seedream 把应答拆分为叠放图层，提供方把每层的 `z_index`、裁剪后尺寸、边界框、名称与描述映射到缝的图层词汇。Base URL、模型与凭据由部署持有。失败以类型化 `IMAGE_PROVIDER_FAILED` 错误上报——没有本地兜底生成。注册是 effect 作用域的；释放即注销提供方。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### When to choose it

部署通过火山方舟 Seedream 模型或方舟兼容端点生成图像时选择此提供方。`authEnv` 是必填配置；`arkBaseURL` 默认公共 `https://ark.cn-beijing.volces.com`，`model` 默认 Seedream 5.0 Pro。包本身不携带任何密钥材料。

### Configuration

```yaml
- name: '@deepseek-ai/dsh-image-ark'
  config:
    authEnv: DSH_ARK_API_KEY
    layerDecomposition: true
    outputFormat: png
    timeoutMs: 120000
```

`authEnv` 命名持有 ARK API key 的环境变量——绝不是 key 本身。`arkBaseURL` 是方舟推理 base URL，提交路径追加其后；`model` 选择 Seedream 模型（默认 `doubao-seedream-5-0-pro-260628`）。`layerDecomposition`（默认 false）提交 `layer_decomposition`，让端点把应答拆分为叠放图层。`outputFormat` 提交 `output_format`（`png` 或 `jpeg`）；省略值不带该字段。`timeoutMs`（默认 120000）把提交与全部下载合并计时，在既有工具调用预算内超时，慢生成先报出本包的类型化超时而非被通用工具期限抢先。key 在调用时读取，轮换环境变量在下次请求即生效、无需重启。

### Failures and recovery

缺失凭据变量、传输失败、非 2xx 响应、非 JSON body、应答无图像、拆分图层缺少可用 `z_index` 或尺寸、下载失败——每种都抛出 `ImageError` `IMAGE_PROVIDER_FAILED`，消息指明失败点。调用方——包括 `dsh-tool-image`——负责上报失败；不会退化成伪造图像。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Service Provider 角色。** 包在 `ctx.image` 上注册一个 `ImageProvider`（`id: image-ark`），此外不拥有任何东西：没有工具、提示词、存储。
- **凭据按引用。** 配置只存 API key *变量名*；密钥在调用时从环境读取，绝不写进配置、日志或请求体。
- **同步提交。** 端点一次往返应答全部产出图像的 URL，提供方将其下载为原始字节——缝的面向字节结果词汇唯一承载的应答形态。
- **图层词汇映射。** 开启拆分后，每个应答条目变成一个 `ImageLayer`——`z_index`、自身裁剪后的像素范围、合成图内的绝对边界框、端点命名的名称与描述——结果的字节承载最低层（合成背景）。
- **类型化失败。** 端点侧失败一律变为 `IMAGE_PROVIDER_FAILED`，调用方按 `code` 路由而非解析传输错误。

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema 与提供方注册 |
| [`src/generate.ts`](src/generate.ts) | 同步客户端：提交、并行下载全部应答 URL、图层映射、类型化失败 |
| — | 未发布运行时不变量伴随物；本包在其所属缝已强制约束之外，不暴露独立事件序列或可变数据关系。 |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-image](../image/README.zh.md) — 本提供方注册的缝。
- [dsh-tool-image](../tool-image/README.zh.md) — 消费生成图像的模型侧工具。
- [image 组地图](../README.zh.md) — 包家族与相关文档。

-----

<a id="model-experience"></a>
## Model Experience

无：提供方只应答生成请求，不向模型请求贡献任何内容；`dsh-tool-image` 拥有模型侧 schema 与渲染。

#### KV Cache effect

无影响；本提供方不向模型请求贡献任何内容。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


这些限制划定本提供方当前范围，属于包约束而非任务清单。

- **每实例一个端点** —— 需要多个端点或模型的部署须挂载多个 context；缝的单提供方规则本就禁止共同注册。
- **仅取首条参考图** —— 请求的 `referenceImages` 中只有第一个 URL 作为端点 `image` 字段提交；方舟图像端点只接受一张条件图。
- **透传 size 提示** —— 请求的 `size` 原样作为端点 `size` 提交；词汇不做本地校验，不支持的提示远端失败并报 `IMAGE_PROVIDER_FAILED`。
- **图层尺寸由端点报告** —— 各层尺寸来自条目的 `size` 字段，不与下载字节核对。
- **无本地引擎** —— 生成依赖所配置端点；离线部署得到可操作的 `IMAGE_PROVIDER_FAILED` 而非结果。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

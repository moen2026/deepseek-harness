---
description: "DeepSeek Harness 视频 seam（ctx.video）的火山引擎 Ark（Seedance）视频生成提供方——向 Ark 推理面提交任务（Bearer ARK 密钥鉴权；默认 chat-completions，Seedance 2.5 模型走 content-generation 任务家族）、轮询任务直至结算、把结算后的视频 URL 下载为原始字节、可选地经签名的火山引擎 OpenAPI 管控面（HMAC-SHA256 AK/SK）把公网参考图登记为私域 Seedance 素材、调用时读取凭据、类型化提供方失败错误。"
kind: "package-reference"
---

# @deepseek-ai/dsh-video-volc

[English](README.md) | 中文

## Summary

挂载 `dsh-video-volc` 以火山引擎 Ark 的 Seedance 视频生成支撑 `ctx.video`：每个请求把提示词及其提示以任务提交到 Ark 推理面（Bearer ARK 密钥鉴权；默认 chat-completions，Seedance 2.5 模型走 content-generation 任务家族），轮询直至结算，结算后的视频 URL 被下载为原始字节。部署同时配置管控面 AK/SK 对时，每张公网参考图先登记为私域 Seedance 素材并以 `asset://` 引用。凭据在调用时从配置指定的环境变量读取；失败以类型化 `VIDEO_PROVIDER_FAILED` 错误呈现；注册是 effect 范围的。

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

部署经火山引擎 Ark 的 Seedance 模型或 Ark 兼容端点生成视频时选择本提供方。`authEnv` 是必填配置；`arkBaseURL` 默认公共推理面，可选的 `assetAuthEnv`/`assetSecretEnv` 对开启参考图的私域素材登记。本包不持有任何密钥材料。

### Configuration

```yaml
- name: '@deepseek-ai/dsh-video-volc'
  config:
    authEnv: DSH_ARK_API_KEY
    assetAuthEnv: DSH_VOLC_ACCESS_KEY_ID
    assetSecretEnv: DSH_VOLC_SECRET_ACCESS_KEY
    project: default
    assetGroupId: my-seedance-group
    pollIntervalMs: 10000
    timeoutMs: 600000
```

`authEnv` 指定持有 ARK API 密钥的环境变量名——绝不是密钥本身。配置的 `model` 选择任务家族：官方 Ark 模型 id（`doubao-seedance-*`，Seedance 1.0 与 2.5 皆是）提交 content-generation 任务——提示词成为 `text` 条目，每张存在的参考图、参考视频或参考音频成为一条带角色的 typed content 条目，`aspectRatio` 映射到 `ratio`，`size` 映射到 `480p`/`720p`/`1080p` 分辨率档位——其余模型保持 chat-completions 提交：提示词成为 user 消息，唯一的 `referenceImage` 成为前导的 `reference_image` 消息条目，`size` 选择 `720p` 或 `1080p` 档位。两个家族的 `duration` 都必须是正整数秒（content-generation 的 `-1` sentinel 除外）；不可解释的提示或时长在任何 I/O 前以 `VIDEO_INVALID_REQUEST` 失败，家族没有对应字段的提示被丢弃。对 content-generation 提交，`generateAudio` 提交 `generate_audio`，`referenceTaskType` 提交 `extra_body.omni_reference_task_type`——`reference` 为全模态参考生成，`edit` 为编辑提示词中以 `@视频N` 寻址的参考视频，`extend` 为把参考视频延续到结尾之后——`duration` 为 `-1` 时透传端点的自动时长 sentinel，由模型决定时长；省略值不带这些字段。`assetAuthEnv` 与 `assetSecretEnv` 成对配置（只配其一在挂载时失败）时，每张公网参考图先登记为私域 Seedance 素材——归入 `project`（默认 `default`）、编入 `assetGroupId`（省略时首次使用即创建）、轮询其审核——生成以 `asset://<id>` 引用已审核素材；管控面请求以该 AK/SK 对的火山引擎 HMAC-SHA256 请求签名鉴权。`pollIntervalMs`（默认 10000）间隔任务与素材轮询；`timeoutMs`（默认 600000）一并约束提交、轮询与下载，在既有工具调用预算内到期，慢生成先报出本类型化超时再被通用工具截止期抢占。每个凭据都在调用时读取，轮换环境变量对下一次请求即生效，无需重启。

### Failures and recovery

缺失的凭据变量、传输失败、非 2xx 响应、非 JSON 主体、被拒绝的提交、任务或管控面调用、结算为失败的任务或素材、缺失的任务 id 或视频 URL、到期的整体超时，各自抛出 `VideoError` `VIDEO_PROVIDER_FAILED`，消息指明失败点，且传输诊断中的凭据已被脱敏。调用方——包括 `dsh-tool-video`——报告失败；没有任何路径退化为伪造视频。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Service Provider 角色。** 本包在 `ctx.video` 上注册一个 `VideoProvider`（`id: video-volc`），此外一无所持：没有工具、没有提示、没有存储。
- **两个面、两种凭据。** 生成经 Bearer ARK API 密钥对话 Ark 推理面；私域素材登记经 HMAC-SHA256 签名的 AK/SK 对对话火山引擎 OpenAPI 管控面。每个凭据留在自己的面上，调用时从配置指定的环境变量读取，并从传输诊断中脱敏。
- **异步任务生命周期，两个任务家族。** 配置的模型选择家族：chat-completions 形态的 POST 或 content-generation 任务的 POST 应答任务 id；任务轮询报告结算；结算后的视频 URL 下载为原始字节——seam 字节型结果词汇能承载的唯一答案形态。
- **先生成素材再生成视频。** 配置了管控面时，公网参考图先登记、审核并以 `asset://` 寻址，再行提交，生成引用的是已审核私域素材而非原始公网 URL。
- **类型化失败。** 每个端点侧失败都变成 `VIDEO_PROVIDER_FAILED`，调用方依据 `code` 路由而不是解析传输错误；端点无法表达的请求提示在任何 I/O 前以 `VIDEO_INVALID_REQUEST` 本地失败。

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema、素材客户端接线、提供方注册 |
| [`src/generate.ts`](src/generate.ts) | 推理客户端：带提示规范化的任务提交、任务轮询、视频下载、类型化失败 |
| [`src/asset.ts`](src/asset.ts) | 管控面客户端：签名 OpenAPI 调用、组与素材创建、审核轮询 |
| [`src/internal.ts`](src/internal.ts) | 共享失败映射、凭据脱敏、感知中止的轮询 sleep |
| — | 不发布运行时不变量伴包；本包除其所属 seam 强制的契约外不暴露独立事件序列或可变数据关系。 |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-video](../video/README.zh.md) — 本提供方注册的 seam。
- [dsh-tool-video](../tool-video/README.zh.md) — 消费生成视频的模型侧工具。
- [video 组地图](../README.zh.md) — 包家族及其相关文档。

-----

<a id="model-experience"></a>
## Model Experience

无；本提供方应答生成请求，不向模型请求贡献任何内容；`dsh-tool-video` 持有模型侧 schema 与渲染。

#### KV Cache effect

无影响；本提供方不向模型请求贡献任何内容。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


这些限制划定本提供方的当前范围。它们是包约束，不是任务清单。

- **每实例一对端点** —— 需要多个推理面或管控面的部署必须挂载多个 context；seam 的单提供方规则本就禁止共注册。
- **仅时长与尺寸本地解释** —— `duration` 与 `size` 以 `VIDEO_INVALID_REQUEST` 本地校验；端点没有字段的其他提示被静默丢弃而不上报。
- **每类一条参考** —— seam 的请求词汇至多携带一条参考图、参考视频与参考音频 URL；Seedance 2.5 content-generation 家族每类可接受数十条，索引多条目的多参考提示仍超出词汇的表达力。
- **无本地引擎** —— 生成依赖配置的端点；离线部署得到可操作的 `VIDEO_PROVIDER_FAILED` 而不是结果。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

---
description: "通过外部托管的 OpenVoice v2 服务合成克隆音色语音。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-text-to-speech-openvoice

[English](README.md) | 中文

## 摘要

本 Provider 通过环回 HTTP 把合成请求路由到外部托管的 OpenVoice v2 服务。服务运行 MeloTTS-Chinese 加 OpenVoice 音色转换器，一段简短的参考录音即可成为一个可选音色。激活时不下载、不加载模型；Host 把运行中的服务视为运维前置条件。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

`serviceOrigin` 指向服务（默认 `http://127.0.0.1:9092`）；`voice` 选择调用方省略时使用的克隆音色，`speed` 在 0.5 到 2 之间缩放。克隆音色即服务 `references/` 目录下的 WAV 文件：文件名主干就是音色 id，服务按请求提取音色嵌入，因此新增或替换录音无需重启。Provider 在每次合成前重新探测音色清单，并通过服务的 `catalogChanged()` 公布结果，因此新放入的录音在下一次合成后即可在设置页选中。

`displayName` 是设置页中显示的 Provider 名称，因此一次部署可以为第二个服务注册独立条目，各自携带 `providerId`、`displayName`、`serviceOrigin` 与 `requestTimeoutMs`。

服务的启动与升级在 Host 之外进行。服务不可达时注册仍然成功、清单为空，合成会以传输错误失败。

Provider 公布接收录音的条件——`audio/wav` 与 `audio/flac`，受 `maxReferenceBytes` 约束——`intakeVoice()` 经 `PUT /references?name=` 把一段录音以给定音色 id 存入服务，随后重新探测名册，因此刚存入的录音立即可选，无需等待下一次合成。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节 — 点击展开</summary>

Provider 不拥有子进程也不拥有准备流程：就绪状态属于服务，省略 `TtsPreparation` 让设置页把该 Provider 报告为就绪。`/health` 发布克隆音色清单并经 schema 校验；`/synthesize` 接收 `{text, voice, speed}` 并返回完整的 PCM WAV 容器，其头部携带采样率。`/references` 把请求体以查询参数中的名称存入并返回更新后的名册；接收失败不会改动原名册。`maxTextChars`、`maxAudioBytes`、`maxReferenceBytes`、`requestTimeoutMs` 与 `healthTimeoutMs` 约束请求与响应，调用方取消会传播到进行中的请求。每次成功的探测都通过 `catalogChanged()` 公布清单；激活时的探测失败只记录警告，把发现推迟到下一次合成。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音输入子系统](../../../docs/subsystems/voice-input.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，合成请求不进入模型请求。

#### KV Cache 效应

无直接影响。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 对带外放入的文件，音色清单仍是拉取式的：直接放进 `references/` 的参考录音要在下一次合成或接收重新探测后才可见，且没有覆盖服务部署的准备状态。
- Host 不监督服务可用性；持久化自启动属于部署而非本包。

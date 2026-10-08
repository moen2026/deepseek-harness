---
description: "本地语音 Provider 共享的受管 worker、下载与回环协议原语。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-local-speech-runtime

[English](README.md) | 中文

## 概述

此库包承载本地语音 Provider 共享的原语:带校验的资产下载、镜像模型源探测、私有回环协议,以及受管 worker 生命周期。它不定义服务,也不发布原生代码。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

从 Provider 包组合使用;不要直接挂载。`matchesAsset`、`downloadAsset` 与 `orderAssetSources` 实现以大小和摘要固定的原子发布下载。`startLoopbackServer` 服务一个经认证的私有端点,其 stdout 只承载就绪帧。`ManagedSpeechWorker` 以有界、可取消的调用与空闲回收,持有一个串行子进程。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

`downloadAsset` 流式写入唯一的部分文件,校验固定字节数与 SHA-256 摘要后原子改名落盘;失败被分类为 `SpeechDownloadError` 诊断,不含凭据、查询串与原始原因。`orderAssetSources` 并发 HEAD 探测并优先采用首个 2xx 响应,同时保留配置顺序作为回退。`readReady`、`readJsonReply` 与 `readBufferReply` 以字节上限界定 worker 协议帧。`ManagedSpeechWorker` 把调用排在串行尾部之后,发布节流中间下载进度的完整准备快照,应用独立的准备与推理期限,并在取消或释放时汇合已接受的工作。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音输入子系统](../../../docs/subsystems/voice-input.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只下载并校验固定的语音资产，不接触模型请求。

#### KV 缓存影响

没有直接影响。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 协议假定 Provider 定义的每连接单请求形态;多路复用延后。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>

---
description: "按需准备并运行本地 CPU Kokoro 合成 worker。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-text-to-speech-kokoro

[English](README.md) | 中文

## 概述

此 Provider 在 Host CPU 上使用 Kokoro-82M v1.1-zh ONNX 与 espeak-ng 音素化进行语音合成。平台专用 sherpa-onnx Node 包内置 ONNX Runtime;用户无需 Python、编译器或模型转换。激活时只检查缓存资源,不加载模型也不下载资产。

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

bundle 提供位于 DSH 主目录下的绝对 `dataRoot`。准备过程下载版本固定的 `kokoro-multi-lang-v1_1` tarball,校验大小与 SHA-256,解压后逐一校验托管文件。`voice` 默认 `zf_001`,可选择任何已公布的 `zf_*` 或 `zm_*` 音色;`speed` 在 0.5 到 2 之间缩放。`modelDirectory` 提供包含已解压 bundle 的现有绝对目录;`espeakDataDir` 选择现有 espeak-ng-data 目录。已验证的完整文件在取消或失败后仍可复用。

下载 tarball 前,Host 对配置的 `modelOrigins` 发起探测,默认为官方 GitHub 发布与两个镜像前缀。`modelProbeTimeoutMs` 默认 3000 ms;全部探测失败时按配置顺序下载。网络、HTTP、证书与完整性失败会尝试其余源;取消、存储失败与未分类失败会终止准备。固定的大小与 SHA-256 适用于每个源。显式 `modelOrigin` 只使用该源,不探测也无回退。完全离线部署不公布任何下载源。

每次激活都会检查磁盘上已解压的 bundle。完整且验证过的缓存经检查后立即恢复就绪;首次合成唤醒 worker。文件缺失或托管校验和不匹配时需要显式准备,不可读路径则报告错误。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

一个受管 Node 子进程串行执行推理。唤醒期间提交的文本加入有界队列。执行时 worker 要求就绪或待命资源。合成不会启动准备下载。`threads` 调整 CPU 推理;`maxTextChars` 与 `maxAudioBytes` 限制输入与回复;`maxPending` 限制接受的工作。准备与推理使用独立期限。非法文本、音色或语速输入在原生推理前被拒绝并保留已加载的 worker;推理失败、畸形回复与传输失败会回收它。取消会终止活动 worker 并等待其进程区间;已取消的排队文本不会执行。`idleTimeoutMs` 在空闲后释放 worker,为零则保留到释放为止。模型保持缓存。经认证的回环请求把音频保持在内存中;私有 worker 以完整 PCM16 WAV 容器回复,其头部携带原生采样率。打包的 `runtime/assets.json` 固定每个托管文件的哈希,以及 `voices.bin` 内嵌的音色到说话人顺序。不发布运行时不变量伴随模块,因为 `dsh-subprocess` 拥有进程区间观察,本 Provider 没有需要对账的独立投影。

Host 跨页面与 Session 变更持有准备:检查资源、下载 tarball、解压并复制 bundle、校验文件、加载 worker。显式模型路径省略其下载步骤。下载报告字节数;其他步骤报告耗时。空闲 worker 保留已准备路径,唤醒时只需加载模型。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音输入子系统](../../../docs/subsystems/voice-input.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无,合成请求与准备不进入模型请求。

#### KV 缓存影响

没有直接影响。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 未提供流式合成与 GPU 加速;长文本受 `maxTextChars` 限制而不做分块。
- 音色选择通过配置与目录暴露;专用选择器延后。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

模型以 Apache-2.0 许可发布;固定 tarball 哈希记录于 `runtime/assets.json`,实测自官方发布归档。

</details>

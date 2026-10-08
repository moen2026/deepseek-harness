---
description: "命名实验语音合成 Provider,显式路由与准备归属。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-text-to-speech

[English](README.md) | 中文

## 概述

此 Service Definition 通过 `ctx.textToSpeech` 选择命名语音合成器。消费方在执行前解析请求;Provider 独立注册。

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

将此服务与 Provider 和消费方组合。`defaultProvider` 选择一个确切的已注册 id,组合恰好注册一个 Provider 时可省略;Provider 名册无法确定默认值时显式失败。`voiceId` 提供省略时的音色,`speed` 提供省略时的语速;两者均为易变偏好。Provider 缺失或重复时显式失败。

Provider 通过 `downloadSources` 公布准备下载源。`prepare(id, options)` 为单个任务转发可选的 `downloadSource`;Provider 校验该选择,并拒绝在准备进行中变更源。省略时保留 Provider 策略。源选择不是持久化的合成偏好。

接受录音的 Provider 通过 `intake` 公布接收条件;`intakeVoice(id, intake, signal)` 把提交的录音交给确切的注册执行,并在 Provider 名册反映出该音色后返回可选音色。没有 `intake` 的 Provider 显式拒绝。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

`resolve()` 捕获 Provider 实例、文本、音色与语速。`synthesize()` 拒绝已撤销或被替换的注册。注册 disposer 关闭准入、中止已接受的请求并等待 Provider 结算;Provider 必须遵守取消。任何回退都不会选择其他合成器。不发布运行时不变量伴随模块,因为注册表是 Provider 与准备观察的唯一来源。

`intakeVoice()` 与 `synthesize()` 遵循同样的注册纪律:调用方与注册的合并 signal 可中止等待中与进行中的接收,被撤销的注册在结算前等待已提交的接收。

`defaultProvider`、`voiceId` 与 `speed` 是易变 Config 字段:`configure()` 通过 `settings` 服务把传入字段写入本插件的 profile 条目,运行中的实例无需重挂载即读取更新值。缺少 `settings` 或 profile 条目时 `configure()` 失败,并在保存前拒绝所选 Provider 不支持的音色或语速。Provider 通过 `voices` 公布支持的音色;`resolve()` 在合成前校验所选音色与语速。Provider 的 `voices` 名单在注册之外发生变化时,通过 `catalogChanged()` 公布,就绪跟随者从新快照重新读取公布的事实。Provider 自有的准备通过完整 `TtsSnapshot` 值观察;关闭观察者不会取消准备。

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

- 未提供流式合成与 Provider 侧发音词典。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>

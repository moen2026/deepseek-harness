---
description: "从插件管理页启用实验性朗读。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-read-aloud-bundle

[English](README.md) | 中文

## 概述

此可选 Bundle 组合语音合成服务定义、本地 Kokoro Provider 与面向浏览器朗读操作的带认证 Remote。随包配置默认禁用。

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

打开 Web 侧栏的插件管理页并启用带蓝色扬声器图标的“朗读”。模型需要准备时，弹窗提供“前往安装”和“稍后”选项；“前往安装”打开 Bundle 详情。在详情中选择“下载并准备”；默认折叠的当前步骤摘要可展开为完整步骤列表。下载报告真实字节，校验和加载显示等待时间。Provider 就绪后，助手消息上的朗读按钮会从浏览器语音引擎切换到本机 Kokoro 合成；播放中点击停止会立即中止音频。禁用 Bundle 会取消当前任务；缓存资源保留在磁盘上。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

静态 `cordis.patch.yml` 添加合成服务、其 Kokoro、OpenVoice 与 CosyVoice Provider 条目以及经过认证的 Remote；默认 Provider 为 `openvoice-local`，并通过 `dshHomePath` 提供 Kokoro 缓存目录。Chat 插件自身不挂载 Remote：它观察 `tts.follow` 并把失败流读作浏览器引擎回退，因此没有此 Bundle 时朗读按钮仍通过 Web Speech 工作。可选 Bundle 安装使插件管理器能够发现此包，但不会在默认配置中选择它。此纯配置包没有独立可变的运行时状态，因此不发布不变量伴随模块。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音输入子系统](../../../docs/subsystems/voice-input.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为合成消费的是助手输出，准备过程也不进入模型请求。

#### KV 缓存影响

没有直接影响；模型永远不会收到合成的音频。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 此 Bundle 提供一个本地合成器。额外 Provider 使用不同 id 注册到同一服务——捆绑 patch 已把服务型客户端注册两次，各自携带自己的 id、显示名、地址与请求预算。云端合成需要显式增加 Provider 与凭据配置。Bundle 不增加模型工具或修改智能体循环。
- 安装 dsh 时会一并安装 `sherpa-onnx-node` 及其平台原生运行时（含 ONNX Runtime），即使此 Bundle 处于禁用状态。运行时的磁盘占用和下载量独立于“下载并准备”所下载的模型；原生包体积随平台和版本变化。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>

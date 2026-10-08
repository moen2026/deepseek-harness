---
description: "dsh Web 客户端插件页上的语音合成 Remote 设置页：提供方切换、音色选择、朗读语速与试听。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-speech

[English](README.md) | 中文

## Summary

在侧边栏打开「插件」，在官方组选择「语音」，即可选择朗读的提供方——合成器或浏览器内置语音——以及音色与语速。页面经 `tts` Remote namespace 镜像合成 catalog，每次修改立即生效——没有暂存草稿——试听按钮用当前选择朗读一段短样例；当提供方接受录音时，上传操作把所选文件存为新的可选音色。浏览器内置语音是客户端本地选择：不写入 Host 状态、在当前浏览器持久化，试听与之后的朗读都经浏览器语音引擎播放、没有合成延时。只有当合成 provider 进入 catalog 时页面才存在，未挂 read-aloud bundle 的部署不会显示任何痕迹。

## Table of Contents

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

官方组的「语音」卡片打开页面。「提供方」在已进入 catalog 的合成器与浏览器内置语音之间切换；切换会写入新提供方收录的音色——当前音色被收录时保留它，否则取该提供方的第一个。「音色」按显示名列出所选提供方的音色；「语速」接受 0.5 到 2 之间的数值。每次修改立即经 Remote namespace 写入，follow 流会确认回来，因此下一次朗读——包括来自另一个已打开客户端的朗读——都使用新选择。「试听」合成一段短样例并播放；播放中再次点击即取消。「上传录音」在所选提供方公布录音接收时出现：所选文件以文件名派生出的音色存为新音色，并立即被选中。选择浏览器内置语音后，音色行替换为禁用的系统默认音色、隐藏上传操作，试听经浏览器语音引擎播放、没有合成延时；该选择在当前浏览器持久化，选回任一合成器即回到 Host 合成。失败保留页面内容并以一行提示出现在控件下方。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

Host 半是空 `apply`，仅用于让该包持有一行 Loader 记录，供客户端模块系统据 package.json 的 dsh.client 声明服务浏览器半。浏览器半通过 Chat 朗读操作构建的同一份 `observeTtsReadiness` 镜像（自 `dsh-client-ui-chat` 导出）观察 provider 就绪状态，把页面投影保存在 `SnapshotStore` 之上的 `SpeechCardController`。选择走 `remote.tts.configure`，试听走 Chat 插件提供的 `readAloud.speak` 服务；浏览器内置语音即 Chat 插件的 `readAloud.engine` store——一项持久化的客户端偏好，不写入 Host 状态——其试听走 `readAloud.speakBrowser`。上传从所选文件名派生音色 id，走 `remote.tts.intakeVoice`。镜像报告流已连接且有 provider 进入 catalog 时，页面把 `SpeechCard` 注册进插件页的 `plugins.item` slot；流断开或清空时收起。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-plugin-manager](../ui-plugin-manager/README.zh.md) —— 插件页与页面注册进的 `plugins.item` slot。
- [ui-chat](../ui-chat/README.zh.md) —— 页面复用的就绪镜像与 WAV 播放帮助函数。
- [text-to-speech](../../experimental/text-to-speech/README.zh.md) —— 页面写入其 volatile Config 的服务。
- [api-text-to-speech](../../experimental/api-text-to-speech/README.zh.md) —— 页面读写的 Remote namespace。

-----

<a id="model-experience"></a>
## 模型体验

无；本包是浏览器侧设置面，不注册模型面。

#### KV Cache 效果

无；本包既不组装也不发送 provider 请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **运行时不变量：** 不发布 companion。页面自身不持有可独立观察的关系：显示内容派生自就绪镜像，写入由 Host 服务校验。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

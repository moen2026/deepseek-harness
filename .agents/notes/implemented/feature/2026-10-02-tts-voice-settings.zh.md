# Agent Note: TTS 语音设置页

Status: implemented

[English](2026-10-02-tts-voice-settings.md) | 中文

## Problem

朗读合成的选择只能通过组合配置修改：`voiceId` 与 `speed` 位于 `text-to-speech` 插件的 volatile Config，换一个音色意味着编辑 patch 文件并重启。合成 Remote 已经由 `tts` namespace 提供了客户端所需的一切——`catalog`、`follow`、`configure`、`prepare`、`synthesize`——但没有任何客户端界面消费它暴露的选择。想把云舟换成晴岚之外的声音、或想放慢朗读语速的用户，在产品内没有路径。

## Decision

`packages/client/ui-settings-speech`（`@deepseek-ai/dsh-client-ui-settings-speech`）按既有的一个 host-plane namespace 一个配套包模式提供设置页：Host 半是空 `apply`，浏览器半在插件页注册一张标题为「语音」的 `plugins.item` 卡片。

卡片通过 Chat 朗读操作已经在构建的同一份 `observeTtsReadiness` 镜像观察 provider 就绪状态（自 `@deepseek-ai/dsh-client-ui-chat/client` 导出）。有 provider 进入 catalog 时页面渲染：provider 选择器、按显示名列出所选 provider 音色的选择器、语速字段（0.5–2）、以及合成一段短样例并播放的试听按钮。写入走 `ctx.remote.tts.configure({ voiceId, speed })` 并立即生效——服务 Config 本就是 volatile 设计，follow 流会把新选择确认回来。

未挂 read-aloud bundle 的部署不提供 `tts` namespace；readiness 流永远不会报告 provider，页面不注册任何痕迹。卡片只在流存活且无 provider 时显示已连接但为空的状态。

## Alternatives considered

**并入 `ui-settings-general`。** 拒绝：settings 家族已确立一个 host-plane namespace 一个配套包的模式，且 general 区块是纯浏览器侧静态行，不是 Host 条件页面。

**选择走 settings namespace 与 `configForms`。** 拒绝：选择已经通过 `text-to-speech` 服务自己的 settings 条目持久化，第二个存储会分叉朗读操作读取的真相来源。

**在消息操作行放音色菜单。** 拒绝作为整体面：选音色是一次性偏好，不是逐消息操作，操作行保持一键深度。

## Consequences

- 挂了 read-aloud bundle 的部署获得一张 Host 条件化的「语音」卡片——provider 音色列表、持久化的选择、语速与试听——修改经服务的 settings 条目在客户端重载与 Host 重启后保留；未挂 bundle 的部署不新增入口，也不产生朗读操作已拥有的 readiness 镜像之外的流流量。
- 全部文案经包字典本地化，覆盖英文与简体中文。
- 页面的部署契约横跨三层组合：`ui-chat` 暴露 `readAloud` 服务、experimental client 半挂载 `tts` namespace、bundle 注册进 profile 的 `dsh.profile.bundles` 列表。

## 实现记录

按提案落地，另有六个组合层决策是提案时无法预见的：

- **页面经 cordis 服务消费 Chat 能力，而非值导出。** client bundle purity 门禁止跨插件运行时值导入，改由 `ui-chat` 提供 `readAloud` 服务（readiness 快照存储加 `speak`），并将 `@deepseek-ai/dsh-api-gateway/client` 加入 web 平台模块表——其流共享的 carrier 错误类需要唯一运行时身份。
- **`tts` Remote 由 experimental 包的 client 半挂载。** 默认 `api-remotes` client 装配不得内联 experimental 产物（bundle input isolation），故 `@deepseek-ai/dsh-experimental-api-text-to-speech` 新增 `./client` 入口挂载自己生成的贡献；read-aloud bundle patch 本就插入该插件，命名空间因此恰与 Host 合成器同时出现。`ui-chat` 经 `ctx.inject(['remote.tts'])` 接入 readiness 镜像与合成绑定，未挂 bundle 的组合保留浏览器引擎回退。
- **写入失败显式呈现。** 生成的 Remote 存根解析 `RemoteResult` 而非抛错，`configure` 拆包 `ok` 并内联展示失败。Host config 编辑器在 CLI patch 覆盖条目 config 期间拒绝 profile 写入——以 bundle 的 `cordis.patch.yml`（含 `config`）启动的部署会拒绝一切保存，页面原样展示该错误。
- **bundle 经 profile 的 bundle 列表部署。** config 编辑器从 profile 目录与 CLI overlay 重算组合；insert 仅来自 CLI patch 的条目在 home patch 中没有可定位的基础条目，因此无论 config 为何一切保存都被拒绝。把 `@deepseek-ai/dsh-experimental-read-aloud-bundle` 注册进 profile 的 `dsh.profile.bundles` 使插入进入重算层，且 `defaultProvider` 改为可选（组合恰注册一个 Provider 时解析它），bundle patch 不再携带条目 config，语音页由此拥有持久化。
- **声音克隆作为第二个 Provider 落地，不改页面。** `@deepseek-ai/dsh-experimental-text-to-speech-openvoice` 是面向外部托管 OpenVoice v2 服务（MeloTTS-Chinese 加音色转换器）的无状态 HTTP 客户端：`/health` 发布克隆音色清单，`/synthesize` 返回完整 WAV，省略 `TtsPreparation` 让页面直接报告就绪。注册两个 Provider 后，bundle 的 `text-to-speech` insert 必须重新携带 `defaultProvider`。组合 config 语义在此处关键：较晚的非 insert patch 会整行替换条目的 `config`（`applyEntryPatches`），此前设置保存写入的 home patch 行会静默丢弃 bundle 新增的键，直到重写为完整 config——设置保存始终持久化合并后的 config 而非仅变更字段，因此自身安全。
- **提供方选择器走同一条 `configure` 调用，名单变化会重新公布。** 切换提供方时为新目标解析一个其收录的音色（当前音色被收录时保留它），Host 因此不会拒绝上一个提供方遗留的组合；页面在 follow 流确认前先回显已接受的写入。Provider 的 `voices` 名单可能在没有任何注册事件的情况下变化，故 `textToSpeech.catalogChanged()` 把 Provider 事实重新公布给就绪跟随者；OpenVoice Provider 在每次成功探测后公布，放进服务的参考录音在下一次合成后即可选中，而不再需要页面重载。

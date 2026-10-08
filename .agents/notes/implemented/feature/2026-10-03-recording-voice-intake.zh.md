# Agent Note：录音音色接收

Status: implemented

[English](2026-10-03-recording-voice-intake.md) | 中文

## 问题

语音设置页只能选择参考 WAV 文件已存在于 OpenVoice 服务 `references/` 目录中的克隆音色。复刻声音意味着在带外把录音放进该目录，再等待下一次合成或名册探测；页面本身没有任何入口——对从不接触服务主机的 Web 与 Desktop 用户是死路。对齐要求在设置页内从所选录音复刻音色。

## 决策

录音接收以横跨 seam、Provider、Remote API 与 Client 的一条纵向能力交付：

- **Seam（服务定义）。** `TtsProvider.intake` 公布接收的媒体类型与字节预算；`ctx.textToSpeech.intakeVoice(id, intake, signal)` 把一段提交的录音交给确切的注册执行，并沿用与 `synthesize()` 相同的注册纪律：调用方与注册的合并 signal 可中止等待中与进行中的接收，被撤销的注册在结算前等待已提交的接收，没有 `intake` 的 Provider 显式拒绝。
- **Provider。** OpenVoice 的 `intakeVoice()` 经服务的 `PUT /references?name=` 以给定音色 id 存入录音，随后重新探测名册，因此存入的录音立即可选，无需等待下一次合成。
- **Remote API。** `intakeVoice(providerId, voiceId, audioBase64)` 接收一个 base64 载荷；编码长度先按 `maxReferenceBytes` 预检并以 `tts/invalid-recording` 拒绝，非规范 base64、解码后超限与 Provider 拒绝报告为 `tts/intake-failed`。
- **Client（客户端）。** 所选 Provider 公布接收时，「语音」卡片出现**上传录音**按钮；所选文件名成为音色 id（保留 CJK），接收成功后立即选中新音色。

录音保持瞬态：既不进入会话日志也不进入附件存储，因此不产生模型可见 ⟺ 已记录义务。音色 id 的派生与校验在客户端与服务端各自独立存在，作为两道独立防线。

## 考虑过的备选方案

**客户端直接向 OpenVoice 服务发 HTTP。** Provider 才拥有服务协议；客户端请求会把该知识分叉到 seam 之外，跳过注册纪律与取消传播，并绕过 Remote namespace 的认证。

**保留 `references/` 目录投放作为唯一路径。** 目录工作流对运维者仍然可用，但它无法从页面触达，且静默依赖对服务主机的文件系统访问；它作为带外限制保留在文档中，而不是主流程。

**把录音存为附件或会话事件。** 录音与请求的音频一样是瞬态的合成输入；给它持久的会话生命周期会为不该成为模型输入的数据扩展 `SessionEventMap` 与附件存储。

## 结果

- 四个包 README 与语音输入子系统页描述接收；`docs/config-catalog.md` 携带两个 `maxReferenceBytes` 字段。
- 接收成功取决于部署的服务实现了 `PUT /references`；对没有该端点的服务，接收以传输错误失败，而合成与名册探测继续工作。
- 上传的录音以 WAV 文件形式存在服务的 `references/` 目录中，因此重启服务后仍然存在，并可在页面之外由运维管理。

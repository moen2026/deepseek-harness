# Agent Note：可选启用的语音转写接缝

Status: implemented

[English](2026-09-27-opt-in-audio-transcription.md) | 中文

## 问题

智能体会以工作区文件的形式收到会议记录、语音备忘与访谈录音，但 harness 此前没有把音频转成文本的第一方途径：唯一的语音能力是实验性的 `voice-input` 识别器——它服务于聊天框的实时听写，不是模型工具。需要 `.m4a` 文件内容的模型只能报告它无法收听。拥有转写端点的部署也没有办法把该能力交给模型，而路线图中语音输入工作（D10）需要一个可依托的转写接缝。

## 决策

语音转写以标准三层家族交付：[dsh-audio](../../../../packages/audio/audio) 接缝（`ctx.audio`：单提供者保留加一条 `transcribe` 路由）、[dsh-audio-http](../../../../packages/audio/audio-http) 提供者（OpenAI 兼容的 `/audio/transcriptions` 客户端，multipart 上传原始字节并把 JSON 应答映射到接缝的转写文本）、[dsh-tool-audio](../../../../packages/audio/tool-audio) 消费者（`transcribe_audio` 工具：经 `ctx.fs` 解析工作区文件，在默认 25 MiB 字节预算内读取，并返回受 `maxResultChars` 约束的转写文本）。`full` preset 挂载一个隔离的 `audio` 组——接缝与工具总是加载，提供者在部署通过 `DSH_AUDIO_URL` 指定端点前保持禁用；无提供者时工具返回可操作的不可用应答，而不是破坏会话。

中立立场与 memory 的嵌入路径一致：端点 URL、模型名与 bearer 令牌*变量名*是部署配置（`DSH_AUDIO_URL`、`DSH_AUDIO_MODEL`、`DSH_AUDIO_AUTH_ENV`）；凭据在调用时从环境读取，从不写入 YAML、日志或请求体。DSH 从不选择转写模型。每个端点侧失败都是类型化的 `AudioError` `AUDIO_PROVIDER_FAILED`；任何路径都不会伪造转写文本。

这是路线图语音工作的基础设施接缝：D10 的 `voice` 组将以 `ctx.audio.transcribe` 做 STT，而不是再长出自己的 HTTP 客户端。

## 已考虑的替代方案

**以 voice-input 识别器作为转写路径。** `voice-input` 包服务于带修订保护草稿插入的交互式听写——与"模型请求既有文件的文本"是不同契约。把两者塞进一个表面会把聊天框 UX 与工具模式耦合。

**TTS 放进同一接缝。** 语音合成是不同的能力，配置也不同（音色、格式）；把它折进 `transcribe` 会为没有当前消费者的需求扩展接缝词汇表。接缝只有一条路由，并在其限制中声明了边界。

**经 `ctx.llm` 多模态输入读取音频。** 主 provider 路径是纯文本的；让转写以多模态路由为条件会把基础设施能力绑到模型选择上。部署自有的 HTTP 端点使该能力独立于智能体的模型。

## 后果

- 不设置新环境变量的部署看不到任何行为变化：`transcribe_audio` 挂载并以模型可报告、可据此建议的形式应答"不可用"。
- 工具对缺失目标发出 `fs/observed` 事件，并对读取（字节）与应答（字符）双向限界，大录音无法淹没会话。
- `docs/subsystems/audio.md` 新增生成的 Cordis API 段；`transcribe_audio` 已编入 `docs/tool-catalog.md`，其系统提示段位于第一方顺序 2455。

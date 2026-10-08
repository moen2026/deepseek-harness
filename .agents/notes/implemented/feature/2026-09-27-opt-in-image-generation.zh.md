# Agent Note：可选启用的图像生成接缝

Status: implemented

[English](2026-09-27-opt-in-image-generation.md) | 中文

## 问题

模型经常受益于在交付物中产出一张插图、示意草图或预览图，但 harness 此前没有第一方的图像生成能力：唯一的图像路径是 `read_image`——它让模型*查看*工作区图像，却从未能*创建*图像。拥有图像生成端点（OpenAI 兼容 `/images/generations`）的部署没有办法把该能力交给模型，而 QoderWork 对齐（路线图 A3）要求模型能按请求生成图像。

## 决策

图像生成以标准三层家族交付：[dsh-image](../../../../packages/image/image) 接缝（`ctx.image`：单提供者保留加一条 `generate` 路由，接收文本提示与可选尺寸提示）、[dsh-image-http](../../../../packages/image/image-http) 提供者（OpenAI 兼容的 `/images/generations` 客户端，请求 `b64_json` 应答并解码为原始字节）、[dsh-tool-image](../../../../packages/image/tool-image) 消费者（`generate_image` 工具：生成，然后经 `attachments.saveImage` 持久化字节，并返回文本信封与图像内容块双块，使图片像 `read_image` 输出一样内联渲染）。`full` preset 挂载一个隔离的 `image` 组——接缝与工具总是加载，提供者在部署通过 `DSH_IMAGE_URL` 指定端点前保持禁用；无提供者时工具返回可操作的不可用应答，而不是破坏会话。

在 audio 模板之外的两处精化：

- **先检查后花费。** 工具在调用生成端点*之前*检查 attachment 存储是否已挂载，因此拒绝路径不会把部署的生成预算花在无法持久提交的字节上。
- **可存储媒体类型校验。** attachment 接缝只接受 PNG/JPEG/WebP/GIF；生成端点返回其他类型时会产生一条指明约束的可操作错误，而不是写入中途崩溃。

中立立场与 audio 及 memory 的嵌入路径一致：端点 URL、模型名与 bearer 令牌*变量名*是部署配置（`DSH_IMAGE_URL`、`DSH_IMAGE_MODEL`、`DSH_IMAGE_AUTH_ENV`）；凭据在调用时从环境读取，从不写入 YAML、日志或请求体。DSH 从不选择生成模型。每个端点侧失败都是类型化的 `ImageError` `IMAGE_PROVIDER_FAILED`；任何路径都不会伪造图像。

## 已考虑的替代方案

**返回文件路径而不是内联图像内容。** 只有路径的应答迫使用户手动打开文件，并丢失"刚生成了什么"的上下文。复用 `read_image` 的持久化并附挂模式使生成图像与既有图像在会话中视觉上完全一致。

**提供者侧 multipart/form-data 上传。** OpenAI 兼容生成端点只接收 JSON；增加表单支持是为没有当前消费者的需求预留的猜测表面。

**复用 `ctx.llm` 多模态输出。** 主 provider 路径返回文本与音频，而非图像字节；图像生成是部署自有的独立能力，把它绑到模型选择上会让纯文本路由上的工具不可用。

## 后果

- 不设置新环境变量的部署看不到任何行为变化：`generate_image` 挂载并以模型可报告、可据此建议的形式应答"不可用"。
- 生成图像成为普通附件：它们出现在 attachment 存储中，可被再次读取，并与 `read_image` 输出参与同样的大小/预算核算。
- `docs/subsystems/image.md` 新增生成的 Cordis API 段；`generate_image` 已编入 `docs/tool-catalog.md`，其系统提示段位于第一方顺序 2456。

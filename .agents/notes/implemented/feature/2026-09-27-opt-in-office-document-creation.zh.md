# Agent Note: 选择性启用的 Office 文档创建

Status: implemented

[English](2026-09-27-opt-in-office-document-creation.md) | 中文

## 问题

模型经常被要求交付格式化文档——报告、电子表格、幻灯片——但 harness 此前只能*转换* Office 文件，无法*创建*它们：`office-to-pdf` 能把已有的 LibreOffice 可读文件转成 PDF，却没有从模型结构化内容到 DOCX/XLSX/PPTX 交付物的第一方路径。QoderWork 对齐（路线图 A2）要求模型按需撰写 Office 文档，且生成的文件必须与其他持久化输出一样走同一条交付物呈现链。

## 决策

文档创建以标准三层家族的形式落在现有 `packages/document` 组之上：[dsh-documents](../../../../packages/document/documents) 接缝（`ctx.documents`：单提供方保留加一条顺序无关的 `create` 路由，接受中立内容块——heading、text、bullets、table、chart placeholder——并返回成品文档字节）、[dsh-office-create](../../../../packages/document/office-create) 提供方，以及 [dsh-tool-document](../../../../packages/document/tool-document) 消费方（`create_document` 工具：创建后以 `fs.writeBytes` 把字节写入 Session 工作区（永不覆盖策略），再通过共享的 `deliverables/presented` 链声明文件，使其像其他交付物一样呈现）。

提供方复用仓库中已有的 LibreOffice 引擎，而不是引入第二个 Office 写入器：

- **OpenDocument 中间格式。** 提供方把中立块渲染成最小 ODT/ODS/ODP zip（fflate，`mimetype` 首条目不压缩存储），再经现有 libreoffice-kit `convert` 路径转成请求的 OOXML 格式。一个写入器服务三种输出格式，中间格式是提供方的私有关注点。
- **预算与清理纪律。** 每次调用的暂存目录即使失败也会清理；引擎调用受 `timeoutMs` 约束，输出大小受 `maxOutputBytes` 约束（两者皆为配置，无硬编码 tunable）。
- **类型化失败。** 每个引擎侧失败都是类型化的 `DocumentError` `DOCUMENT_PROVIDER_FAILED`；没有已注册提供方时工具返回模型可报告、可建议的"不可用"应答，绝不炸掉会话。

`full` preset 挂载一个隔离的 `documents` 组：接缝与工具始终加载，提供方随 documents 组加载；工具 schema 不依赖任何提供方，因此其模型可见面在部署之间保持稳定。

## 已考虑的替代方案

**由提供方直接产出 OOXML。** 手写 DOCX/XLSX/PPTX 会把面扩大三倍（三套标记词汇表），而仓库已经信任 LibreOffice 读取这些格式（`office-to-pdf`）；创建也走同一引擎可以只保留一个 Office 依赖。

**为文档生成单开一个接缝。** 路线图条目描述的是一个能力；单独的 `document-create` 接缝会为单个操作复制保留/路由模式。`documents` 接缝遵循 image/audio 模板：一个接缝、一个提供方槽位、一条路由。

**只返回路径而不走 present。** deliverables 链已经以审查 affordance 渲染持久化文件；绕过它会让创建的文档沦为二等输出。

## 后果

- 加载该组的部署获得 `create_document`；没有提供方时它回答"不可用"，会话继续。
- 创建的文档像手写文件一样出现在工作区和 deliverables 链中；`deliverables/presented` 事件类型仍由 present 工具的包持有（唯一声明），本消费方复用该声明。
- `docs/subsystems/documents.md` 获得生成的 Cordis API 段；`create_document` 已收录于 `docs/tool-catalog.md`，其 system-prompt 段为第一方顺序 2457。

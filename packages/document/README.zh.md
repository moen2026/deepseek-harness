---
description: "Host Office 转换、可复用 PDF 结果与 Office 文档生成的包索引。"
kind: "package-group"
---

# document/ — Office 转换与生成

[English](README.md) | 中文

## 摘要

在宿主上将已授权的 Office 文件转换为可复用的 PDF，并从模型提供的内容块生成新的 Office 文档。共享转换服务与生成提供方都使用 LibreOffice kit 运行。声明了原生引擎的目标使用原生引擎，其余目标使用 Node WASM。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

每个包负责自身配置和生命周期规则；子系统参考描述共享转换操作与生成 seam。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [office-to-pdf](office-to-pdf/README.zh.md) | 将已授权 Office 字节转换为完整 PDF，并提供有界队列和缓存 | `ctx.officeToPdf` |
| [documents](documents/README.zh.md) | 文档生成 seam：覆盖中立内容块的单一 `create` 路由 | `ctx.documents` |
| [office-create](office-create/README.zh.md) | LibreOffice kit 生成提供方，把内容块渲染成 DOCX/XLSX/PPTX | — |
| [tool-document](tool-document/README.zh.md) | 面向模型的 `create_document` 工具，把交付物写入工作区 | — |

-----

<a id="related-documentation"></a>
## 相关文档

消费者负责源文件授权与展示。

- [文档转换](../../docs/subsystems/office-to-pdf.zh.md) — 共享操作和生成的服务参考。
- [文档生成](../../docs/subsystems/documents.zh.md) — 生成 seam 与生成的服务参考。
- [独立 kit 所有权](../../.agents/notes/implemented/architecture/2026-09-14-independent-libreoffice-kit.zh.md) — 引擎分发与应用集成。
- [工作区文件](../api/workspace-files/README.zh.md) — 已授权的有界源文件读取。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

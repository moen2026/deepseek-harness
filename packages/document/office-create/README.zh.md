---
description: "DeepSeek Harness documents seam（ctx.documents）的 LibreOffice kit 驱动文档生成提供方：把中立内容块渲染成最小 OpenDocument 中间格式，再经本地引擎转换为 DOCX、XLSX 或 PPTX，携带类型化提供方失败错误与按调用的临时目录清理。"
kind: "package-reference"
---

# @deepseek-ai/dsh-office-create

[English](README.md) | 中文

## 概述

挂载 `dsh-office-create`，用本地生成引擎支撑 `ctx.documents`：每个请求先渲染成对应家族（odt、ods 或 odp）的最小有效 zipped OpenDocument 中间格式，再由 LibreOffice kit 转换为请求的 Office 格式。一个转换器懒创建并共享，临时目录绝不活过一次调用，所有引擎侧失败都以类型化 `DOCUMENTS_PROVIDER_FAILED` 错误呈现——没有伪造的兜底文档。注册是 effect 作用域的；释放会中止进行中的工作并释放共享转换器。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 何时选择它

当部署希望 Office 文档生成又不运营远程生成端点时选择本提供方。引擎随应用分发且懒启动，挂载但未使用的提供方不支付启动成本；代价是本地 LibreOffice 依赖与原生引擎吞吐。

### 配置

```yaml
- name: '@deepseek-ai/dsh-office-create'
  config:
    timeoutMs: 60000
    maxOutputBytes: 104857600
```

| Key | Default | Meaning |
|---|---|---|
| `timeoutMs` | `120000` | 排队转换开始后的转换截止时间（毫秒） |
| `maxOutputBytes` | `104857600` | 创建器从引擎接受的最大完整文档字节 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-office-create)是所有接受字段的穷尽来源。

### 失败与恢复

无效请求（空白标题、空文本、非矩形表格、空白列表项或标签）在任何引擎工作之前抛出 `DOCUMENTS_INVALID_REQUEST`，坏请求永远不会启动转换。引擎启动失败在下次调用时重试——坏掉的转换器不会毒化创建器。转换失败或输出超限抛出 `DocumentsError` `DOCUMENTS_PROVIDER_FAILED`，消息说明失败原因，且临时目录在任何路径下都被移除。调用方取消不包装地向上抛出，已信号化的取消在引擎运行前中止。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

### 设计理念

- **Service Provider 角色。** 本包在 `ctx.documents` 上注册一个 `DocumentsProvider`（`id: office-create`），此外不持有任何东西：没有工具、没有 prompt、没有存储。
- **中立块进，Office 字节出。** 请求被翻译成最小 zipped ODF 包（mimetype 条目居首且 stored、manifest、content.xml）——LibreOffice 双向都能转换的格式——seam 词汇表从不泄漏引擎细节。
- **确定性中间格式。** 相同请求产出相同中间字节，提供方测试可以快照 XML。
- **单一懒转换器。** `createConverter` 首次使用时运行，其 promise 被共享；失败的工厂重置槽位，下次调用干净重试。
- **类型化失败。** 引擎侧失败变成 `DOCUMENTS_PROVIDER_FAILED`，消息携带引擎诊断；校验失败保持 `DOCUMENTS_INVALID_REQUEST`。

### 源码地图

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema 与提供方注册 |
| [`src/odf.ts`](src/odf.ts) | OpenDocument 中间格式构建器：校验、block 渲染、打包 |
| [`src/create.ts`](src/create.ts) | kit 驱动创建器：临时目录 I/O、转换、输出上限、错误映射 |
| — | 不发布运行时不变式伴生入口；单一懒转换器与临时目录是私有实现状态，且该提供方不发布独立的生命周期事件流或可枚举快照。 |

</details>

-----

<a id="further-exploration"></a>
## 深入探索

- [dsh-documents](../documents/README.zh.md) — 本提供方注册所 against 的 seam。
- [dsh-tool-document](../tool-document/README.zh.md) — 消费生成文档的面向模型工具。
- [dsh-office-to-pdf](../office-to-pdf/README.zh.md) — 共享同一 LibreOffice kit 的兄弟转换方向。
- [document group map](../README.zh.md) — 包家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

无，作为提供方它应答生成请求而不向模型请求贡献任何内容；`dsh-tool-document` 持有面向模型的 schema 与渲染。

#### KV Cache effect

无效果；本提供方不向模型请求贡献任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义提供方当前的范围。它们是包约束，不是任务清单。

- **只有占位图表** — `chartPlaceholder` block 渲染为带标签的占位框，永远不会是真实图表数据；数据驱动图表是不同能力。
- **无模板文件** — 生成只从中立 block 出发；填充调用方提供的 DOCX/XLSX/PPTX 模板是推迟的工作。
- **本地引擎依赖** — 生成需要内置的 LibreOffice 引擎；引擎启动失败在调用上呈现为 `DOCUMENTS_PROVIDER_FAILED`，而不是降级到其他后端。
- **每次调用一个格式家族** — 每个请求只针对 DOCX、XLSX、PPTX 之一；多格式导出是多次调用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

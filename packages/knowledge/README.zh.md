---
description: "knowledge 组地图：经由 knowledge seam 的共享、持久 Agent 知识库，其带边界检索摘录的 SQLite FTS5 提供方，以及面向模型的 knowledge_ingest/knowledge_search/knowledge_remove/knowledge_list 工具，供浏览本组的用户与维护者使用。"
kind: "package-group"
---

# knowledge/ — 共享知识库

[English](README.md) | 中文

## Summary

knowledge 组让 Agent 能够摄取、检索与管理跨会话、跨用户共享的持久文档语料：ingest 存入一篇带标题的文档并返回其 id，规范化的 search 返回带提供方计算摘录的排序命中。使用 `knowledge-sqlite` 在 `node:sqlite` 上构建零依赖 FTS5/BM25 存储，使用 `tool-knowledge` 把它暴露为模型可用的 `knowledge_ingest`/`knowledge_search`/`knowledge_remove`/`knowledge_list`。共享的 `knowledge` 包保持词汇与提供方无关。本组不发布默认嵌入后端，也不选择模型；对于简短的每用户 Agent 记忆，参见 memory 组。

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`knowledge/`](knowledge/README.zh.md) | 定义知识服务：独占的单提供方预留与四条顺序无关路由（ingest、search、remove、list） | `ctx.knowledge` |
| [`knowledge-sqlite/`](knowledge-sqlite/README.zh.md) | 构建零依赖 FTS5/BM25 存储，应答带边界摘录的排序检索 | 注册到 `ctx.knowledge` |
| [`tool-knowledge/`](tool-knowledge/README.zh.md) | 经由 `knowledge_ingest`/`knowledge_search`/`knowledge_remove`/`knowledge_list` 把知识库暴露给模型 | 注册到 `ctx.tools` |

提供方存储文档并排序检索，而不是工具：`tool-knowledge` 拥有面向模型的工具名称、schema、提示指导与呈现，因此更换提供方不会改变模型获取知识的方式。

-----

<a id="related-documentation"></a>
## Related documentation

- [生成式工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-knowledge) —— 模型收到的四个工具 schema。
- [知识库子系统](../../docs/subsystems/knowledge.zh.md) —— 该 seam 的注册面与词汇。

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>维护者的工作上下文 —— 点击展开</summary>

None.

</details>

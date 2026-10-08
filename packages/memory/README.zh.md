---
description: "memory 组地图：通过 memory seam、其带可选融合向量路径的 SQLite FTS5 提供方、面向模型的 memory_write/memory_search/memory_forget 工具、从完成轮次收获持久候选的轮次结束反思与注入模型上下文的协作风格画像实现的持久长期 agent 记忆，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# memory/：持久长期 agent 记忆

[English](README.md) | 中文

## 概述

memory 组让 agent（智能体）跨轮次持久、召回并遗忘持久事实：一次写入返回 id，一次规范化召回返回排序后的命中。使用 `memory-sqlite` 在 `node:sqlite` 上构建派生、仅属主的 FTS5 存储，默认词法并带可选的融合向量路径，使用 `tool-memory` 以 `memory_write`／`memory_search`／`memory_forget` 向模型暴露它。`memory-reflection` 从完成的轮次收获持久候选，`memory-profile` 把已保存的 `style` 记忆注入模型上下文。共享的 `memory` 包使词汇保持提供方中立。本组不随附任何默认嵌入后端，也不选定模型。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`memory/`](memory/README.zh.md) | 定义记忆服务：独占的单提供方预留与四条顺序无关的路由（remember、recall、forget、list） | `ctx.memory` |
| [`memory-sqlite/`](memory-sqlite/README.zh.md) | 构建派生、仅属主的 FTS5 存储并应答排序召回，附带可选的融合向量路径 | 注册到 `ctx.memory` |
| [`tool-memory/`](tool-memory/README.zh.md) | 通过 `memory_write`／`memory_search`／`memory_forget` 向模型暴露持久记忆 | 注册到 `ctx.tools` |
| [`memory-reflection/`](memory-reflection/README.zh.md) | 以一次辅助模型调用反思每个完成的根轮次，并将获准候选经 seam 写回 | `ctx.llm`、`ctx.memory` |
| [`memory-profile/`](memory-profile/README.zh.md) | 将已保存的 `style` 记忆作为运行时上下文区段注入模型上下文 | `ctx.systemPrompt`、`ctx.memory` |

提供方存储记录并为召回排名而非注册工具：`tool-memory` 拥有面向模型的工具名称、schema、提示词指引与呈现，因此更换提供方绝不会改变模型请求记忆的方式。`memory-reflection` 与 `memory-profile` 位于同一 seam 之上，因此它们同样保持提供方中立。

-----

<a id="related-documentation"></a>
## 相关文档

- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-memory)——模型接收的 `memory_write`／`memory_search`／`memory_forget` schema。
- [memory 子系统](../../docs/subsystems/memory.zh.md)——接缝的注册面与词汇表。
- [MCP 记忆指南](../../docs/user/guide/mcp-memory.zh.md)——这一 opt-in 内置能力所补充的外部 MCP 记忆路径。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

---
description: "code-index 组地图：通过 code-index seam、其 SQLite FTS5 提供方、带部署自备嵌入的可选混合提供方与面向模型的 search_codebase 工具实现的工作区代码搜索，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# code-index/：工作区代码搜索

[English](README.md) | 中文

## 概述

code-index 组让 agent（智能体）对工作区已索引源码运行全文搜索：一次规范化查询返回按 BM25 排序的行范围与片段。使用 `code-index-sqlite` 在 `node:sqlite` 上基于工作区根构建派生、离线的 FTS5 索引，使用 `tool-code-index` 以 `search_codebase` 向模型暴露它。当部署自备 OpenAI 兼容嵌入端点时改用 `code-index-hybrid`：它增加块感知分块并为每块存储一个向量，以倒数排名融合 BM25 与端点嵌入排序。共享的 `code-index` 包使请求与结果的词汇保持提供方中立，因此更换提供方不会改变模型请求。索引是受保护、仅属主文件中的派生数据，删除并重建始终安全；离线提供方不随附任何嵌入后端也不访问网络，混合提供方只访问部署所配置的端点。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`code-index/`](code-index/README.zh.md) | 定义代码搜索服务：独占的单提供方预留与一条顺序无关的词法搜索路由 | `ctx.codeIndex` |
| [`code-index-sqlite/`](code-index-sqlite/README.zh.md) | 基于工作区根构建派生、仅属主的 FTS5 索引，并应答排序、片段渲染的查询 | 注册到 `ctx.codeIndex` |
| [`code-index-hybrid/`](code-index-hybrid/README.zh.md) | 可选提供方，增加块感知分块并以倒数排名融合部署自备端点向量与 BM25 | 注册到 `ctx.codeIndex` |
| [`tool-code-index/`](tool-code-index/README.zh.md) | 通过 `search_codebase` 工具向模型暴露排序后的代码搜索 | 注册到 `ctx.tools` |

提供方注册的是语料与排序器而非工具：`tool-code-index` 是面向模型的名称、schema、提示词指引与呈现的唯一 owner，因此更换提供方绝不会改变模型请求代码搜索的方式。

-----

<a id="related-documentation"></a>
## 相关文档

- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-code-index)——模型接收的 `search_codebase` schema。
- [code-index 子系统](../../docs/subsystems/code-index.zh.md)——接缝的注册面与词汇表。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

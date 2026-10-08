---
description: "DeepSeek Harness 知识 seam（ctx.knowledge）的 SQLite 知识库提供方：基于 node:sqlite 的零依赖 FTS5/BM25 词法存储，返回带边界摘录的排序检索结果，供配置或替换本地知识存储的用户与维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-sqlite

[English](README.md) | 中文

## Summary

将 `dsh-knowledge-sqlite` 用作 `ctx.knowledge` 的本地知识库提供方：一个插件实例拥有 `node:sqlite` 上的专属派生存储，`ingest` 写入规范化的文档记录及覆盖标题与正文的 FTS5 行，`search` 以 BM25 排序并返回首个命中周围的边界摘录，`remove`/`list` 按时间删除与枚举。存储零依赖且完全本地；与 seam 的注册是 effect 作用域的，因此释放时会注销提供方并关闭数据库。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

在提供 `ctx.knowledge` 的上下文上挂载本插件，再挂载 `dsh-tool-knowledge` 把语料暴露给模型。用 `path` 配置存储路径；其余全部使用默认值。

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `path` | required | 专属派生存储路径；支持 `:memory:`。缺失的路径以 owner-only 权限创建。 |
| `openAt` | `startup` | 在启动时打开数据库，或在首个操作时惰性打开。 |
| `journalMode` | `wal` | SQLite journal 模式：`wal`、`delete`、`truncate` 或 `persist`。 |
| `defaultLimit` | `10` | 请求省略 `limit` 时的结果页大小。 |
| `maxLimit` | `100` | 可接受的最大页大小与列表池。 |
| `maxTextBytes` | `65536` | 单篇文档正文的 UTF-8 字节上限。 |
| `maxTitleBytes` | `512` | 单篇文档标题的 UTF-8 字节上限。 |

```yaml
- name: '@deepseek-ai/dsh-knowledge-sqlite'
  config:
    path: .dsh/knowledge.sqlite
```

### Failures and recovery

空白标题或正文、含 NUL 或超限的字段、超出范围的 limit 都以 `KNOWLEDGE_INVALID_REQUEST` 失败，且该 seam 原样转发给调用方。对已释放提供方的操作以 `KNOWLEDGE_DISPOSED` 失败。数据库打开守卫拒绝重置属于其他应用或带有未识别表的文件；不兼容的 schema 版本就地重置派生存储。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>实现内部 —— 点击展开</summary>

本节解释提供方背后的设计决策及代码实现位置；可观察行为见 [Use this package](#use-this-package)。

### Design philosophy

- **Service Provider 角色。** 提供方拥有存储身份、时间戳、排序与摘录构造；它从不触碰工具或提示，因此更换它不会改变模型可见表面。
- **派生存储，受守卫的打开。** `openKnowledgeDatabase` 写入 `PRAGMA application_id`（`0x4453484b`）与 `user_version`，拒绝外来数据库，并就地重置不兼容的派生 schema 而不是猜测。
- **惰性 FTS5 数据。** 调用方文本经 NUL 净化后存储，每条查询被引为一个 FTS5 短语，因此用户输入中不成对的引号无法破坏匹配表达式。
- **单连接。** 所有工作经由单一打开的连接串行执行，因此 ingest、search 与 close 永不交错。
- **JavaScript 中的标签过滤。** search 先词法预过滤为有界候选池，再对已加载记录在 JavaScript 中应用标签过滤，因此标签不进入 FTS 索引。

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`SqliteKnowledgeProvider`、`apply`、配置 schema |
| [`src/schema.ts`](src/schema.ts) | 受守卫的打开、派生存储 schema（`knowledge_records` + FTS5 `knowledge_docs`） |
| [`src/query.ts`](src/query.ts) | draft 与 search 规范化、字节上限、FTS5 引用与净化 |
| — | 未发布运行时 invariant 伴随物；该存储是普通文档的派生缓存，任何 SQLite 浏览器都可读取，可用性由 seam 路由自身承载。 |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-knowledge](../knowledge/README.zh.md) —— 本提供方注册所对应的 seam。
- [dsh-tool-knowledge](../tool-knowledge/README.zh.md) —— seam 之上的面向模型工具。
- [knowledge 组地图](../README.zh.md) —— 三包家族及其相关文档。

-----

<a id="model-experience"></a>
## Model Experience

间接体验，经由 `dsh-tool-knowledge`：本包不贡献任何提示段、工具 schema 或渲染文本。检索质量与摘录用词取决于本提供方，但模型可见的 schema 跨提供方保持稳定。

#### KV Cache effect

无；本包不向任何请求贡献内容。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


这些限制定义该提供方当前的范围。它们是包约束，不是任务清单。

- **仅词法** —— search 是 FTS5 上的 BM25，没有向量路径；语义检索应是一个新的提供方，因为该 seam 把任何嵌入管线保留为提供方私有事务。
- **整篇文档，不分块** —— 正文在字节上限内作为单一单元存储与检索；更大语料与段落级索引需要私有分块的提供方。
- **每存储单连接** —— 所有工作经由单一连接串行；高并发部署需要另一个提供方，而不是配置开关。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者的工作上下文 —— 点击展开</summary>

派生存储打开守卫与单连接脚手架有意与 `dsh-memory-sqlite` 平行；两处区域都带有说明该理由的 `jscpd:ignore` 标记，因为提取共享助手会把两个独立版本化的存储 schema 耦合到一个助手包上。

</details>

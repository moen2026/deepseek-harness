---
description: "ctx.codeIndex 的 SQLite FTS5 代码索引提供方：基于工作区根构建的派生、仅属主可读索引，分块写入按 BM25 排序的 FTS5 行并为每块保存本地哈希子词向量，以倒数排名融合与有界片段响应查询，供组合本地代码搜索的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-code-index-sqlite

[English](README.md) | 中文

## 概述

使用 `dsh-code-index-sqlite` 以本地、离线的代码索引支撑 `ctx.codeIndex`，该索引在 `node:sqlite` FTS5 上由工作区根构建。在首次搜索时（或在启动时急切执行），它遍历根目录，把每个有界的文本文件按固定行数切块，写入以相对路径为键的 FTS5 表，并把 BM25 与本地哈希子词语义排序以倒数排名融合，用片段渲染的命中响应一次规范化查询。索引是受保护、仅属主文件中的派生数据，因此删除并重建始终安全；一张指纹表以增量方式与文件系统调和变更文件。本包不安装任何内容、不访问网络，并经由 `dsh-tool-code-index` 被读取。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当部署希望在没有外部服务的情况下对其自身工作区进行模型可见的代码搜索时，挂载此提供方。它需要 `dsh-code-index` seam，并且为让模型访问还需 `dsh-tool-code-index`；它通过宿主文件系统直接从 `config.root` 读取源码。

### 最小配置

`path` 是专用的派生索引文件（支持 `:memory:`），`root` 是要遍历并索引的绝对工作区。提供方打开并调和索引一次——当 `openAt` 为 `startup` 时在启动时，否则在首次搜索时惰性执行。

```yaml
- name: '@deepseek-ai/dsh-code-index'
- name: '@deepseek-ai/dsh-code-index-sqlite'
  config:
    path: .dsh/code-index.sqlite
    root: .
    defaultLimit: 20
    excludeGlobs: ['**/*.min.js']
- name: '@deepseek-ai/dsh-tool-code-index'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `path` | 必填 | 派生索引文件；缺失的文件系统路径以仅属主（`0o600`）方式创建；支持 `:memory:` |
| `root` | 必填 | 要遍历并索引的绝对工作区根 |
| `openAt` | `startup` | 在启动时，或在首次搜索时打开并调和 |
| `journalMode` | `wal` | SQLite 日志模式（经过验证的封闭联合，绝不是调用方可控的 SQL） |
| `defaultLimit` | `20` | 请求省略 `limit` 时的结果数量 |
| `maxLimit` | `200` | 可接受的最大页大小 |
| `snippetChars` | `240` | 片段最大长度（以 Unicode 码点计） |
| `chunkLines` | `40` | 每个索引块行数 |
| `maxFileBytes` | `1000000` | 单文件大小上限；更大的文件被跳过 |
| `maxFiles` | `20000` | 每次索引构建的文件总数上限 |
| `skipDirs` | `[]` | 在内建集合（`node_modules`、`.git` 等）之外额外跳过的目录名 |
| `includeGlobs` | `[]` | 非空时限定哪些相对路径被索引的 `*`/`?` glob |
| `excludeGlobs` | `[]` | 将相对路径排除出索引的 `*`/`?` glob |
| `semantic` | `true` | 把 BM25 与本地哈希子词语义排序融合；`false` 退化为纯 BM25 |

每个数值边界在加载时都验证为正整数；二进制扩展名与含 NUL 的文件在遍历期间被跳过。

### 一次搜索做什么

在首次查询时，提供方打开受保护的数据库，遍历 `root`，为每个非空行块写入一行 FTS5，并记录每个文件的大小与 mtime 指纹。之后的调和仅对指纹改变的文件重新分块，并删除已消失的文件。`search()` 把查询规范化为单个惰性 FTS5 短语，可选地由 `glob` 添加一条路径 `LIKE` 过滤和一个精确的 `language` 谓词，用 `bm25()` 排序，再把该次序与逐块哈希子词向量相似度以倒数排名融合——因此一个间隔开转述也能召回它从未逐字拼出的复合标识符——并返回有界片段，因此用户输入中一个不成对的引号绝不能破坏匹配表达式。

### 可观察的成功与失败

成功的查询按相关性降序返回命中，携带 `path`、从 1 开始的 `startLine`/`endLine`、可选的 `language`、`score` 以及一个无标记的有界 `snippet`；空结果页是一次成功的无匹配响应。空或含 NUL 的查询、或超出范围的 `limit`，会以 `CODE_INDEX_INVALID_REQUEST` 失败。打开属于另一个应用、或含有无法识别表的文件时会大声失败而非重置它；版本不符会就地重置派生模式。释放之后，查询以 `CODE_INDEX_DISPOSED` 失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释提供方背后的设计决策并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **派生数据，绝不权威。** 索引是受保护文件中一个可重建的缓存；指纹表让语料与文件系统以增量方式调和，删除文件始终安全。
- **独占归属保护。** `PRAGMA application_id` 保护一个无关数据库免受就地重置；只有本提供方识别的（或全新的）文件才会被修改。
- **惰性的查询文本。** `normalizeQuery` 去除首尾空白并折叠空白，然后把调用方文本引为单个 FTS5 短语，因此查询语法保持为数据，且保留的高亮标记在写入与读取路径上都被净化。
- **序列化的单一连接。** 所有工作通过内部 promise 尾列经由一个打开的连接执行，因此首次搜索的调和与后续查询绝不会交错出半成品状态。
- **构造上离线的语义。** 语义排序是文本的纯函数——对词与标识符子词的特征哈希——因此没有模型、端点或网络参与，重建会产出完全相同的向量。
- **有界遍历。** 大小上限、文件总数上限、内建跳过目录集与二进制扩展表共同约束语料，因此一个无界工作区不会让索引失控。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、提供方注册、遍历、分块、调和、`search()` |
| [`src/schema.ts`](src/schema.ts) | 受保护的仅属主打开、application-id 与版本重置、FTS5 表创建 |
| [`src/query.ts`](src/query.ts) | 查询规范化、FTS5 转义、glob 转 `LIKE`、标记剥离、片段定界 |
| [`src/semantic.ts`](src/semantic.ts) | 本地哈希子词嵌入、int8 量化、余弦相似度、倒数排名融合 |
| — | 不发布运行时不变式伴生入口；打开的连接与调和尾列是私有实现状态，且该提供方不发布独立的生命周期事件流或可枚举快照。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从共享的搜索模型逐步进入 seam 与工具。

- [dsh-code-index](../code-index/README.zh.md)——该提供方注册到的 seam。
- [dsh-tool-code-index](../tool-code-index/README.zh.md)——基于该 seam 的面向模型工具。
- [code-index 组地图](../README.zh.md)——三个包的家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-code-index` 间接影响；该工具呈现本提供方排名后的命中，而后端自身不贡献提示词或 schema。

#### KV Cache 影响

不会直接失效；请求前缀变更由 `dsh-tool-code-index` 负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义提供方何时不适合或需要特别的运维照护。它们是当前包约束，不是任务积压。

- **子词形态的语义，而非模型语义**——融合的语义排序是确定性的哈希子词投影：它弥合间隔查询与复合标识符，但不做同义词或转述泛化，因此概念性查询仍需围绕已知 token 措辞。
- **整个语料单一提供方**——该提供方为一个 `root` 声明整个 seam；没有多根或部分语料路由，且一次只能有一个提供方持有 `ctx.codeIndex`。
- **宿主文件系统读取，无沙箱**——该提供方用 `node:fs` 直接读取 `config.root` 并信任所挂载的执行世界；它不添加任何限制，因此受限部署必须提供一个范围恰当的根或一个受沙箱保护的宿主。
- **调和粒度为单文件 mtime/size**——变更的文件会整块重新分块；内容定义分块与增量子文件差异被推迟。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

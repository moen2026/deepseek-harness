# Agent Note: 轮次结束反思与协作风格画像

Status: implemented

[English](2026-09-28-memory-personalization.md) | 中文

## Problem

内置长期记忆（[选择性启用的内置长期记忆](2026-09-27-opt-in-builtin-memory.zh.md)）能够存储与召回持久事实，但召回完全由调用方驱动：模型只有在主动运行 `memory_search` 时才会想起已保存的偏好，"记住我的风格"这样的指令本身不会对它产生任何效果。记忆除此之外没有类型、置信度与过期时间，因此偏好在召回时与项目事实、瞬时细节无从区分，也没有任何东西从存储已知的内容中派生出常驻的模型指引。

## Decision

记忆记录在整个家族中变得类型化且可过期。`MemoryDraft`、`MemoryRecord`、`MemoryRecallRequest` 与 `MemoryListRequest` 增加可选的封闭词汇 `namespace`（`preference`、`fact`、`style`）、0 到 1 的 `confidence`，以及 `ttlMs` 写入选项——由其提供方计算的 `expiresAt` 一旦过期就不再进入召回或列举结果；`recall` 与 `list` 在既有 `tags`／`scope` 过滤之外按 namespace 与 `minConfidence` 阈值过滤。SQLite 提供方迁移到 schema 版本 2，新增 `namespace`、`confidence` 与 `expires_at` 列，`dsh-tool-memory` 相应扩展 `memory_write`／`memory_search` 参数与其提示词指引。

两个新 Consumer 位于同一 seam 之上。[dsh-memory-reflection](../../../../packages/memory/memory-reflection) 对每个完成的根会话轮次进行反思：一次辅助模型调用读取该轮次的人与助手文本，容错的 JSON 解析器至多接受十个候选，校验后的候选打上 `reflection` 标签经 `ctx.memory` 写回。写入路径默认 `write: 'ask'`，通过 user-questions 服务把候选呈给人类；`write: 'auto'` 直接写入。确切请求在派发前记录为 `memory/reflection-llm-request`，每个结果记录为 `memory/reflection`，因此每次反思都可由会话日志重建；提供方缺位、路由缺位或任何模型或写入失败都只会停止或告警，绝不使轮次失败。

[dsh-memory-profile](../../../../packages/memory/memory-profile) 把已保存的 `style` 记录转化为常驻指引：它在加载时与每次轮次结束后列举至多 `maxItems` 条最新记录，并把它们作为运行时上下文区段贡献出去（`memory:profile`，first-party 顺序 125），模型无需工具调用即可应用持久的协作偏好。提供方缺位或读取失败时不贡献任何内容并保留上一次成功的文本；每个注入的快照都在能影响请求之前记录进会话日志。

## Alternatives considered

**在每一步或每次模型调用之后抽取。** 每步抽取会成倍增加辅助成本，且会收获部分交换；轮次边界是人与助手文本构成完整意图单元的最小单位。

**默认不经询问直接写入候选。** 默认的 `ask` 门控让无人值守的积累保持选择性启用：被误抽取的记忆会悄悄塑造此后的每一轮，而询问流是最便宜的纠正点。`auto` 对无人值守部署保持可用。

**把每个 namespace 都注入模型上下文。** 只有 `style` 记录成为常驻指引；`preference` 与 `fact` 记录是任务相关的而非常驻的，经由 `memory_search` 保持可触达，而注入整个存储会让系统提示词膨胀出陈旧、低相关度的内容。

**把反思与画像合并为一个插件。** 写入侧与模型可见侧独立演进，部署也可以只挂载其中之一；拆分让每个插件的配置与失败行为保持狭窄。

**用 `tags` 承担分类而不引入类型化 namespace。** tags 继续作为自由形式的分类，而封闭的 namespace 词汇让过滤、校验与画像的选择在 seam、提供方与工具之间成为编译期强制。

## Consequences

- 当 `style` 记忆变化时画像区段会改变系统提示词，因此保存或遗忘一条记忆会在下一个轮次边界使从该区段起的前缀复用失效。
- 每个完成的根轮次可能增加一次辅助生成；`maxInputBytes`、`maxOutputTokens` 与 `timeoutMs` 给它定界，但成本是真实的且按轮发生。
- 过期记录从 `recall` 与 `list` 中消失；过期时间由提供方在写入时计算并存储为 `expiresAt`。
- 没有提供方或没有路由时，反思在调用模型前停止；抽取失败记录一条告警，绝不使轮次失败。
- 刷新后的词汇在 seam、提供方与工具之间为编译期强制。

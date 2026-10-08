---
description: "钉住上下文检查点守卫：在模型因压缩丢失上下文时提醒其重新获取，供选择、配置或调试该插件的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-context-checkpoint

[English](README.md) | 中文

## Summary

本包让钉住的上下文在压缩后仍与模型同在。你把工作依赖的文本——约束块、决策记录、接口契约——钉入配置，守卫在每次模型步骤前检查每个钉住项是否仍存在于会话中。当某个钉住项已被压缩或修剪掉时，守卫提醒模型重新获取原文，而不是凭记忆行事。提醒是建议性的：它从不阻塞步骤。默认不钉住任何内容——按组合挂载插件并提供明确的钉住列表。

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

### When to choose it

当会话依赖特定原文在压缩后仍然存活——冗长的约束文档、验收标准、线上契约——而你担心的是模型在缺失它的情况下自信地继续工作时，选择本包。对重新推导成本很低的内容避免使用；对摘要能可靠保留的内容也避免使用：钉住项以引文形式存活在压缩摘要中时视为仍存在，因为模型仍能读到它。

### Configuring the pins

挂载插件并列出要钉住的文本：

```yaml
- name: '@deepseek-ai/dsh-context-checkpoint'
  config:
    pins:
      - label: tenant-filter-rule
        text: 'Every query must filter by tenant id before it reaches storage.'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `pins` | （必填） | 必须保持存在的文本；每个 `label` 命名提醒，`text` 按字面子串匹配 |

无效配置在启动时以清晰错误失败——钉住列表为空、钉住文本为空或标签重复——绝不会静默变成惰性插件。生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-context-checkpoint)记录每个受支持的值。

### What you get

当每个钉住项的文本仍在会话中时，守卫完全不可见。在压缩或修剪移除了模型已见过的钉住项之后，下一步的上下文会携带一条提醒，点名丢失的钉住项并指示模型先重读或重新获取原文。提醒本身留在上下文中并让守卫保持安静；如果压缩把提醒也移除了，守卫会再次提醒。文本重新回到上下文中的钉住项会干净地复位。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>实现内幕——点击展开</summary>

本节解释守卫如何检测丢失并投递提醒，并指向实现这些行为的代码；可观察行为已在 [Use this package](#use-this-package) 完整覆盖。

### Design commitments

- **建议，不否决。** 守卫向步骤的进入消息追加一条提醒；它从不拒绝或改写步骤。
- **检查模型将看到的。** 检测在 `agent/pre-step` 上针对步骤的进入消息序列运行——正是压缩所改写的用户消息流——因此钉住项恰好在其仍可被模型读到时才算存在。
- **按在场抑制，而非计数器。** 注入的提醒在 summary 中点名缺失的标签；提醒存活于上下文期间守卫保持安静，提醒被移除时自动重新武装，无需任何跨事件记账。
- **加载时大声失败。** 钉住列表在 `apply` 中校验并抛出，绝不会静默回退为惰性行为。

### Detection and delivery

守卫按代理记住哪些钉住标签已在上下文中出现过（`WeakMap<Agent, Set<string>>`）；从未出现的钉住项无从丢失，因此指向模型尚未读取内容的钉住项在该内容到达前保持安静。每个步骤守卫扫描进入消息中各钉住项的字面文本；每个已见但缺失、且其提醒本身也不在场的钉住项汇入一条提醒消息，追加在进入消息之后，source 为 `{kind: 'context-checkpoint', form: 'notice', summary: '<labels>'}`。从持久化恢复的会话以全新的已见集合开始：提醒只在钉住项重新出现后再次武装。

### Source map

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema、fail-loud 校验、pre-step 监听器 |
| — | 不发布运行时不变量伴随源；守卫暴露的包自有事件或快照不存在，独立观察无从分歧。 |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

当包级约定不够用时阅读以下页面。

- [Agent lifecycle](../../../docs/agent-lifecycle.zh.md) — 本守卫所检查的 pre-step 瀑布所属的步骤生命周期。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-context-checkpoint) — 每个受支持配置字段及其源声明。
- [guard 组映射](../README.zh.md) — 同组的 guard 包与循环卫生家族。

-----

<a id="model-experience"></a>
## Model Experience

### Checkpoint reminder

#### What the model sees

当已见的钉住项缺失且其提醒不在上下文中时，该步骤收到以下提醒。不添加任何工具 schema 或正常调用文本。

##### Checkpoint reminder

```markdown
Pinned context (<labels>) is no longer present in the conversation — an earlier compaction or prune removed it. Do not act on remembered content you can no longer see: re-read or re-obtain the source before continuing work that depends on it.
```

#### Token effect

每个钉住项都在场或其提醒存活时为零 token。每次丢失一个提醒，之后作为保留历史。

#### KV Cache effect

只追加；新可见内容跟随可复用的请求前缀，不使既有 KV-cache 条目失效。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

这些边界定义了守卫何时不适配。它们是当前包约束，而非任务清单。

- **仅用户消息上下文** — 检测扫描步骤的用户消息序列；只存在于工具结果或系统提示中的文本不在跟踪范围。
- **字面子串匹配** — 被改述或重排版的约束不再匹配；没有语义匹配。
- **已见状态在内存中** — 恢复的会话在每个钉住项重新出现后才会重新武装；恢复前已丢失的钉住项只在文本重现而后再度消失时才浮现。
- **仅建议** — 守卫无法自行重新注入丢失的内容；重新获取是模型的动作。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者的工作上下文——点击展开</summary>

None.

</details>

---
description: "面向用户与维护者的信号驱动模型路由器说明：配置显式请求路由，以及基于上下文压力与工具密度的 auto 分支。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-router

[English](README.md) | 中文

## 概述

挂载 `@deepseek-ai/dsh-llm-router` 可在分发前为模型请求选择路由：有序规则按请求的 provider 与 model 匹配，可选的 auto 分支根据实时的上下文压力与工具密度选择 capability 或 economy 目标。路由在 agent loop（智能体循环）的 `agent/request` waterfall（瀑布式事件）上改写已解析的调用配置，因此 loop 会像记录其他请求 header 一样记录并分发路由后的 provider、model 与 reasoning effort。没有配置时每个请求都原样通过；本插件不添加工具、不添加提示词内容、也不添加会话事件类型。

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

当模型选择应跟随配置与会话实时信号、而不是调用方固定的 provider/model 时挂载本插件——例如让对话步骤保持在 economy 路由，同时把工具密集或长上下文的步骤移到更强的模型。它改变请求分发到哪个路由，而这一改变可以从 loop 本就记录在案的请求 header 重建。

### 何时选择

当一个组合服务多个会话、且它们应随会话发展采取不同路由时选择它；或者当运维者想要一个有围栏的模型选择入口（规则）加一个自适应回退（auto 分支）时选择它。当组合有意固定一个模型时跳过它：没有 `routes` 也没有 `auto` 时，插件不改写任何请求。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-llm-router'
  config:
    routes:
      - when: { provider: deepseek, model: deepseek-chat }
        route: { provider: deepseek, model: deepseek-reasoner }
    auto:
      when: { provider: deepseek }
      capability: { provider: deepseek, model: deepseek-reasoner, reasoningEffort: high }
      economy: { provider: deepseek, model: deepseek-chat }
      contextPressureThreshold: 0.75
      toolDensityThreshold: 0.5
      toolDensityWindow: 12
```

规则优先于 auto 分支：首个 `when` 匹配请求 provider 与 model 的规则生效，而没有 `when` 的规则匹配所有请求。没有规则匹配、且 `auto` 已配置并且它自己的 `when` 匹配时，分支会把两个信号与各自阈值比较：任一信号达到或超过阈值时应用 `capability`，否则应用 `economy`；在两者都低于阈值时，缺失的 `economy` 目标让请求保持原样。分支的 `when` 与 `capability` 为必填，因此 auto 分支不可能缺少围栏或目标。阈值默认为占用率 0.75、以及最近 12 个已完成步骤上的密度 0.5；每个字段都在加载时校验，未知键会被拒绝而不是被静默合并。

### 你可以观察到什么

被路由的请求本身就是它的日志记录：loop 会把 `agent/request` waterfall 返回的配置记录为请求 header，因此路由后的 provider、model 与 reasoning effort 可以像未路由的请求一样从会话日志重建，不存在单独的路由事件。不带 `reasoningEffort` 的目标会清除任何继承的 effort，因为该 effort 是为原路由解析出来的；声明了 effort 的目标则应用它。改写后的配置与已解析配置相等时，插件返回原值而不是副本。

插件还会注册 `llmRouter` 宿主投影：每个已开始的步骤一个槽位，最旧的在前，最多保留 64 个槽位，该步骤发出工具调用时翻转一次。auto 分支的密度信号对窗口内最新的已完成槽位取平均；分发该请求的步骤对应的槽位仍然开放，不参与平均。

### 信号

上下文压力来自 `dsh-token-meter` 的 `contextPressure` 状态：最新的提供方锚定提示词大小，按其采样以来表层的带符号变动重新定价，再除以最新报告的 route 容量——即下一个请求的预测占用率。没有挂载 token meter 的组合、或计量器尚未持有完整采样的组合读不到压力，此时 auto 分支只依据密度决策。

工具密度是最近已完成步骤中发出过至少一次工具调用的占比。在任何步骤完成之前两个信号都读不到值，因此新会话不会被升级，配置了 `economy` 目标时会收到它的请求。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释路由器背后的设计；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

路由是在有文档记载的扩展点上的配置改写，而不是新的 loop 能力：插件监听 `agent/request` waterfall 并返回路由后的 `LlmCallConfig`，因此既有的 loop 无需路由专属代码就能记录并分发它。显式优先于隐式：有序规则决定它们写明的一切，auto 分支由自己的 `when` 与经过校验的阈值围栏，因此没有配置目标就不会有任何请求被改道。listener 采用 prepend，因此它能看到完整解析后的基础配置，并且它的返回值就是 waterfall 的最终配置。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件：配置校验、信号读取器、waterfall listener、`llmRouter` 投影 |
| [`src/types.ts`](src/types.ts) | 浏览器安全的配置、匹配、目标与宿主状态类型 |

### 路由流程

请求到达 waterfall 后，listener 先 await `next()` 获得已解析的调用配置，然后按顺序遍历已配置的规则。首个匹配返回它的目标；没有配置或匹配的 auto 分支时请求原样返回。否则分支通过投影注册表读取两个信号——只在这条路径上读取，因此仅用规则的部署从不会触碰投影折——任一信号达到或超过阈值时返回 capability 目标，否则返回 economy 目标。listener 丢弃继承的 `reasoningEffort`、应用目标的 effort，然后返回改写后的配置；没有变化时返回原值。

### 瀑布式组合

本插件是 `agent/request` waterfall 中的一个 listener。由于它采用 prepend，其余 listener 在它的 `next()` 内部准备基础请求，而它的返回值就是 loop 分发的配置；内层 listener 改写请求后，路由仍然在其后应用，而绝不会在其前应用。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够用时阅读这些页面。它们从路由插件走向它赖以构建的服务状态与扩展点。

- [Agent core 子系统](../../../docs/subsystems/core.zh.md) — `agent/request` waterfall 与本插件改写的已解析模型调用配置。
- [Token meter 子系统](../../../docs/subsystems/token-meter.zh.md) — 压力信号背后的 `contextPressure` 宿主状态。
- [Session projection 子系统](../../../docs/subsystems/session-projection.zh.md) — 提供 `llmRouter` 与 `contextPressure` 的折注册表。
- [dsh-llm 服务](../llm/README.zh.md) — 分发被路由请求的提供方中立服务。
- [LLM streaming 子系统](../../../docs/subsystems/llm-streaming.zh.md) — 路由后配置被记录于其中的请求 header 词汇。

-----

<a id="model-experience"></a>
## 模型体验

### 请求路由

#### 模型看到什么

路由后的 `provider`、`model` 与 `reasoningEffort` 就是模型收到的路由；请求的消息、系统提示词与工具保持不变。规则名、信号读数或路由元数据都不会到达任何模型输入——被路由的请求就是发往目标路由的正常请求。

#### Token 影响

路由改变请求由哪个路由定价与计费；token 计数跟随目标路由的适配器。被升级的步骤会移向部署需要付更多费用的 `capability` 路由，而 `economy` 路由为稳定的对话流量设上限——capability 分支恰好在会话出现压力或重工具使用时以成本换容量。

#### KV Cache 影响

改变路由后的 provider 或 model 会把请求前缀移到不同的缓存域，因此目标路由不会复用此前路由的缓存；稳定路由则保持前缀在该提供方规则下的复用资格。有意清除或替换 reasoning effort 属于目标提供方的缓存考量。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了路由器的边界与未来工作起点。它们是当前的包约束，不是通用的路由对比或任务清单。

- **规则只按 provider 与 model 匹配** — purpose、工具密度或上下文压力无法选择显式规则；这些信号只能到达 auto 分支的两个阈值。
- **信号读数不落日志** — 路由后的配置可以从会话日志重建，但选择它的压力与密度值属于实时读取；回放能重现请求，不能重现决策输入。
- **agent 步骤是路由边界** — 直接使用 `ctx.llm.stream()` 的消费方绕过 waterfall，分发各自配置的路由。
- **密度窗口上限为保留的槽位** — 投影保留 64 个已完成步骤槽位，因此配置超过 64 的窗口会在加载时被拒绝，而不是读取折已不再保留的槽位。
- **配置了 `economy` 时 auto 分支会改道新会话** — 在任何步骤完成之前两个信号都读不到值，分支不会被升级，因此新会话的请求会先发给 economy 目标，直到某个信号越过阈值。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本开发备注是非权威的工作上下文：维护者的笔记与开放问题。已发布行为与已接受的决策依据位于上文各节、包代码与链接的 Agent Note 中。

- 路由后的配置通过 loop 常规的请求 header 记录，而不是通过路由事件，因此未来若需要审计决策输入本身（而不仅是结果），需要单独记录信号采样。
- 密度窗口的上限有意与投影保留槽位耦合：单独提高其一会让配置的窗口读到折已经丢弃的槽位。

</details>

**运行时不变式：** 未发布配套包。路由决策在请求时读取 `llmRouter` 折与 token meter 的 `contextPressure` 状态，而这些读取是该折唯一的消费方；同一关系不存在可能分歧的独立观察，因此没有可供运行时不变式比较的对象。

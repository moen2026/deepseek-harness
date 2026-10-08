# Agent Note：信号驱动的模型路由

Status: implemented

[English](2026-09-28-signal-driven-model-routing.md) | 中文

## 问题

组合会把每个模型请求分发给其调用方解析出的 provider 与 model，因此一条固定路由同时服务对话步骤、工具密集步骤与长上下文步骤。当会话发展为重工具使用或高上下文占用时，正是它最需要更强模型的时刻，但在不为用户手动切换模型的前提下无法按请求提升路由。Qoder 对齐（路线图 D12）要求由任务信号驱动的模型路由。

## 决策

路由以新包 [dsh-llm-router](../../../../packages/llm/llm-router)（`packages/llm/llm-router`）交付：它是 `agent/request` waterfall（瀑布式事件）上的 listener，在 loop 记录并分发之前改写已解析的调用配置。

四条立场定义了该契约：

- **显式先于隐式。** 先查阅有序规则；首个 `when` 匹配请求 provider 与 model 的规则原样应用其目标，而缺少 `when` 的规则匹配所有请求。仅当没有规则匹配时才由可选的 auto 分支决策——它由自身必填的 `when` 与 `capability` 围栏——上下文压力或工具密度达到各自阈值时升级到 `capability`，否则应用 `economy`。不带 `reasoningEffort` 的目标会清除继承的 effort，因为该 effort 是为原路由解析出来的。
- **路由后的配置就是日志记录。** 不引入路由事件：loop 会把 waterfall 返回的配置记录为请求 header，因此路由后的 provider、model 与 reasoning effort 可以像未路由请求一样从会话日志重建——模型可见 ⟺ 已记录通过既有日志成立。
- **信号是投影读取。** 上下文压力来自 token meter 的 `contextPressure` 宿主状态；工具密度来自新的 `llmRouter` 宿主投影，它为每个已开始步骤折叠一个槽位（最旧的在前，上限 64，该步骤发出工具调用时翻转一次）。两者都只在 auto 分支路径上通过投影注册表读取，因此仅用规则的部署从不会触碰该折。
- **未配置即关闭。** 没有 `routes` 也没有 `auto` 时不改写任何请求；随附的 full profile 让插件保持禁用，直到 `DSH_LLM_ROUTER_ROUTES` 或 `DSH_LLM_ROUTER_AUTO`（JSON）提供配置。配置在加载时校验并手工拒绝未知键，因为 schemastery 对象 schema 会合并未知键而不是拒绝它们。

## 考虑过的备选方案

**在 `ctx.llm.stream()` 之外包一层做路由。** 包装 LLM 服务的路由器服务会绕过 agent 步骤边界：请求不会成为 loop 记录的请求 header，破坏被路由请求的日志重建，以及压缩与重试所依赖的持久语义。`agent/request` waterfall 是替换模型调用配置的文档化扩展点。

**为路由决策新增会话事件。** 路由后的配置已经通过请求 header 到达日志，专门的事件是冗余的——而新增事件会扩展默认读取即必需（required-on-read）的 `SessionEventMap`，并需要一次格式版本决策，却没有任何收益。

**在调用点做模型选择。** 让每个调用方自行判断 provider/model 会把信号逻辑复制到每个调用方，也不给运维者留下统一的模型选择围栏；waterfall 保持一个可审计的决策点。

**在缺少 `economy` 时回退到 `capability`。** 两个阈值之下，缺失的 economy 目标让请求保持原样。回退到 capability 会强加部署从未要求的升级；省略 `economy` 表达的是“该部署只对升级方向有观点”。

## 结果

- `packages/llm` 新增 `llm-router` 包，出现在组 README、`docs/config-catalog.md`、`docs/module-graph.md`，以及 `docs/event-producer-consumer.md` 的 `agent/request` 消费者列表中。
- full profile 的 patch 只通过这两个环境变量启用路由；其余情况下每个请求原样通过。
- 选择路由的压力与密度读数是实时的投影读取，而非记录值：被路由的请求可以从会话日志重建，而审计决策输入本身需要另行记录信号（已记录在包 README 的限制中）。

# Agent Note: 选择性启用的内置长期记忆

Status: implemented

[English](2026-09-27-opt-in-builtin-memory.md) | 中文

## Problem

仓库规模的智能体需要在用户说"记住这个"时持久一条持久的事实或偏好。在此之前的唯一记忆路径是第三方 MCP 服务器：每个选项都要求自行安装、初始化存储或账号，HTTP 服务器还需要单独的受监管进程（[已归档的决策](../../archived/feature/2026-07-31-third-party-memory-mcp-examples.md)；安装方式由 [memory MCP 指南](../../../../docs/user/guide/mcp-memory.zh.md) 负责）。当这些都不在运行时，`full` preset 的模型就没有第一方办法跨会话存储或召回任何内容，尽管 harness 早已为会话自带了 SQLite 检索能力、同样可以离线地服务于记忆。

## Decision

内置长期记忆能力按标准三层家族交付：[dsh-memory](../../../../packages/memory/memory) seam（`ctx.memory`：单一提供方占位加上 `remember`、`recall`、`forget`、`list`）、[dsh-memory-sqlite](../../../../packages/memory/memory-sqlite) 提供方（派生的 `node:sqlite` 存储，用 FTS5/BM25 应答召回），以及 [dsh-tool-memory](../../../../packages/memory/tool-memory) Consumer（`memory_write`、`memory_search`、`memory_forget`，外加一小节 system-prompt 指引）。`full` agent preset 挂载一个隔离的 `memory` 组：seam 与工具始终加载，提供方在部署通过 `DSH_MEMORY_PATH` 指定存储文件之前保持 disabled；没有提供方时，工具返回可操作的"不可用"应答而不是让会话启动失败。

召回默认按词法排序。向量路径仅在部署通过提供方的 `embedding` 配置自带 OpenAI 兼容的 HTTP 嵌入端点时激活：届时写入会同时在旁表存一份向量，召回先以 BM25 预筛、再对候选在 JS 内用余弦相似度融合，任何端点故障或超时都降级回词法应答，记忆因此保持离线可用。在 preset 中，端点由 `DSH_EMBEDDING_URL`、`DSH_EMBEDDING_MODEL`、`DSH_EMBEDDING_AUTH_ENV` 与 `DSH_EMBEDDING_DIMENSION` 组装；配置里只存 bearer 令牌的*变量名*，凭据在调用时从环境变量读取，绝不写入 YAML、记忆存储或日志。

相对 MCP 路径，本决策纯属增补：不从[已归档的决策](../../archived/feature/2026-07-31-third-party-memory-mcp-examples.md)移除或降级任何东西，其示例 overlay 照常交付，其指南仍是外部记忆服务器的权威。中立性表述原样延续——DSH 不选定模型、也不选定嵌入提供方；不配置端点的部署得到的就是纯词法存储。（code-index seam 的本地哈希子词语义排序是一条独立的、纯算法的路径，不触及此规则——见[本地语义排序决策](2026-09-29-local-hashed-semantic-code-index.zh.md)。）

## Alternatives considered

**把 MCP 示例当作唯一记忆路径。** 它在离线场景下持续失败：`full` preset 承诺不依赖外部服务器、账号或受监管进程就能完成读写，而 harness 已经掌握做这件事所需的 SQLite 机制。MCP 路径与内置路径并列可用。

**`sqlite-vec` 之类的原生向量扩展。** 本仓库的供应链构建策略禁止原生构建脚本，`node:sqlite` 也不加载扩展。对 BM25 预筛出的候选集在 JS 内做余弦相似度，把融合留在进程内、零新增依赖。

**在 `ctx.llm` 上加嵌入方法并选定默认提供方。** 仓库今天没有嵌入 seam，而且默认选定提供方与 memory MCP 指南"DSH 不为其选择模型/嵌入提供方"的明确立场冲突；端点因此归部署自带。

**经由 session 或 storage seam 存记忆。** 那些存储只管持久化，不管排序、结果定界与片段渲染；把召回语义放进每个 Consumer 会重复提供方的工作、并在各界面间漂移。

## Consequences

- 未设置任何新环境变量的部署看不到行为变化：记忆工具照常挂载，提供方保持 disabled，记忆操作以模型可转述的"不可用"形式应答。
- 存储文件是派生数据、仅属主可读写（`0o600`），由专属的 `PRAGMA application_id` 把守、以 `user_version` 管版本，可安全删除并重建。
- 启用向量路径会为每次写入与每次预筛召回增加一次 HTTP 往返；降级保词法的承诺使可用性与端点健康状况脱钩。
- 内置记忆与外部记忆 MCP 服务器可以在同一部署中同时挂载；两者的存储永不合并，召回也永不跨越彼此。

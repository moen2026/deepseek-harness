# Agent Note: Damon web client parity surfaces

Status: proposed

[English](2026-10-02-damon-web-client-parity-surfaces.md) | 中文

## Problem

对照同类 agent 桌面客户端（Qoder）的能力评估发现：Damon Web 客户端已用既有包覆盖其绝大部分界面——会话列表与管理（`ui-workspace`）、对话与模型/智能体预设选择（`ui-conversation`、`ui-model-selection`、`ui-agent-preset`）、变更文件审查卡（`ui-deliverables`）、带概要/终端/文件标签的右侧面板（`ui-sidebar-right` 编排 `ui-trajectory`、`ui-sidebar-terminal`、`ui-sidebar-files`，经 `ui-dockkit` 可任意停靠）、todo 进展、引用与技能（`ui-reference`、`ui-skill`）、定时任务（`ui-schedule`）、插件管理（`ui-plugin-manager`）与"在应用中打开"（`ui-open-in-app`）。桌面客户端本身是套在 Web UI 外的 Electron 壳；DSH 已把该壳作为 `apps/desktop` 交付，因此剩余差距不在壳，而在 Web 客户端尚未渲染的四个界面：

1. **知识中心**——[knowledge seam](../../../../docs/subsystems/knowledge.zh.md) 已交付 `ctx.knowledge` 与 `tool_knowledge` 工具，但没有任何 Web 界面浏览或管理已存知识。
2. **记忆管理**——`dsh-memory` 提供记忆服务、`tool_memory` 把变更记入会话，但会话之外没有列出、查看或删除记忆的界面。
3. **MCP 状态与资源**——`dsh-mcp` 连接服务器、`mcp-resources` 服务共享资源，但没有面板展示服务器连接状态或可浏览的资源；插件设置列表只覆盖插件清单。
4. **Composer 语音输入**——composer 没有听写入口。

每项都是独立特性；互不依赖，且都可以单独交付。

## Proposal

四个 Web 界面作为独立的 client 包交付，各自消费既有服务与会话事件——不改 agent-loop，不改 session format。

### 知识中心界面

`ui-knowledge` 包从 raw `tool_knowledge` 事件与持久化结果元数据派生会话中的知识活动卡，并提供一个管理视图（实现时定为右侧 sidebar 标签类型或 workspace 页面）列出已存记录。记录存放在部署所配置的 knowledge provider——SQLite，不在 session log——因此管理视图经 Host 查询端点读取，模式沿用 storage 包的 browser-safe entry，作用域限定该 provider。删除走模型所用同一 `tool_knowledge` remove 操作，遵守同样的审批预期。

### 记忆管理界面

`ui-memory` 包列出记忆条目及其来源，从已记录的 `tool_memory` 调用渲染逐条活动，并经既有服务操作暴露删除。记忆内容是 session log 之外的持久状态；列表读 Host 端点，会话卡从 raw 事件派生。

### MCP 状态与资源面板

`ui-mcp` 包展示已连接服务器、其工具与资源、逐 Session 的资源使用。`mcp-resources` 已在调用方作用域内服务资源调用，MCP server 的指令与资源也已抵达 Session——面板呈现既有状态，不新增第二条连接路径。

### Composer 语音输入

composer 中使用浏览器 SpeechRecognition API 进行听写，浏览器不提供时降级为隐藏控件。音频不由 DSH 上传；识别由浏览器自带的语音服务处理，因此不新增会话事件、凭据或转录持久化——超过此人选择发送的文本之外什么都没有。

## Alternatives considered

**靠更重的桌面壳对齐。**否决：壳不是差距所在——每个缺失界面都是 Web UI 范畴，`apps/desktop` 已经承载同一 Web 客户端；把能力复制进仅壳可用的原生代码会让它们与浏览器体验分叉。

**四个界面合进一个新 "console" 插件交付。**否决：各界面之间没有共享状态，且本代码库的惯例是一个域一个包、各带注册、测试与 README；合并包会把四个独立的批准与发布周期捆在一起。

**知识与记忆列表经 agent 工具而非 Host 端点。**否决：那样连列举与删除都需要活的模型调用来管理数据，且纯人类管理任务会撑大 agent 可见清单的请求前缀。

**原生壳的语音识别。**对 Web 客户端否决：那会让听写变成桌面专属，而浏览器 API 无需新传输即可覆盖 Web 客户端。

## Acceptance criteria

- 每个界面独立交付、独立批准；未挂载它的部署看不到任何变化，所有既有界面行为与今天完全一致。
- 知识与记忆管理视图经其 Host 端点读取部署所配置的 provider，尊重其可用性（沿用知识工具的 not-available 文案模式），绝不虚构回退列表。
- 知识、记忆与 MCP 的会话卡从 raw session 事件与持久化结果元数据派生；不新增 session 事件，不改 `SESSION_FORMAT_VERSION`。
- 所有产品文案走 locale 字典；知识中心与记忆视图无需任何 agent 调用即可到达。
- 语音输入在 Chromium 系浏览器可用，不支持的浏览器不渲染任何控件，且 DSH 不新增任何音频采集、存储或传输。

## Risks

知识与记忆端点把持久存储暴露给浏览器，其授权面必须与既有会话数据端点对齐而不是放宽；缺少查询能力的 provider 必须可见地降级，不能默默降级。MCP 面板依赖服务器自报的能力，服务器的能力缺口若不加"服务器自报"标注会被误读为产品缺陷。SpeechRecognition 的质量与可用性因浏览器和平台而异，且浏览器的语音服务是此人听写时默认信任的第三方；控件必须把这一点讲明白。安静的风险是范围蔓延：每个界面都应对照此处列出的服务交付，抵制为实现对齐清单而生长出 agent-loop 或持久化变更。

# Agent Note: Browser extension provider

Status: proposed

[English](2026-10-02-browser-extension-provider.md) | 中文

## Problem

现有的三个 [browser-use 提供方](../../../../docs/subsystems/browser-use.zh.md)都通过 Chrome DevTools Protocol 或自行启动 Playwright/Stagehand 浏览器来触达浏览器。两条路径都错过了一个人真正使用的浏览器：CDP 附加需要专门以调试端口启动的浏览器，且只能看到 DevTools 能看到的；而启动的浏览器没有此人的 profiles、登录态和扩展。需要在日常浏览器中获得已认证会话的任务——内网页面、已登录的 SaaS——无从触达，而页内扩展能观察到的内容与事件，页面级自动化只能笨拙地近似。

## Proposal

发布一个 DSH 自有的 Chromium 扩展作为第四个 browser-use 提供方。扩展通过一条 WebSocket **向外**连接 Host——与调试端口模型相反，此人的机器不开任何入站端口——并用 Host 在 Web UI 同一处展示的令牌完成配对。提供方以自己的名字通过不变的 [`ctx.browserUse` 槽位](../../implemented/architecture/2026-09-12-browser-use-provider-registration.zh.md)注册，拥有自己的工具（标签页导航、DOM 读取、点击与输入、页面允许时的截图），并保持每 Session 所有权：一个 Session 预留已配对的浏览器，Session 释放时解除预留，浏览器及其状态原样保留。

由于扩展运行在此人自己的浏览器内，登录态与 profile 状态跨工具调用持久存在，不需要独立的 profile 存储。首批范围是桌面版 Chrome 与 Chromium；扩展先以开发者侧载 bundle 分发，商店分发是其后独立的资格认定。

### Pairing and trust

配对是显式的：Host 展示一个短时效令牌，扩展发送一次，Host 把连接钉在该令牌的会话上。第二台浏览器作为独立附加配对，竞争今天附加路径已有的单提供方预留语义。扩展请求部署所配置来源的主机权限，默认不请求 `<all_urls>`。

## Alternatives considered

**用持久 CDP 连接扩展 Stagehand 附加。**否决其作为通用答案：仍需调试端口，content-script 的存在仍不持久，浏览器仍须以特殊模式启动。它保留为纯自动化场景的后备。

**Playwright persistent context。**否决：独立 profile 可以持有登录态，但它不是此人的日常浏览器，复制其状态并悄悄与之分叉。

**扩展内的 MCP server。**否决：MCP 管道是现成的，但所有权、每 Session 队列与预留语义已经存在于 browser-use 提供方模型中；MCP 层会把 Session 所有权移进 `mcp-client`，违背注册决策。

**分叉 Chromium 做原生集成。**否决：构建与发布成本超出所获能力的量级。

## Acceptance criteria

- 扩展加载并配对后，Session 的浏览器工具操作此人自己浏览器的标签页；释放解除预留，浏览器保留状态并保持打开。
- 同一时刻只有一个 Session 拥有已配对的浏览器，与既有附加预留语义一致。
- 扩展工具调用与其他提供方工具一样记录进 Session 日志；不新增持久化事件或 Session schema 变更。
- 没有扩展时，部署的行为与今天完全一致：提供方缺席，不贡献任何工具。

## Risks

商店政策约束远程控制类扩展（宽泛主机权限、远程代码）；首发因此走侧载，商店路径需要独立的资格认定。此人的浏览器向自动化暴露真实凭据，工具范围必须停留在显式、用户可见的操作上，绝不自主读取凭据。配对不得削弱 profile 隔离，也不得让一个已配对的 Host 观察令牌未授权的另一来源。Firefox 与移动端延后，WebSocket 通道继承通常的劫持与拒绝服务风险，由令牌时效约束。

# 通过 MCP 接入 SaaS 提供方

[English](saas-connectors.md) | 中文

这三份**默认关闭的参考配置**把一个 SaaS 提供方接入 DSH，底层是 [`@deepseek-ai/dsh-mcp-client`](../../../packages/mcp/mcp-client/README.zh.md)。按需选用，或复制同一条通用 MCP 行接入其他提供方。

这些第三方配置仅作为互操作示例提供；收录它们不代表 DeepSeek 的认可、推荐、合作或持续支持。

## DSH 做什么

DSH 解析选中的 Cordis overlay，启动配置好的 stdio 命令或连接配置好的 Streamable HTTP URL，发现 MCP 工具，并以 `mcp__<serverName>__<tool>` 的形式暴露它们。DSH 不创建提供方账号、不铸造令牌、也不协商 OAuth；下文每一节都使用该提供方为无人值守客户端指定的令牌或本地端点。

对 stdio，通用客户端按 DSH 插件生命周期启动和停止子进程，并在启动前剥离名称通常标识凭据的环境变量；示例只加回自己需要的那一个变量。对 Streamable HTTP，上游服务必须已经可达。

## 选择一个

| 提供方 | 端点 | 传输 | 前置条件 |
|---|---|---|---|
| [Stripe](https://docs.stripe.com/mcp) | `https://mcp.stripe.com` | Streamable HTTP | `STRIPE_SECRET_KEY` 中的受限 API 密钥 |
| [Supabase](https://supabase.com/docs/guides/getting-started/mcp) | 本地 stdio | stdio | Node 22.18+ 与 `SUPABASE_ACCESS_TOKEN` 中的个人访问令牌 |
| [Figma Dev Mode](https://developers.figma.com/docs/figma-mcp-server/) | `http://127.0.0.1:3845/mcp` | Streamable HTTP | Figma 桌面应用运行且已启用 Dev Mode MCP |

## 启用一个

```sh
dsh web --patch "$PWD/apps/cli/config/examples/saas-connectors/stripe.cordis.yml"
```

把文件名替换为 `supabase.cordis.yml` 或 `figma.cordis.yml`。出厂组合中没有 SaaS 连接器，省略 `--patch` 时三者全部保持关闭。要让选择跨次运行生效，把所选文件里唯一的 `insert` 补丁合并进用户补丁层——单 profile 用 `$DSH_HOME/profiles/<name>/cordis.patch.yml`，整台机器用 `$DSH_HOME/cordis.patch.yml`。不要整份覆盖既有文件：里面可能已有无关的用户补丁。

## 提供方设置

### Stripe

```sh
dsh web --patch "$PWD/apps/cli/config/examples/saas-connectors/stripe.cordis.yml"
```

启动前设置 `STRIPE_SECRET_KEY`。更稳妥的做法是使用只授予此 Agent 所需权限的[受限 API 密钥](https://docs.stripe.com/keys)；托管服务器也支持 OAuth，但 `dsh-mcp-client` 不协商 OAuth。Stripe 对退款等敏感操作要求人工确认：服务器返回一个审批 URL，Agent 转述给你，你在浏览器里完成批准。

### Supabase

```sh
npm install --global @supabase/mcp-server-supabase@latest
dsh web --patch "$PWD/apps/cli/config/examples/saas-connectors/supabase.cordis.yml"
```

创建一个只覆盖此 Agent 可触碰项目的[个人访问令牌](https://supabase.com/docs/guides/getting-started/mcp)，并在启动前设置 `SUPABASE_ACCESS_TOKEN`。stdio 桥会从环境里剥离该变量，示例的 `config.env` 条目是它到达服务器的唯一路径。需要冻结参考时，把上面命令中的版本固定为你实际安装的版本。

### Figma

```sh
dsh web --patch "$PWD/apps/cli/config/examples/saas-connectors/figma.cordis.yml"
```

在 Figma 桌面应用的偏好设置里启用 **Enable Dev Mode MCP Server**，并保持应用运行；它会在本地提供 `http://127.0.0.1:3845/mcp`。托管远程端点 `https://mcp.figma.com/mcp` 需要 OAuth，`dsh-mcp-client` 不协商 OAuth。

## Lark 与飞书

Lark（飞书）桥是原生能力，不是 MCP：[`connector-feishu`](../../../packages/connector/connector-feishu/README.zh.md) 验证回调、按 channel 续写唯一的确定性会话，并通过飞书 API 推送回复。请使用它，而不是 Lark MCP 行。

## 验证

在一个新的 DSH 会话里，提出一个只有该提供方才能回答的只读问题——"列出我的 Stripe 产品"、"列出我的 Supabase 项目"，或"在 Figma 里搜索 checkout 画框"。确认模型调用了对应的 `mcp__stripe__…`、`mcp__supabase__…` 或 `mcp__figma__…` 工具，并基于其结果作答。初始发现是异步的，发出第一条提示前请先等该提供方的 `mcp__...` 工具出现。

---
description: "可选的 GitHub 出站评论能力：模型可见的 github_comment 工具通过 REST API 以凭据接缝的 Bearer token 在 issue 或 PR 上发表一条 Markdown 评论；挂载方式、可用性语义与错误映射。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-github

[English](README.md) | 中文

## Summary

本插件为审查 Session 补上可选的 GitHub 出站评论能力。模型可见的 `github_comment` 工具通过 REST API 在一个 GitHub issue 或 PR 上发表一条 Markdown 评论，每次调用都以凭据接缝解析的 Bearer token 认证。部署把它与限定 Session 可触达仓库的 webhook 规则一同挂载；token 缺失时返回可操作的 unavailable 结果而不是让 Session 失败，API 错误则携带状态码与响应摘录抛出。

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

在具备 `tools` 与 `credentials` 能力的组合中挂载本插件——通常是与 webhook 规则同层的 overlay，随附的 github-review 示例正是如此：

```yaml
- id: github-comment-tool
  name: '@deepseek-ai/dsh-tool-github'
  config:
    tokenEnv: DSH_GITHUB_REVIEW_TOKEN
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `tokenEnv` | （必填） | 持有 GitHub API token 的凭据引用；需要具备 PR 写权限的个人访问令牌 |
| `apiBaseUrl` | `https://api.github.com` | REST API 根地址；仅在 GitHub Enterprise Server 上覆盖 |
| `timeoutMs` | `30000` | 单请求超时（毫秒） |

token 每次调用都经 `ctx.credentials.resolve` 解析，轮换后的凭据无需重启即对下一条评论生效。本插件不属于任何随附 bundle：评论是外部的、可见的副作用，因此每处部署自行决定它允许出现的位置。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`apply` 在加载时校验边界，然后注册一个工具。执行时先解析 token：凭据缺失返回 `unavailable` 结果，完全不接触 API。有效调用发送一条 `POST /repos/{owner}/{repo}/issues/{number}/comments`，携带 `Accept: application/vnd.github+json`、`x-github-api-version` 头与 `Authorization: Bearer <token>`；请求将调用信号与配置的超时竞争。参数校验（`owner/repo` 形态、正整数编号、非空正文）先于凭据查找运行，因此畸形调用不会触碰凭据接缝或网络。

`201` 响应以 `ok` 与评论的 `html_url` 完成。任何其他响应抛出携带状态码与响应体前 200 字符的错误；传输失败抛出并附上原因。该工具非并发安全：调用与其他副作用工具一样经工具管线串行。

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [工具 schema 目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-github) — 模型收到的生成版 `github_comment` schema。
- [GitHub 审查指南](../../../docs/user/guide/github-review.zh.md) — 本工具补全的从入站到评论的审查工作流。
- [Webhook 包组](../README.zh.md) — 创建审查 Session 的规则运行时与适配器。

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

模型看到生成版 [`github_comment` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-github)：三个必填参数——`owner/repo` 形态的 `repository`、issue 或 PR 的 `number`、Markdown `body`。描述写明凭据前提、unavailable 回答，以及在工作流未强制发表时先与用户确认的预期。

#### Token effect

插件激活期间每个请求的固定 schema 开销；token 引用与 API 根地址不会发送给模型。

#### KV Cache effect

可见工具定义与顺序不变时前缀稳定；注册生命周期变更自第一个改动的 schema token 起可能使复用失效。

### Results

#### What the model sees

`ok` 结果返回一行评论 URL；凭据缺失返回一行 `unavailable`，指名待配置的凭据引用。校验与 API 失败以工具错误形式呈现，携带状态码与响应摘录。

#### Token effect

成功或 unavailable 指引为一行的比例开销；错误附加重写响应摘录。

#### KV Cache effect

无——结果只进入响应轮，不进入请求前缀。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 单工具、单调用单评论：本插件不读取 GitHub、不编辑评论、不关闭 issue——这些属于未来的可选工具。
- 仓库限定是组合性的：工具接受任何 `owner/repo`；部署通过只在 webhook 规则创建的 Session 中挂载本插件来约束它。
- token 必须已具备 PR 写权限；工具不发现也不协商 scope。
- 限流与权限以携带响应摘录的 API 错误抛出；没有重试或退避。
- 评论以 token 的身份发表；除工具描述中先与用户确认的预期外，没有草稿或审批闸门。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

无。

</details>

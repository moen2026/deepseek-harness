---
description: "Opt-in outbound GitHub commenting: the model-facing github_comment tool posts one Markdown comment on an issue or pull request through the REST API with a credential-seam Bearer token; mounting, availability semantics, and error mapping."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-github

English | [中文](README.zh.md)

## Summary

This plugin adds opt-in outbound GitHub commenting to review Sessions. The model-facing `github_comment` tool posts one Markdown comment on a GitHub issue or pull request through the REST API, authenticating with a Bearer token resolved from the credential seam at each call. A deployment mounts the plugin next to the webhook rules that scope which repositories a Session may touch; a missing token answers an actionable unavailable result instead of failing the Session, and API errors throw with the status and response excerpt.

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

Mount the plugin in any composition that has the `tools` and `credentials` capabilities — typically an overlay next to a webhook rule, as the shipped github-review example does:

```yaml
- id: github-comment-tool
  name: '@deepseek-ai/dsh-tool-github'
  config:
    tokenEnv: DSH_GITHUB_REVIEW_TOKEN
```

| Field | Default | Meaning |
|---|---|---|
| `tokenEnv` | (required) | Credential reference holding the GitHub API token; a personal access token with pull request write access |
| `apiBaseUrl` | `https://api.github.com` | REST API root; override only for GitHub Enterprise Server |
| `timeoutMs` | `30000` | Per-request timeout in milliseconds |

The token is resolved through `ctx.credentials.resolve` on every call, so a rotated credential reaches the next comment without a restart. The plugin is not part of any shipped bundle: commenting is an external, visible side effect, so each deployment decides where it is allowed.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`apply` validates the bounds at load, then registers one tool. Execution resolves the token first: a missing credential returns the `unavailable` outcome and the API is never contacted. A valid call sends one `POST /repos/{owner}/{repo}/issues/{number}/comments` with `Accept: application/vnd.github+json`, the `x-github-api-version` header, and `Authorization: Bearer <token>`; the request races the call signal against the configured timeout. Argument validation (`owner/repo` shape, positive integer number, non-empty body) runs before the credential lookup, so a malformed call never touches the seam or the network.

A `201` response resolves to `ok` with the comment's `html_url`. Any other response throws an error carrying the status code and up to 200 characters of the response body; a transport failure throws with the cause attached. The tool is not concurrency-safe: calls serialize through the tool pipeline like other side-effecting tools.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Tool schema catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-github) — the generated `github_comment` schema the model receives.
- [GitHub review guide](../../../docs/user/guide/github-review.md) — the ingress-to-comment review workflow this tool completes.
- [Webhook package group](../README.md) — the rule runtime and adapters that create the review Sessions.

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`github_comment` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-github): three required parameters — `repository` as `owner/repo`, the issue or pull request `number`, and the Markdown `body`. The description states the credential prerequisite, the unavailable answer, and the confirm-with-the-user expectation when the governing workflow does not already mandate posting.

#### Token effect

Fixed schema cost on every request while the plugin is active; the token reference and API root are never sent to the model.

#### KV Cache effect

Prefix-stable while the visible tool definition and order are unchanged; registration lifecycle may invalidate reuse from the first changed schema token.

### Results

#### What the model sees

An `ok` result returns one line with the comment URL; a missing credential returns an `unavailable` line naming the credential reference to configure. Validation and API failures surface as tool errors with the status code and response excerpt.

#### Token effect

Proportional to one line for success or the unavailable guidance; errors add the response excerpt.

#### KV Cache effect

None — results enter only the response turn, not the request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- One tool, one comment per call: the plugin does not read GitHub, edit comments, or close issues — that belongs to future opt-in tools.
- Repository scoping is compositional: the tool accepts any `owner/repo`; a deployment constrains it by mounting the plugin only in Sessions its webhook rules created.
- The token must already carry pull request write access; the tool does not discover or negotiate scopes.
- Rate limits and permissions propagate as thrown API errors with the response excerpt; there is no retry or backoff.
- Comments post as the token's identity; there is no draft or approval gate beyond the tool description's confirm-with-the-user expectation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

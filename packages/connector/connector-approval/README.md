---
description: "Approval bridge over the connector seam: platform interactive-card clicks answer approval requests as durable resolutions."
kind: "package-reference"
---

# @deepseek-ai/dsh-connector-approval

English | [中文](README.zh.md)

## Summary

`dsh-connector-approval` answers `approval/request` waterfall events for Sessions bound to a connector channel by pushing one interactive card and letting the platform's click decide. One plugin instance serves the configured connector providers; Sessions without a bound channel keep their normal answerer chain. The bridge consumes the connector seam's interactive-resolution route; it never re-enters a Session.

## Table of Contents

- [Configuration](#configuration)
- [Request flow](#request-flow)
- [Decision routing](#decision-routing)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="configuration"></a>
## Configuration

| Key | Meaning |
|---|---|
| `providers` | Non-empty list of connector provider ids the bridge answers for, such as `['feishu']`. |
| `allowLabel` | Label of the button deciding `allowed-once`; defaults to `Approve`. |
| `rejectLabel` | Label of the button deciding `rejected`; defaults to `Reject`. |
| `approvers` | Optional map of platform sender id to a human-readable identity. When present, a resolution from any unmapped sender is rejected (default-deny); when absent, every member of the channel may decide. |

An empty provider list fails the plugin at load, and so does an `approvers` map without at least one non-empty sender-to-identity entry.

<a id="request-flow"></a>
## Request flow

On an `approval/request` for a Session whose id is bound through `ctx.connector.channelOf()`, the bridge mints one correlation id, pushes one card carrying a primary allow button and a danger reject button, and waits. The request's abort signal settles it `'cancelled'`; a push failure fails the request closed like any other unavailable answerer; unloading the bridge cancels every pending wait. Sessions without a bound channel delegate to `next()` unchanged.

<a id="decision-routing"></a>
## Decision routing

The bridge registers one `ctx.connector.resolutions()` consumer per configured provider. Each button id encodes `dsh-approval:<correlationId>:<outcome>`; a callback whose action id was not minted here, or whose request is no longer pending, is logged and dropped. A clicked outcome answers the waterfall as `allowed-once` or `rejected`; the platform only needs to echo the button value verbatim.

When `approvers` is configured, authorization runs before the outcome is applied: a resolution from a sender outside the map is logged with the sender id and settles its pending request as `rejected` — default-deny, so an unmapped group member can block a tool call but never approve one. Mapped decisions log the mapped identity with the sender id and outcome.

<a id="model-experience"></a>
## Model Experience

None, as the bridge sits on the approval seam and the connector seam; it contributes no prompt, tool schema, or session event. The approval outcome is audited by `dsh-user-approval` as before.

#### KV Cache effect

No direct effect; no model request is assembled or modified.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Correlation is process-local** — pending waits live in memory: unloading the bridge cancels them, and a click arriving after its wait is gone (late, or after a restart) is dropped.
- **One decision per request** — the first resolution for a correlation id answers it; later clicks on the same card are dropped.
- **Provider rendering required** — a provider that ignores `actions` renders no buttons, so its requests wait until aborted.
- **Sender identity is deployment-configured** — the bridge knows senders only by their platform ids; `approvers` must be kept in sync with the platform's membership by hand, and an unmapped legitimate approver is rejected until mapped.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The bridge observes one waterfall and one resolution route, both owned elsewhere.

---
description: "The alert-raising rules for the DeepSeek Harness notification seam — watches pending approvals, long turn completions, delivered scheduled reminders, and armed goals, and hands each signal to ctx.notification as a provider-agnostic alert."
kind: "package-reference"
---

# @deepseek-ai/dsh-notification-triggers

English | [中文](README.zh.md)

## Summary

Use `dsh-notification-triggers` to turn host state changes into operator alerts: it watches four signals — an approval waiting past a threshold, a long turn finishing, a delivered scheduled reminder, and an armed goal — and raises each one through [dsh-notification](../notification/README.md). Every rule is a configurable switch or threshold with a schema default, so the settings surface renders the knobs without extra code. The plugin registers no tool and no model-facing surface, and a failed alert is logged instead of failing the host signal that raised it. Mount it beside the seam and one surface provider — [dsh-notification-desktop](../notification-desktop/README.md) or [dsh-notification-web](../notification-web/README.md).

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

Mount the rules wherever the seam is mounted. It is a consumer of [dsh-notification](../notification/README.md): it defines which state changes deserve an alert and raises them through the seam; how an alert reaches the operator stays the provider's concern.

### When to choose it

Choose it when pending approvals, long turns, delivered reminders, or armed goals should reach the operator without anyone watching the transcript. Without a mounted provider the alerts are still raised but logged as undelivered; without this plugin the seam stays silent.

### Composing a notification stack

```yaml
- name: '@deepseek-ai/dsh-notification'
- name: '@deepseek-ai/dsh-notification-triggers'
- name: '@deepseek-ai/dsh-notification-desktop'
```

### Configuration

| Field | Default | Effect |
|---|---|---|
| `approvalWaitSeconds` | 60 | Seconds an approval may wait before an alert is raised. |
| `turnCompleteMinSeconds` | 30 | Minimum turn duration in seconds; shorter turns stay silent. |
| `notifyScheduled` | true | Whether a delivered scheduled reminder raises an alert. |
| `notifyGoalActivation` | true | Whether a goal becoming armed raises an alert. |

The schema carries every default, so the Loader resolves omissions and the settings surface renders the fields as user preferences without additional code.

### What each rule raises

| Signal | Alert title | Alert tag |
|---|---|---|
| Approval waiting past the threshold | `Approval is waiting` | `approval:<callId or agent id>` |
| Turn finished at or above the minimum | `Turn finished` | `turn:<sessionId>` |
| Scheduled reminder delivered | `Reminder delivered` | `schedule:<scheduleId>` |
| Goal became armed | `Goal armed` | `goal:<sessionId>` |

### Failures and recovery

Alerts are best-effort: a raised alert never blocks the state change it reports, and a `notify` rejection is logged as `notification-triggers: alert was not delivered: …` instead of propagating. The approval timer is `unref`ed, so a pending alert can never keep the process alive.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the rules and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design philosophy

- **Rules, not a channel.** The plugin observes host events and calls the seam; delivery mechanics, platform capability checks, and fallback behavior stay with the mounted provider.
- **Thresholds are configuration.** Every deployment-varying number is a validated `Config` field with a schema default — not a constant — so a deployment can retune alerting from cordis.yml and the preferences surface.
- **Best-effort raising.** `notify` is called fire-and-forget; a rejection is logged so a broken provider can never fail the approval, turn, delivery, or goal signal that triggered the alert.
- **Per-Session turn tracking.** Turn start times live in one process-local `Map` keyed by `SessionId`; `api-session/removed` drops the entry so a closed Session never leaks one.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `name`, `inject`, `Config`, `apply` with the four alert rules |
| — | No runtime invariant companion is published; the rules hold no independent observable state beyond the turn map, and a published alert is already the seam's own observable event. |

### Events and rules

| Event | Rule |
|---|---|
| `approval/request` (waterfall) | Arms one timer per in-flight decision for `approvalWaitSeconds`, then awaits `next()`; the timer is cleared in `finally` so an arriving decision stays silent. |
| `api-session/status` | Records the start instant on `running: true`; on completion raises only when the elapsed seconds reach `turnCompleteMinSeconds`. |
| `api-session/removed` | Drops the Session's recorded start so a later completion raises nothing. |
| `schedule/delivered` | Raises the reminder alert, gated by `notifyScheduled`. |
| `goal/activation-changed` | Raises the goal alert only for `activation: 'armed'`, gated by `notifyGoalActivation`. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the rules to the seam they feed and the surfaces that deliver their alerts.

- [dsh-notification](../notification/README.md) — the seam these rules call and the request vocabulary they build.
- [dsh-notification-desktop](../notification-desktop/README.md) — the desktop-surface provider for alerts on a desktop deployment.
- [dsh-notification-web](../notification-web/README.md) — the browser-surface provider for deployments without a desktop shell.
- [notification group map](../README.md) — the package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

None, as the alert rules register nothing model-facing.

#### KV Cache effect

None; this plugin neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the rules' current scope. They are package constraints, not a task backlog.

- **No delivery guarantee or retry** — a rejected alert is logged and dropped; the seam routes once and the rules never re-raise.
- **Fixed alert copy** — titles and bodies are fixed English owned by the rules; localization of operator-facing presentation is left to the surface provider and its shell.
- **In-process tracking only** — turn starts are process-local and not persisted; a Host restart forgets in-flight turns.
- **Plugin-gated signals** — the scheduled-reminder and goal rules only fire when `dsh-schedule` or `dsh-goal` is mounted and emits the corresponding event.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

---
description: "Per-session heartbeat patrol: a recurring Schedule reminder that reads the workspace heartbeat file and acts on its pending items."
kind: "package-reference"
---

# @deepseek-ai/dsh-heartbeat

English | [中文](README.zh.md)

## Summary

The heartbeat patrol turns one recurring Schedule reminder into a periodic workspace check. The model enables the patrol with `heartbeat_enable`; each due delivery reads the workspace heartbeat file (`HEARTBEAT.md` by default), acts on its pending items, and records completed items back into the file. A missing file or one with nothing pending is answered with `HEARTBEAT_OK` and nothing else.

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

The shipped Web bundle mounts the tools next to Schedule. A Session gains the patrol only when its model calls `heartbeat_enable`; one patrol exists per Session, and `heartbeat_disable` removes it. The `Config` states `defaultIntervalSeconds` (default 1800), `maxIntervalSeconds` (default 86400), and `heartbeatPath` (default `HEARTBEAT.md`); the path must be a workspace-relative path without parent segments or a Windows drive, and the default interval must not exceed the cap. Misconfiguration rejects the plugin at load.

| Tool | Meaning |
|---|---|
| `heartbeat_enable` | Create the recurring reminder for the calling Session with the deployment default or a supplied `interval_seconds`; a second patrol answers `heartbeat_already_enabled`. |
| `heartbeat_disable` | Delete the calling Session's heartbeat reminders; already delivered heartbeats are not retracted. |

Delivery reuses the Schedule service: the reminder enters the original Session as an ordinary recurring Schedule delivery, and Schedule owns persistence, restart recovery, and timing.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin is a plain `apply(ctx, config)` tool registration over the host tool registry; it owns no service and no storage. Patrol identity is textual: a stored task belongs to the patrol when its prompt starts with `[HEARTBEAT]`, the same prefix `heartbeat_enable` writes, so identity survives Session-log replay without a new event kind. `heartbeat_enable` rejects non-integer intervals with `invalid_rule` and intervals outside the 60-second floor or the deployment cap with `frequency_too_high`; Schedule input failures map to their codes, and storage failures answer `internal_error` with fixed text that withholds internals. `heartbeat_disable` deletes every heartbeat-marked task of the calling Session and reports only confirmed deletions.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Tool registration](src/index.ts) defines both tools, the config validation, and the reminder prompt.
- [Schedule subsystem](../../../docs/subsystems/schedule.md) describes the delivery the patrol rides.

<a id="model-experience"></a>
## Model Experience

### Tool schemas on root Agents

#### What the model sees

The [generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-heartbeat) contains the descriptions and schemas for `heartbeat_enable` and `heartbeat_disable`, registered on the host tool registry while the plugin is loaded.

#### Token effect

The two schemas contribute fixed request-context tokens while available. A disabled patrol adds no schema tokens.

#### KV Cache effect

Unchanged schemas preserve their repeated prefix. Loading or unloading the plugin changes request-prefix tokens; provider cache availability remains outside this package.

### Tool results after management calls

#### What the model sees

Enable returns `{ id, interval_seconds, path }` on success, or `{ code, message }` with `invalid_rule`, `frequency_too_high`, or `heartbeat_already_enabled`. Disable returns `{ deleted, ids }`, or `heartbeat_not_enabled` when the Session has no patrol. Failures that are not safe to expose answer `internal_error`.

#### Token effect

Result tokens depend on the returned fields; they are a single JSON line either way.

#### KV Cache effect

Tool results append to conversation history and do not rewrite earlier model-visible messages.

### Heartbeat deliveries in the original Session

#### What the model sees

Each due heartbeat enters as a user-role Schedule recurring-batch delivery whose `reminder_prompt` carries the whole patrol semantic: read the configured heartbeat file, act on its pending items, update the file after handling them, and reply exactly `HEARTBEAT_OK` when the file is missing or lists nothing pending.

#### Token effect

Each delivery adds the fixed Schedule batch framing plus the fixed heartbeat prompt; the prompt does not include file contents, which enter through the model's own file-tool reads.

#### KV Cache effect

Deliveries append to the original Session's history and preserve earlier message content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The patrol runs only while the Host is running; Schedule's delivery guarantees and restart recovery apply unchanged, including possible redelivery after a crash between flush and acknowledgment.
- The heartbeat file is read by the model through its own file tools; nothing in this package watches the file, enforces its format, or creates it.
- Patrol identity is the stored prompt prefix, so editing the reminder text with `schedule_update` renames the patrol out of `heartbeat_disable`'s reach, and a user-created reminder that begins with `[HEARTBEAT]` counts as the patrol.
- One patrol per Session is enforced per enable call; two concurrent enables inside one turn can both observe no existing task.
- `heartbeat_disable` does not retract a delivery that is already in flight.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

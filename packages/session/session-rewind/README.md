---
description: "Capture the pre-turn content of every path a file tool is about to change, content-addressed under the Session's temporary directory, and restore one turn's pre-turn state through the workspace_rewind tool or the sessionRewind service; coverage rules, bounds, and record lifetime."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-rewind

English | [中文](README.zh.md)

## Summary

Every top-level turn gets a restore point for the files its file tools change. Before a `write`, `edit`, or mutating `str_replace_editor` call first changes a path in a turn, the plugin copies the file's content into the Session's temporary directory, named by its SHA-1, or records that the path did not exist. The `workspace_rewind` tool and the `sessionRewind` service reproduce one turn's pre-turn state: copies are written back, paths absent before the turn are deleted, and oversized captures are skipped and reported. Nothing is appended to the Session log; a restore is its own tool call and result.

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

The shipped Web bundle mounts this plugin. Mount it in any composition that has the `tools` capability:

```yaml
- name: '@deepseek-ai/dsh-session-rewind'
  config:
    maxPaths: 200
```

| Field | Default | Meaning |
|---|---|---|
| `maxFileBytes` | `2097152` | Inclusive byte cap on one stored pre-turn copy; a larger file gets no copy and a restore skips it with reason `oversized` |
| `maxPaths` | `200` | Maximum paths one turn's checkpoint captures; a turn that would exceed the bound fails the capture, which fails the tool call that caused it |

Every Session with a working directory and no subagent origin is recorded; subagent Sessions are not, and neither are delegated child scopes. Captures cover only the paths those three file tools name — edits made through shell commands are never captured and never restored. A restore reproduces the state before the turn as the capture observed it: a path the user edited before the turn's first file-tool call restores to the state at that call, not to an earlier user edit. Each restore point lists, restores, or deletes paths by their `display` order — the same relative-or-absolute label rule the workspace-changes summaries use.

The plugin fails load on a non-positive or non-integer bound. Capture and restore run inside the working directory the Session opened; `workspace_rewind` answers `unavailable` when a call carries no session context and `unknown_turn` when no record exists for that turn. Records live only as long as their Session in this Host process, and at most the last 64 turns of a Session keep their records.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One `SessionRewindStore` per Session serializes its captures and restores through a promise chain. `turn/start` closes the previous turn's state and opens a fresh one; a turn still capturing when the next turn starts keeps its own state, so an interrupted turn keeps its restore point. The store creates its scratch directory (`dsh-session-rewind-*`) lazily under the OS temporary directory at the first capture, since only Session-level state is known at mount time. Every `tools/pre-execute` extracts the path the call is about to change (`write` and `edit` from their file arguments, `str_replace_editor` from `path`), canonicalizes it through the realpath chain so one path captured twice under two names stores once, and — for the first occurrence per turn — opens the file, sizes it against `maxFileBytes`, and copies the bytes into the scratch directory under the SHA-1 of their content, created with the write-exclusive flag so identical content is stored once. The listener awaits the store's queue before returning, so no mutation precedes its capture.

`restore(turn)` looks the turn up in the closed records or the current state, then applies captures in `display` order: an `absent` capture unlinks the path (a failing unlink of an already-gone path is success, any other failure skips with reason `unwritable`), a `file` capture creates the parent directory and copies the stored bytes back, and an `oversized` capture is skipped and reported. A write-back failure skips the path with `unwritable` and logs a warning; the restore continues. An aborted restore signal stops the chain at the next capture boundary.

Records are kept in a bounded ring: closing a turn moves its captures into the closed map, and closing the 65th evicts the oldest. Session disposal and plugin disposal abort the chain, forget the stores, and remove each store's scratch directory. A Host restart therefore loses every record, and a conversation reopened after one has no restore points for its earlier turns.

**Runtime invariant:** No companion is published. Event listeners are effect-owned and the store owns the captures for its Session's lifetime; no independent observation can diverge from them.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Tool schema catalog](../../../docs/tool-catalog.md#deepseek-aidsh-session-rewind) — the generated `workspace_rewind` schema the model receives.
- [Workspace changes](../../deliverables/workspace-changes/README.md) — the sibling recorder whose per-turn changed-file summaries are shown to the user while rewind restores the workspace for the model.
- [Tool execution pipeline](../../../docs/tool-execution-pipeline.md) — where `tools/pre-execute` sits relative to guards and execution.

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`workspace_rewind` schema](../../../docs/tool-catalog.md#deepseek-aidsh-session-rewind) in the root context: one required `turn` number. The description states the overwrite-first semantics — a covered path is written back even if later turns edited it again — the shell-command exclusion, and the confirm-with-the-user expectation for rewinding a past turn.

#### Token effect

Fixed schema cost on every request while the plugin is active; the bounds and scratch location are never sent to the model.

#### KV Cache effect

Prefix-stable while the visible tool definition and order are unchanged; registration lifecycle may invalidate reuse from the first changed schema token.

### Results

#### What the model sees

An `ok` restore returns one line listing the restored, deleted, and skipped paths; a turn without a record returns an actionable `unknown_turn` line; a call without session context returns an `unavailable` line. Skips are reported per path with the reason `oversized` or `unwritable` — a restore never fails the call because one path could not be written back.

#### Token effect

Proportional to the path counts one restore reports; skipped paths add their reason phrase.

#### KV Cache effect

None — results enter only the response turn, not the request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Records live only as long as their Session in this Host process, and only the last 64 turns of a Session keep theirs; a Host restart loses every restore point. This is the decided behavior: a restore the Host can no longer serve is not offered.
- Only `write`, `edit`, and mutating `str_replace_editor` paths are captured; shell commands, MCP tools, and any other mutation are invisible to a restore.
- A restore reproduces what the capture observed, which is the state at the turn's first file-tool call — a user edit before that call is not part of the restore point.
- A path restored to its pre-turn content erases later turns' edits to it; the tool description asks the model to confirm with the user before rewinding a past turn.
- An `oversized` path is neither copied nor restored; its content after the turn survives a rewind.
- Captures and restores run on the Host with the Session's working-directory authority; a deployment that must not keep file contents on the Host composes this plugin out.
- Windows paths keep native separators internally; the reported paths use the same `display` label rule as the workspace-changes summaries.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

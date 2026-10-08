---
description: "The model-facing worktree_track and pull_request_track tools for DeepSeek Harness agent sessions: per-session git-artifact records in a durable storage domain, upsert by natural key, and per-call list results, for users and maintainers choosing, configuring, or debugging the tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-git-track

English | [中文](README.zh.md)

## Summary

`dsh-tool-git-track` lets the agent record the git artifacts its work produces: the worktrees it creates and the pull requests it opens. Each `worktree_track` or `pull_request_track` call upserts one record into the package's durable storage domain, and the records survive across turns, context compaction, and reopened sessions — so the agent can still say which checkout and which pull request belong to this session after the earlier conversation is gone. Recording is bookkeeping only: the tools never run git and never contact a forge.

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

Use this package when agents create git worktrees (parallel task checkouts, review branches) or open pull requests, and those facts must stay attached to the session that produced them. Mounting the plugin is the only setup; the agent records each fact as it happens.

### When to choose it

Choose it when one agent session owns its artifacts and self-reported records are enough. Avoid it when you need verified git or forge state: a record asserts what the model said, not what the repository or platform confirms. The tools need an agent session to exist at all; automation-only surfaces that never run an agent cannot use them.

### Minimal configuration

The plugin takes no configuration. Compose it as a plain plugin row:

```yaml
- name: '@deepseek-ai/dsh-tool-git-track'
```

### What each call does

`worktree_track` records one worktree: an absolute `path`, plus optional `branch` and `base`. `pull_request_track` records one pull request: a canonical `url`, plus optional `number`, `title`, and `branch`. Re-recording the same path or URL replaces the earlier record in place, so a changed branch or retitled pull request updates without moving the list order. A successful call returns the current record list for its domain — `Now tracking 2 worktree(s); latest: <path>.` — and the logged tool call and result are the record's trace in the session log. Calls fail visibly when a required value is blank, a worktree path is relative, or a pull-request number is not a positive integer.

### Single owner

The records belong to the one agent session that created them — subagents and other agents each keep their own records, and there is no way to share them between agents. A call from outside an agent session is rejected, so the agent learns the record failed instead of silently writing nowhere.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tools and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The tools are built on three commitments:

- **Durable storage-domain records.** Each call upserts one record into the `session_git_track` storage domain, so durability and reopen reconstruction come from the shared `storageDomain` facility rather than a service of this package.
- **Upsert by natural key.** The worktree `path` and the pull-request `url` are the keys within a session; a re-record replaces the stored record in place and keeps first-record order, so re-recording is the only update and removal is not modeled.
- **Bookkeeping, not execution.** The tools validate record shape and never probe the filesystem or the network; recorded facts are the model's statements, kept equal to what it believes by schema-level rejection of unknown keys and `execute`-level rejection of blank or non-canonical values.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `session_git_track` domain declaration and the two tool registrations |
| [`src/types.ts`](src/types.ts) | The one home of the `TrackedWorktree` and `TrackedPullRequest` record types |

### Export shape

The plugin is a function/namespace plugin: it exports `name` / `inject` / `apply` and no default export. A stray `export default` would make the Loader's `unwrapExports` collapse the module and drop `inject` (see [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

### Storage domain

The package declares the `session_git_track` domain with one table per record domain and opens it when the plugin loads, so a broken medium or a domain-name conflict fails at boot. Each record's key is the owning session id, the key separator, and the record identity (`path` or `url`); the table schemas revalidate every stored record at the durable read boundary when the domain opens. See [`@deepseek-ai/dsh-storage-domain`](../../storage/storage-domain/README.md) for the facility semantics and [src/index.ts](src/index.ts) for the declaration.

### Call mechanics

Each call validates the record against the schema, rejects incoherent input, upserts it into the calling session's table, and returns the session's current list. See [src/index.ts](src/index.ts) for the exact validation and upsert steps.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the git subsystem to the generated catalogs.

- [Git tracking subsystem](../../../docs/subsystems/git.md) — the `TrackedWorktree` and `TrackedPullRequest` record types and the storage layout.
- [git group map](../README.md) — the sibling group page and its package table.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-git-track) — the two tool schemas the model receives.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`worktree_track` and `pull_request_track` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-git-track): `worktree_track` takes a required absolute `path` string with optional `branch` and `base` strings; `pull_request_track` takes a required `url` string with optional `number` (number), `title`, and `branch`. The descriptions state that recording is bookkeeping only and that re-recording a key replaces the earlier record.

#### Token effect

Fixed schema cost on every request where the tools are visible; the descriptions and schemas are stable across deployments because the package has no configuration.

#### KV Cache effect

Prefix-stable while the definitions and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from these schemas.

### Tool-call history and result

#### What the model sees

Each assistant tool call retains its record in the arguments. Success returns the current domain list plus exactly `Now tracking <n> worktree(s); latest: <path>.` or `Now tracking <n> pull request(s); latest: <url>.` Stable failures are ``Error: invalid worktree `path`: must be a non-empty string``, ``Error: invalid worktree `path`: must be an absolute path``, ``Error: invalid pull request `url`: must be a non-empty string``, ``Error: invalid pull request `number`: must be a positive integer``, `Error: worktree_track requires an owning agent session`, and `Error: pull_request_track requires an owning agent session`. The stored records are the tools' private state; the logged tool result is their only trace in the session log.

#### Token effect

Token growth scales with every record the model submits, and those call arguments remain until compaction. The results themselves are small and grow linearly with the number of records in the session.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tools are a poor fit. They are current package constraints, not a task backlog.

- **Self-reported records only** — a record asserts what the model stated; the tools never verify that a worktree directory exists or that a pull request is open, and they do not reconcile against git or forge state.
- **No removal and no read-back tool** — re-recording a key replaces its record, but there is no `forget` operation and no tool that only lists records; the current lists return from each track call.
- **Single-owner scope only** — the records belong to the one calling agent session; shared or cross-session scopes are a deliberate cut, and a non-agent caller is rejected.
- **No cleanup on session end** — deleting or archiving a session does not remove its rows from the `session_git_track` domain; there is no retention pass.
- **Generic UI card only** — the pending call cards are generic (`worktree_track` adds the worktree path as a followable location); no dedicated Web card derives from the stored records.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above and the package code.

#### No ./invariant companion

The package publishes no `./invariant` entry: the two tools are the only writers of their two tables, and every write passes the record validation at that single write path, so no independently observable relation can diverge.

</details>

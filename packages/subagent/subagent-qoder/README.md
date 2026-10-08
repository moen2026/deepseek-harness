---
description: "The one-shot Qoder CLI subagent provider for users and maintainers choosing a product backend, installing a Profile bundle, or configuring an unattended Qoder delegation."
kind: "package-bundle"
---

# @deepseek-ai/dsh-subagent-qoder

English | [中文](README.zh.md)

## Summary

Install `@deepseek-ai/dsh-subagent-qoder` into a Profile when delegated work should run in a genuine, unattended Qoder session in the parent Session's workspace. Each delegation drives the pinned package-local Qoder CLI in headless print mode for one self-contained text task and returns only its final answer or a safe failure diagnostic. Native Qoder configuration and authentication remain authoritative, while `permissionMode` selects the non-interactive permission behavior. The Bundle resolves its CLI from a pinned package dependency, but it exposes no model capability until a delegation tool is configured.

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

Mount this provider when a delegation should run as a real Qoder session in the parent's workspace. The common path is explicit: install the Bundle into a Profile, optionally configure the provider row, and expose it to the model through a delegation tool row.

### Installing the Bundle

Install the package into the target Profile, then restart that Profile. The installation brings the pinned `@qoder-ai/qodercli` dependency into the Profile's closure; the declared patch layer registers only the dormant provider and starts no Qoder process.

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-qoder
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-qoder
dsh --profile <name>
```

Removing the package withdraws the provider and its private runtime closure on the next Profile start. Installation controls Host availability, not model permission: the model can only reach the provider through a delegation tool row you compose.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `qoder` | Non-empty registry name on `ctx.subagents`; each mounted instance needs a unique value |
| `model` | native Qoder settings | Optional non-empty model name fixed for every run from this provider instance; omission sends no `--model` override |
| `maxTurns` | native Qoder settings | Optional positive-integer turn cap applied to every run from this provider instance |
| `allowedTools` | native Qoder settings | Optional tool names pre-approved for the unattended run, forwarded as one `--allowed-tools` list |
| `disallowedTools` | native Qoder settings | Optional tool names refused for the unattended run, forwarded as one `--disallowed-tools` list |
| `env` | `{}` | Explicit child environment layered over the credential-scrubbed parent environment |
| `permissionMode` | `default` | Native non-interactive permission behavior fixed for every run from this provider instance |
| `disposeGraceMs` | `3000` | Grace between the shared managed-range owner's termination tiers |

| `permissionMode` value | CLI flag | Native behavior |
|---|---|---|
| `default` | none | Headless mode auto-denies interactive approval prompts; a task that must write needs its tool names listed in `allowedTools` |
| `bypass` | `--yolo` | Skips permission checks; this value must be selected explicitly |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-subagent-qoder) is the exhaustive source for every accepted field and its JSDoc. A configured `model` passes unchanged on each run; omission leaves native model selection in force. The provider does not discover models, rewrite aliases, or set a fallback. Credential-shaped ambient variables are removed before the explicit `env` overlay, so the personal access token intended for the child (`QODER_PERSONAL_ACCESS_TOKEN`) must be supplied there.

### Exposing the tool

Each delegation tool row names one provider and needs its own `toolName`, so the model sees static tools rather than a dynamic provider selector. No shipped Agent Preset exposes `qoder` yet; add a row like the following to a copied preset or your own composition to expose `subagent_qoder`.

```yaml
- id: jobs
  name: '@deepseek-ai/dsh-jobs-local'
- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'
- id: tool-subagent-qoder
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: qoder
    toolName: subagent_qoder
    backgroundMode: one-shot
    maxDepth: provider-managed
```

The `one-shot` policy keeps omitted or `false` `run_in_background` calls in the foreground, while explicit `true` returns a parent-owned Job id for `job_output` or `job_kill`; the base host and full presets already provide the generic Job registry and controls.

### What you get

A foreground call gives the model the selected final Qoder answer, or an error with the stop reason and optional safe diagnostic for a failed run. A background call first returns a Job id; the generic job controls later deliver a completion notice and expose the same final answer or failed status through `job_output`. Qoder intermediate turns, tool activity, usage, raw stderr, and the raw print-mode JSON never enter the parent session.

### Failure and recovery

A task that is not composed of text blocks fails before any process starts, and a parent Session without a working directory fails the start with a fixed message. A missing or damaged pinned dependency fails at `spawn` with a safe `unknown` category; there is no host-CLI fallback. A captured run that yields no usable reply object fails as `invalid-result` after a clean exit and as `process` after a non-zero exit or signal, while a well-formed product error reply, including an unauthenticated session, fails as `product-error`. Every diagnostic names the product, stage, category, and any observed exit code or signal without copying product prose or stderr; raw child stderr stays on Host stderr. A cancelled run settles as `aborted`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the provider drives the pinned Qoder CLI in headless print mode and where the observable behavior comes from; the full contract lives in [Use this package](#use-this-package).

### Design concept

- **One pinned package-local CLI per deployment.** The command resolves `@qoder-ai/qodercli` from the package's own dependency closure through its manifest `bin` entry, and never from the host `PATH`, so an installed IDE launcher with a similar name can never be selected.
- **One fresh process per run.** Every run spawns a fresh headless print-mode process and executes exactly one task; there is no continuation, resume, or pooling.
- **The task travels on stdin.** The prompt is delivered as stdin data, so no task text enters the command line or a process listing.
- **Native configuration and authentication are authoritative.** Login state, model selection, and every other product setting stay native; the provider overrides only the optional model, turn cap, tool lists, the permission behavior, and the explicit environment overlay.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, provider registration |
| [`src/run.ts`](src/run.ts) | The run lifecycle, spawn, reply settlement, and diagnostics |
| [`src/cli.ts`](src/cli.ts) | Pinned command resolution, headless argument building, task normalization, and JSON reply parsing |
| [`cordis.patch.yml`](cordis.patch.yml) | The Profile patch layer that registers the dormant provider |

### Run flow

A start accepts only a non-empty sequence of text blocks and derives the child cwd from the parent session. It spawns the pinned command — `--print --output-format json` plus any configured model, turn cap, tool lists, and bypass flag — through the subprocess seam with the task on stdin, collects stdout under a 16 MiB cap, and parses the outermost JSON object in the capture; the boundary scan tolerates the one-time setup notices the CLI may interleave on a first Windows run. The parsed reply settles as `completed` with the answer text, as `max-tokens` when the product stopped at its token ceiling, or as a failure: `product-error` for a well-formed `is_error` reply, `invalid-result` for a clean exit without a usable answer, and `process` for a non-zero exit, a signal, or a rejected process outcome. Cancellation terminates the child and settles `aborted`; disposal terminates and waits for whole-range quiescence under the shared grace.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from this provider to the seam it plugs into and the sibling product providers.

- [Subagent subsystem](../../../docs/subsystems/subagent.md) — the service contract, provider contract, and terminal result semantics.
- [dsh-subagent seam](../subagent/README.md) — the registry and start API this provider registers on.
- [Codex subagent provider](../subagent-codex/README.md) — the sibling product backend over the official app-server protocol.
- [Claude Code subagent provider](../subagent-claude-code/README.md) — the sibling product backend over the official Agent SDK.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-subagent-qoder) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### Child request

#### What the model sees

The Qoder child receives the standalone text blocks as one headless print-mode task in a fresh process. Its workspace is the parent Session cwd; the selected Provider instance fixes any configured model, turn cap, tool lists, environment, and permission behavior, while authentication and every other product setting come from native Qoder configuration and the explicit environment. The executable is the pinned package-local dependency version.

#### Token effect

The child pays for an independent Qoder context and turn. Child tokens do not enter the parent's context.

#### KV Cache effect

Independent of the parent request cache. Reuse depends only on Qoder's own provider, model, instructions, tools, and print-mode request.

### Parent scheduling and results, indirectly

#### What the model sees

Through `dsh-tool-subagent`, a foreground call gives the parent the selected final Qoder answer or an error containing the stop reason and optional safe diagnostic for a non-completed result. The diagnostic can distinguish a coarse stage and category plus any observed exit code or signal without copying product prose or stderr. A background call first returns a Job id; the generic job controls later deliver a completion notice, expose the same final answer or failed status detail through `job_output`, and let `job_kill` request cancellation. Qoder intermediate turns, tool activity, raw stderr, usage, product ids, and protocol payloads are not copied into the parent Session.

#### Token effect

Foreground input grows by the retained final answer or error. Background input also includes the start acknowledgement, completion notice, and any `job_output`, `job_kill`, or later status results; child tokens still do not enter the parent context. This provider adds no parent tool schema by itself.

#### KV Cache effect

Append-only: foreground adds one result after the reusable parent prefix, while background appends the Job acknowledgement, notice, and later control or collection results. Background scheduling can add a notice-driven turn, but none of these messages rewrites the earlier prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when this provider is a poor fit or needs special operational care. They are current package constraints, not a general Qoder comparison or a task backlog.

- **One fresh process per run** — there is no continuation, resume, pooling, progress stream, or product-session persistence. The print-mode reply carries a `session_id` that a future continuation could consume, but nothing reads it today.
- **Static instance selection** — Profile rows fix provider names, optional models, and tool bindings; calls cannot choose or change either a provider or model dynamically, and every exposed tool needs a unique `toolName`.
- **Authentication remains native** — the Bundle supplies the CLI but does not create an account, log in, or refresh a token; an unauthenticated child surfaces as a `product-error`, and the token intended for the child must arrive through the explicit `env` overlay because credential-shaped ambient variables are scrubbed.
- **Headless approvals are auto-denied** — print mode refuses interactive approval prompts, so a task that must write needs its tool names pre-approved through `allowedTools`, or the explicitly selected `bypass` mode.
- **First Windows runs may mix setup notices into stdout** — the one-time Git Bash setup notice precedes the reply object; the boundary scan tolerates it, and it reflects a product setup step rather than provider state.
- **Compatibility is pinned by development evidence** — the verified baseline is `@qoder-ai/qodercli@1.1.65`; upgrading requires re-recording the CLI reply fixtures and rerunning the keyless parsing tests.
- **Assistant payload is final text only** — a failed run may additionally expose the separate safe diagnostic; intermediate turns, tool traffic, usage, raw stderr, and the raw print-mode JSON remain outside the parent Session.
- **No optional shared capabilities** — `agentOptions`, output schemas, child personas, tool filtering, and harness depth enforcement are rejected by the shared service for this provider.
- **No wall-clock timeout or side-effect rollback** — the caller cancels long work, and files or external systems changed before cancellation are not restored.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

- **Payload size disclosure** — the pinned dependency unpacks to about 68 MB across 30 files; these are disclosure numbers, not installation thresholds.
- **Version-pinned reply schema** — the reply fixtures were recorded from `@qoder-ai/qodercli@1.1.65` print-mode output; upstream reply changes beyond the bounded key margin require re-recording them.
- **Loader end-to-end coverage is deferred** — the parsing layer is covered by keyless fixtures and the wiring by unit tests against the real services; a Profile loader end-to-end run has not been added yet.

</details>

**Runtime invariant:** No companion is published. Lifecycle pairing belongs to the shared subagent service, and managed-range ownership belongs to the subprocess service.

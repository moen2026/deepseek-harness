---
title: "@deepseek-ai/dsh-output-style"
description: "Deployment-wide output style section for the DeepSeek Harness"
kind: "package-reference"
---

# @deepseek-ai/dsh-output-style

English | [中文](README.zh.md)

## Summary

`dsh-output-style` selects how the agent's answers read: a deployment or composition mounts this row to register the `deployment:output-style` section. Built-in styles add no prose (default), ask for brief educational context (explanatory), or hand small implementation steps back to the user (learning); a custom style renders the row's own prose. An agent scope can shadow the global text, and changing the row's config reloads it, so a deployment can expose the style as a user-editable setting. The persona says who the agent is; this row says how answers read.

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

Mount this row in the deployment composition to select one output style for every session, or inside an agent preset to give one agent its own. The row only needs the prompt registry, so it mounts wherever `dsh-system-prompt` is loaded.

### Configuration

```yaml
- name: '@deepseek-ai/dsh-output-style'
  config:
    style: explanatory
```

| Field | Default | Meaning |
|---|---|---|
| `style` | `default` | `default` contributes no prose; `explanatory` adds brief educational context; `learning` hands small implementation steps to the user; `custom` renders `customText` |
| `customText` | `''` | Custom style prose, required and non-empty when `style` is `custom`; a strict `{{variable}}` template |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-output-style) is the exhaustive source for every accepted field and its JSDoc.

### Output style behavior

The row registers one section named `deployment:output-style` for the mounting scope. An agent scope shadows the global text the same way `dsh-persona` shadows the persona row, and disposing the mounting fiber restores it. `style: custom` with empty `customText` fails at load — a style with no prose is a misconfiguration, not a silent no-op. Built-in prose is fixed; `customText` interpolates prompt variables strictly, like any other section.

### When to use it

Use this row when users or deployments must choose how answers read without composing prose themselves. Deployment-wide tone guidance that is not a selectable style belongs in the persona rows or agent instructions instead.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### How the row registers

The row registers one scoped section using the registry's shared slot name and the `DEPLOYMENT_OUTPUT_STYLE` order. The registry owns ordering, interpolation, shadowing, and disposal; the row resolves the built-in or custom text once at registration.

### The deployment slot

Unlike the persona rows, this slot has no registry-owned default: the row owns `deployment:output-style` wherever it mounts. A global mount carries the deployment's selection; a scoped mount shadows it for that agent; two mounts in one scope collide on the section name and fail loud.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, built-in style prose, output-style section registration |
| — | No runtime invariant companion is published; this row owns no event stream or mutable runtime data — it registers one prompt section and the prompt registry owns ordering, interpolation, shadowing, and disposal. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough; they move from the preset composition to the prompt registry this row feeds.

- [agent-presets package](../agent-preset-registry/README.md) — the preset composition this row mounts into.
- [System prompt subsystem](../../../docs/subsystems/system-prompt.md) — sections, assembly, and how scoped sections shadow globals.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-output-style) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### The output-style section

#### What the model sees

The `deployment:output-style` section at order `10150` carries the selected style, after first-party guidance and local-surface sections and before the persona suffix. `default` registers empty text, which the renderer drops. `explanatory` and `learning` register their fixed prose; `custom` registers `customText` with prompt variables resolved at render.

#### Token effect

Fixed for a given style: the built-in or custom tokens on every request in the mounting scope, and none for `default`. A scoped mount adds its tokens only for that agent.

#### KV Cache effect

Late position: the section sits after tool guidance and local-surface sections, so a style change rewrites only the tail of the prompt and leaves earlier instructions cache-stable.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the row is a poor fit. They are current package constraints, not a task backlog.

- **One slot per scope** — the section name is unique within a scope; two output-style rows in the same scope collide and fail loud. Give a second agent its own scope, not a second global row.
- **No in-session switching** — the style changes when the row's config changes and its fiber reloads; no tool or event switches it mid-session.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

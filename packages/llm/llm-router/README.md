---
description: "The signal-driven model router for users and maintainers configuring explicit request routing plus an auto branch over context pressure and tool density."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-router

English | [中文](README.zh.md)

## Summary

Mount `@deepseek-ai/dsh-llm-router` to route model requests before dispatch: ordered rules match on the request's provider and model, and an optional auto branch picks a capability or economy target from live context pressure and tool density. Routing rewrites the resolved call configuration on the agent loop's `agent/request` waterfall, so the loop logs and dispatches the routed provider, model, and reasoning effort like any other request header. With no configuration every request passes through untouched; the plugin adds no tool, no prompt content, and no session event type.

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

Mount this plugin when model selection should follow configuration and live session signals instead of the caller's fixed provider/model — for example keeping chat steps on an economy route while tool-heavy or long-context steps move to a stronger model. It changes which route a request dispatches to, and that change is reconstructable from the request header the loop already logs.

### When to choose it

Choose it when one composition serves many sessions that should route differently as they grow, or when an operator wants one fenced place for model selection (rules) plus one adaptive fallback (auto branch). Skip it when a composition pins one model deliberately: with no `routes` and no `auto`, the plugin rewrites nothing.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-llm-router'
  config:
    routes:
      - when: { provider: deepseek, model: deepseek-chat }
        route: { provider: deepseek, model: deepseek-reasoner }
    auto:
      when: { provider: deepseek }
      capability: { provider: deepseek, model: deepseek-reasoner, reasoningEffort: high }
      economy: { provider: deepseek, model: deepseek-chat }
      contextPressureThreshold: 0.75
      toolDensityThreshold: 0.5
      toolDensityWindow: 12
```

Rules take precedence over the auto branch: the first rule whose `when` matches the request's provider and model wins, and a rule without `when` matches every request. When no rule matches and `auto` is configured and its own `when` matches, the branch compares both signals against their thresholds and applies `capability` when either is at or above its threshold, otherwise `economy`; an absent `economy` target leaves the request untouched below both thresholds. The branch's `when` and `capability` are required, so an auto branch cannot exist without a fence and a target. Thresholds default to 0.75 occupancy and 0.5 density over the 12 newest completed steps; every field is validated at load and unknown keys are rejected instead of silently merged.

### What you can observe

A routed request is its own log record: the loop records the configuration returned by the `agent/request` waterfall as the request header, so the routed provider, model, and reasoning effort are reconstructable from the session log exactly like an unrouted request, and no separate routing event exists. A target without `reasoningEffort` clears any inherited effort, because that effort was resolved for the original route; a target that names one applies it. When the rewritten configuration equals the resolved one, the plugin returns the original value instead of a copy.

The plugin also registers the `llmRouter` host projection: one slot per started step, oldest first, capped at 64 retained slots and flipped once when that step issues a tool call. The auto branch's density signal averages the newest completed slots inside its window; the slot of the step dispatching the request is still open and stays out of the average.

### Signals

Context pressure comes from the `contextPressure` state of `dsh-token-meter`: the latest provider-anchored prompt size, repriced with the surface's signed movement since that sample was taken, over the newest reported route capacity — the projected occupancy of the next request. A composition without the token meter, or one whose meter holds no complete sample, reads no pressure and the auto branch decides on density alone.

Tool density is the share of recent completed steps that issued at least one tool call. Before any completed step both signals read nothing, so a fresh session is not elevated and a configured `economy` target receives its requests.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design behind the router; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

Routing is a configuration rewrite on a documented extension point, not a new loop capability: the plugin listens on the `agent/request` waterfall and returns the routed `LlmCallConfig`, so the existing loop logs and dispatches it without routing-specific code. Explicit beats implicit: ordered rules decide everything they spell out, and the auto branch is fenced by its own `when` and by validated thresholds, so no request is rerouted without a configured target. The listener prepends, so it sees the fully resolved base configuration and its return value is the waterfall's final configuration.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The plugin: config validation, signal readers, waterfall listener, `llmRouter` projection |
| [`src/types.ts`](src/types.ts) | Browser-safe configuration, match, target, and host-state types |

### Routing flow

A request reaches the waterfall; the listener awaits `next()` to obtain the resolved call configuration, then walks the configured rules in order. The first match returns its target; with no configured or matching auto branch the request returns untouched. Otherwise the branch reads both signals through the projection registry — only on this path, so a rule-only deployment never touches the projection fold — and returns the capability target when either signal is at or above its threshold, otherwise the economy target. The listener drops the inherited `reasoningEffort`, applies the target's, and returns the rewritten configuration, or the original value when nothing changed.

### Waterfall composition

The plugin is one listener in the `agent/request` waterfall. Because it prepends, the remaining listeners prepare the base request inside its `next()` and its return value is what the loop dispatches; an inner listener that rewrites the request still sees routing applied afterwards, never before.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the routing plugin to the services whose state and extension points it builds on.

- [Agent core subsystem](../../../docs/subsystems/core.md) — the `agent/request` waterfall and the resolved model-call configuration this plugin rewrites.
- [Token meter subsystem](../../../docs/subsystems/token-meter.md) — the `contextPressure` host state behind the pressure signal.
- [Session projection subsystem](../../../docs/subsystems/session-projection.md) — the fold registry that serves `llmRouter` and `contextPressure`.
- [dsh-llm service](../llm/README.md) — the provider-neutral service that dispatches the routed request.
- [LLM streaming subsystem](../../../docs/subsystems/llm-streaming.md) — the request header vocabulary the routed configuration is logged in.

-----

<a id="model-experience"></a>
## Model Experience

### Request routing

#### What the model sees

The routed `provider`, `model`, and `reasoningEffort` are the route the model receives; the messages, system prompt, and tools of the request are unchanged. No rule name, signal reading, or routing metadata reaches any model input — a routed request is a normal request to the target route.

#### Token effect

Routing changes which route prices and bills the request; token counts follow the target route's adapter. An elevated step moves to the `capability` route a deployment pays more for, and the `economy` route caps steady chat traffic — the capability branch trades cost for capacity exactly when the session shows pressure or heavy tool use.

#### KV Cache effect

Changing the routed provider or model moves the request prefix to a different cache domain, so the target route starts without the previous route's cache reuse; a stable route keeps the prefix eligible under its provider's rules. Deliberately clearing or replacing the reasoning effort is the target provider's cache concern.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define where the router stops and future work begins. They are current package constraints, not a general routing comparison or a task backlog.

- **Rules match on provider and model only** — purpose, tool density, or context pressure cannot select an explicit rule; those signals reach only the auto branch's two thresholds.
- **Signal readings are not logged** — the routed configuration is reconstructable from the session log, but the pressure and density values that chose it are live reads; a replay reproduces the request, not the decision input.
- **Agent steps are the routing boundary** — direct `ctx.llm.stream()` consumers bypass the waterfall and dispatch their configured route.
- **The density window caps at the retained slots** — the projection keeps 64 completed-step slots, so a configured window above 64 is rejected at load rather than reading slots the fold no longer keeps.
- **The auto branch reroutes fresh sessions when `economy` is configured** — before any completed step both signals read nothing and the branch is not elevated, so a fresh session's requests go to the economy target until a signal crosses a threshold.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is non-authoritative working context: notes for maintainers and open questions. Shipped behavior and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

- The routed configuration is recorded through the loop's normal request-header logging rather than a routing event, so a future need to audit the decision input itself (not only the outcome) would require recording signal samples separately.
- The density window's ceiling is deliberately coupled to the projection's retained slots: raising one without the other would let a configured window read slots the fold already dropped.

</details>

**Runtime invariant:** No companion is published. The routing decision reads the `llmRouter` fold and the token meter's `contextPressure` state at request time, and those reads are the fold's only consumers; no independent observation of the same relationship exists that could diverge, so there is nothing for a runtime invariant to compare.

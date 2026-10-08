# Agent Note: Signal-driven model routing

Status: implemented

English | [中文](2026-09-28-signal-driven-model-routing.zh.md)

## Problem

A composition dispatches every model request to the provider and model its caller resolved, so one fixed route serves chat steps, tool-heavy steps, and long-context steps alike. A session that grows into heavy tool use or high context occupancy would benefit from a stronger model exactly then, but nothing could raise the route per request without the user switching models by hand. Qoder parity (roadmap D12) requires model routing driven by task signals.

## Decision

Routing ships as the new package [dsh-llm-router](../../../../packages/llm/llm-router) (`packages/llm/llm-router`): a listener on the `agent/request` waterfall that rewrites the resolved call configuration before the loop logs and dispatches it.

Four positions define the contract:

- **Explicit before implicit.** Ordered rules are consulted first; the first rule whose `when` matches the request's provider and model applies its target verbatim, and a rule without `when` matches every request. Only when no rule matches does the optional auto branch decide — fenced by its own required `when` and `capability` — elevating to `capability` when context pressure or tool density reaches its threshold, otherwise applying `economy`. A target without `reasoningEffort` clears the inherited effort, because that effort was resolved for the original route.
- **The routed configuration is the log record.** No routing event is introduced: the loop records the configuration returned by the waterfall as the request header, so the routed provider, model, and reasoning effort are reconstructable from the session log exactly like an unrouted request — model-visible ⟺ logged holds through the existing log.
- **Signals are projection reads.** Context pressure comes from the token meter's `contextPressure` host state; tool density comes from a new `llmRouter` host projection folding one slot per started step (oldest first, capped at 64, flipped once when the step issues a tool call). Both are read through the projection registry only on the auto-branch path, so rule-only deployments never touch the fold.
- **Off until configured.** With no `routes` and no `auto` no request is rewritten; the bundled full profile ships the plugin disabled until `DSH_LLM_ROUTER_ROUTES` or `DSH_LLM_ROUTER_AUTO` (JSON) provides configuration. Configuration is validated at load with manual unknown-key rejection, because a schemastery object schema merges unknown keys instead of refusing them.

## Alternatives considered

**Routing inside a wrapper around `ctx.llm.stream()`.** A router service wrapping the LLM service would bypass the agent step boundary: the request would not be the loop's logged request header, breaking log reconstruction for routed requests and the durable semantics compaction and retry rely on. The `agent/request` waterfall is the documented extension point for replacing the model-call configuration.

**A new session event for the routing decision.** The routed configuration already reaches the log through the request header, so a dedicated event would be redundant — and adding one would extend `SessionEventMap`, which is required-on-read by default and would need a format-version decision for no gain.

**Caller-site model selection.** Letting each caller condition its own provider/model would duplicate the signal logic per caller and leave no single place for an operator to fence model selection; the waterfall keeps one auditable decision point.

**Falling back to `capability` when `economy` is absent.** Below both thresholds an absent economy target keeps the request untouched. A fallback to capability would force an upgrade the deployment never asked for; omitting `economy` expresses "this deployment only has an opinion about elevation".

## Consequences

- `packages/llm` gains the `llm-router` package, listed in the group README, `docs/config-catalog.md`, `docs/module-graph.md`, and the `agent/request` consumer list in `docs/event-producer-consumer.md`.
- The full profile's patch enables routing only through the two environment variables; every request passes through untouched otherwise.
- The pressure and density readings that chose a route are live projection reads, not logged values: the routed request is reconstructable from the session log, while auditing the decision input itself would need separate signal recording (recorded in the package README's limitations).

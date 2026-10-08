/**
 * Public routing vocabulary for the LLM router.
 *
 * @module @deepseek-ai/dsh-llm-router/types
 */

import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'

/** A provider/model filter: absent fields match any value. */
export interface RouteMatch {
  /** Exact provider route to match; absent matches any provider. */
  provider?: string
  /** Exact provider-owned model id to match; absent matches any model. */
  model?: string
}

/** The concrete route one matching rule or auto branch selects. */
export interface RouteTarget {
  /** Registered provider route to dispatch the request to. */
  provider: string
  /** Provider-owned model id to dispatch the request to. */
  model: string
  /** Adapter-owned reasoning effort for the target model; absent keeps the target's provider default. */
  reasoningEffort?: ReasoningEffortId
}

/** One ordered routing rule; the first matching rule wins over the auto branch. */
export interface LlmRouteRule {
  /** Request route this rule matches; absent matches every request. */
  when?: RouteMatch
  /** Target applied when the rule matches. */
  route: RouteTarget
}

/** Signal-driven routing for requests that no explicit rule matches. */
export interface RouterAutoConfig {
  /** Request route the auto branch applies to; required so auto never leaks outside the deployment's declared region. */
  when: RouteMatch
  /** Target for elevated requests: context pressure or tool density at or above its threshold. */
  capability: RouteTarget
  /** Target for requests under both thresholds; absent keeps the request's own route. */
  economy?: RouteTarget
  /** Projected context occupancy ratio at or above which a request is elevated; defaults to 0.75. */
  contextPressureThreshold?: number
  /** Share of recent tool-issuing steps at or above which a request is elevated; defaults to 0.5. */
  toolDensityThreshold?: number
  /** Completed steps the tool-density signal averages over; defaults to 12, at most 64. */
  toolDensityWindow?: number
}

/** `llm-router` plugin configuration. */
export interface RouterConfig {
  /** Ordered explicit rules; the first matching rule wins over the auto branch. */
  routes?: LlmRouteRule[]
  /** Signal-driven routing for requests outside every rule. */
  auto?: RouterAutoConfig
}

/** Auto routing with every default materialized. */
export interface ResolvedAutoRoute {
  /** Request route the auto branch applies to. */
  when: RouteMatch
  /** Target for elevated requests. */
  capability: RouteTarget
  /** Target for requests under both thresholds; `undefined` keeps the request's own route. */
  economy: RouteTarget | undefined
  /** Materialized context-pressure threshold. */
  contextPressureThreshold: number
  /** Materialized tool-density threshold. */
  toolDensityThreshold: number
  /** Materialized tool-density window. */
  toolDensityWindow: number
}

/** Explicit rules plus the materialized auto branch a validated configuration resolves to. */
export interface ResolvedRouterConfig {
  /** Configured rules in order; a rule without `when` matches every request. */
  routes: readonly LlmRouteRule[]
  /** The auto branch with defaults materialized, or `undefined` when not configured. */
  auto: ResolvedAutoRoute | undefined
}

/** `llmRouter` projection state: retained per-step tool-call occupancy. */
export interface LlmRouterState {
  /** One slot per recorded step, oldest first; `true` once the step issued a tool call. */
  steps: boolean[]
}

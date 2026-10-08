/**
 * Signal-driven explicit model routing on the agent loop's request waterfall:
 * ordered rules first, then a tool-density and context-pressure auto branch.
 * Routing rewrites the resolved call configuration before dispatch; the loop
 * logs the routed configuration as the request header like any other.
 *
 * @module @deepseek-ai/dsh-llm-router
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import { callConfigEquals, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
// Type-only: activates the `agent/request` waterfall signature.
import type {} from '@deepseek-ai/dsh-agent'
// Type-only: activates the `ctx.sessionProjections` Context declaration.
import type {} from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionProjectionStateMap } from '@deepseek-ai/dsh-session-projection/types'
// Type-only: activates the `contextPressure` SessionProjectionStateMap entry.
import type {} from '@deepseek-ai/dsh-token-meter'
import type {
  LlmRouteRule,
  LlmRouterState,
  ResolvedAutoRoute,
  ResolvedRouterConfig,
  RouteMatch,
  RouteTarget,
  RouterConfig,
} from './types.ts'

export type {
  LlmRouteRule,
  LlmRouterState,
  ResolvedAutoRoute,
  ResolvedRouterConfig,
  RouteMatch,
  RouteTarget,
  RouterAutoConfig,
  RouterConfig,
} from './types.ts'

export const name = 'llm-router'
export const inject = ['sessionProjections']

/** Plugin configuration: explicit rules plus the signal-driven auto branch. */
export type Config = RouterConfig

/**
 * Retained per-step tool-call slots. A request sees at most this many completed
 * steps, so a configured density window is capped at the retained history
 * instead of reading slots the fold no longer keeps.
 */
const TOOL_DENSITY_CAP = 64

/** Default projected-occupancy ratio at or above which a request is elevated. */
const DEFAULT_CONTEXT_PRESSURE_THRESHOLD = 0.75
/** Default share of tool-issuing steps at or above which a request is elevated. */
const DEFAULT_TOOL_DENSITY_THRESHOLD = 0.5
/** Default number of completed steps the tool-density signal averages over. */
const DEFAULT_TOOL_DENSITY_WINDOW = 12

const ROUTER_KEYS: ReadonlySet<string> = new Set(['routes', 'auto'])
const RULE_KEYS: ReadonlySet<string> = new Set(['when', 'route'])
const MATCH_KEYS: ReadonlySet<string> = new Set(['provider', 'model'])
const TARGET_KEYS: ReadonlySet<string> = new Set(['provider', 'model', 'reasoningEffort'])
const AUTO_KEYS: ReadonlySet<string> = new Set([
  'when',
  'capability',
  'economy',
  'contextPressureThreshold',
  'toolDensityThreshold',
  'toolDensityWindow',
])

/**
 * Runtime schema for {@link Config}. Unknown keys survive schemastery object
 * merging, so {@link resolveRouterConfig} rejects them again at load.
 */
export const Config: z<Config> = z.object({
  routes: z.array(z.object({
    when: z.object({
      provider: z.string().min(1),
      model: z.string().min(1),
    }),
    route: z.object({
      provider: z.string().min(1).required(),
      model: z.string().min(1).required(),
      reasoningEffort: z.string().min(1) as z<ReturnType<typeof ReasoningEffortId>>,
    }),
  })),
  auto: z.object({
    when: z.object({
      provider: z.string().min(1),
      model: z.string().min(1),
    }),
    capability: z.object({
      provider: z.string().min(1).required(),
      model: z.string().min(1).required(),
      reasoningEffort: z.string().min(1) as z<ReturnType<typeof ReasoningEffortId>>,
    }).required(),
    economy: z.object({
      provider: z.string().min(1).required(),
      model: z.string().min(1).required(),
      reasoningEffort: z.string().min(1) as z<ReturnType<typeof ReasoningEffortId>>,
    }),
    contextPressureThreshold: z.number().min(0).max(1).default(DEFAULT_CONTEXT_PRESSURE_THRESHOLD),
    toolDensityThreshold: z.number().min(0).max(1).default(DEFAULT_TOOL_DENSITY_THRESHOLD),
    toolDensityWindow: z.number().step(1).min(1).max(TOOL_DENSITY_CAP).default(DEFAULT_TOOL_DENSITY_WINDOW),
  }),
})

/** Reject stale or misspelled keys before defaults can hide them. */
function validateKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${path}: unknown key "${key}"`)
  }
}

/** Require a plain object so nested validation reports the exact config path. */
function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object, got ${JSON.stringify(value)}`)
  }
  return value as Record<string, unknown>
}

/** Require a non-empty string. */
function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${path} must be a non-empty string, got ${JSON.stringify(value)}`)
  }
  return value
}

/** Materialize one optional ratio in the inclusive zero-to-one range. */
function resolveRatio(value: unknown, fallback: number, path: string): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${path} must be a number in [0, 1], got ${JSON.stringify(value)}`)
  }
  return value
}

/** Materialize the optional density window within the retained history. */
function resolveWindow(value: unknown, path: string): number {
  if (value === undefined) return DEFAULT_TOOL_DENSITY_WINDOW
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > TOOL_DENSITY_CAP) {
    throw new Error(`${path} must be an integer in [1, ${TOOL_DENSITY_CAP}], got ${JSON.stringify(value)}`)
  }
  return value
}

/** Validate one provider/model filter; absent fields stay absent. */
function resolveMatch(value: unknown, path: string): RouteMatch {
  const record = expectRecord(value, path)
  validateKeys(record, MATCH_KEYS, path)
  return {
    ...record.provider === undefined ? {} : { provider: expectString(record.provider, `${path}.provider`) },
    ...record.model === undefined ? {} : { model: expectString(record.model, `${path}.model`) },
  }
}

/** Validate one route target; the effort brand is applied at this parse point. */
function resolveTarget(value: unknown, path: string): RouteTarget {
  const record = expectRecord(value, path)
  validateKeys(record, TARGET_KEYS, path)
  return {
    provider: expectString(record.provider, `${path}.provider`),
    model: expectString(record.model, `${path}.model`),
    ...record.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(expectString(record.reasoningEffort, `${path}.reasoningEffort`)) },
  }
}

/** Validate the ordered rule list; a rule without `when` matches every request. */
function resolveRoutes(value: unknown, path: string): readonly LlmRouteRule[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${path} must be an array of routing rules, got ${JSON.stringify(value)}`)
  return value.map((rule: unknown, index) => {
    const rulePath = `${path}[${index}]`
    const record = expectRecord(rule, rulePath)
    validateKeys(record, RULE_KEYS, rulePath)
    return {
      ...record.when === undefined ? {} : { when: resolveMatch(record.when, `${rulePath}.when`) },
      route: resolveTarget(record.route, `${rulePath}.route`),
    }
  })
}

/** Validate the auto branch; `when` and `capability` are required to fence the branch. */
function resolveAuto(value: unknown, path: string): ResolvedAutoRoute | undefined {
  if (value === undefined) return undefined
  const record = expectRecord(value, path)
  validateKeys(record, AUTO_KEYS, path)
  return {
    when: resolveMatch(record.when, `${path}.when`),
    capability: resolveTarget(record.capability, `${path}.capability`),
    economy: record.economy === undefined ? undefined : resolveTarget(record.economy, `${path}.economy`),
    contextPressureThreshold: resolveRatio(
      record.contextPressureThreshold,
      DEFAULT_CONTEXT_PRESSURE_THRESHOLD,
      `${path}.contextPressureThreshold`,
    ),
    toolDensityThreshold: resolveRatio(
      record.toolDensityThreshold,
      DEFAULT_TOOL_DENSITY_THRESHOLD,
      `${path}.toolDensityThreshold`,
    ),
    toolDensityWindow: resolveWindow(record.toolDensityWindow, `${path}.toolDensityWindow`),
  }
}

/**
 * Validate one `llm-router` configuration and materialize its defaults.
 *
 * Key rejection is manual: a schemastery object schema merges unknown keys
 * instead of refusing them, so a stale field would otherwise load silently.
 * @param config - the configuration as loaded.
 * @param label - configuration path prefix for error messages.
 * @returns the rules in order plus the auto branch with defaults materialized.
 */
export function resolveRouterConfig(config: RouterConfig, label: string): ResolvedRouterConfig {
  const record = expectRecord(config, label)
  validateKeys(record, ROUTER_KEYS, label)
  return {
    routes: resolveRoutes(record.routes, `${label}.routes`),
    auto: resolveAuto(record.auto, `${label}.auto`),
  }
}

/**
 * Projected context occupancy of the next request: the meter's latest
 * provider-anchored sample repriced with the surface's signed movement since
 * it was taken, over the newest reported route capacity. A state holding the
 * anchor but no stamped sample reads as no drift, the conservative floor.
 * @param state - the `contextPressure` host state; absent without the token meter.
 * @returns the occupancy ratio, or `undefined` until the meter holds a complete sample.
 */
export function contextPressureRatio(
  state: SessionProjectionStateMap['contextPressure'] | undefined,
): number | undefined {
  if (state === undefined || state.contextWindow === undefined || state.pressureTokens === undefined) return undefined
  const sampled = state.sampledSurfaceTokens ?? state.surfaceTokens
  return Math.max(0, state.pressureTokens + state.surfaceTokens - sampled) / state.contextWindow
}

/**
 * Share of recent completed steps that issued at least one tool call.
 * @param state - the `llmRouter` host state; its newest slot is the current,
 *   still-open step (a request is dispatched inside that step) and is excluded.
 * @param window - how many completed steps to average over.
 * @returns the ratio, or `undefined` before any completed step.
 */
export function toolDensity(state: LlmRouterState | undefined, window: number): number | undefined {
  if (state === undefined) return undefined
  const completed = state.steps.slice(-(window + 1), -1)
  if (completed.length === 0) return undefined
  return completed.filter(Boolean).length / completed.length
}

const llmRouterStateSchema = zod.object({ steps: zod.array(zod.boolean()) })

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Per-step tool-call occupancy over the retained window. */
    llmRouter: LlmRouterState
  }
}

/**
 * The `llmRouter` fold: one slot per started step (oldest first, capped at
 * {@link TOOL_DENSITY_CAP}), flipped once when that step issues a tool call.
 */
export const llmRouterProjectionDefinition = {
  key: 'llmRouter',
  stateVersion: 1,
  stateSchema: llmRouterStateSchema,
  init: () => ({ steps: [] }),
  apply: (state, event) => {
    if (event.type === 'step/start') {
      const steps = state.steps.length >= TOOL_DENSITY_CAP
        ? [...state.steps.slice(1), false]
        : [...state.steps, false]
      return { steps }
    }
    if (event.type !== 'tool/call') return state
    if (state.steps.length === 0 || state.steps.at(-1) === true) return state
    const steps = [...state.steps]
    steps[steps.length - 1] = true
    return { steps }
  },
} satisfies ProjectionDefinition<'llmRouter', LlmRouterState>

/** Live routing signals consulted by the auto branch. */
interface RouterSignals {
  /** Projected context occupancy ratio, or `undefined` while the meter lacks a complete sample. */
  contextPressureRatio: number | undefined
  /** Tool-step ratio over the auto window, or `undefined` before any completed step. */
  toolDensity: number | undefined
}

/** Whether one request route satisfies a match; absent fields match anything. */
function matchesRoute(when: RouteMatch | undefined, provider: string, model: string): boolean {
  if (when === undefined) return true
  if (when.provider !== undefined && when.provider !== provider) return false
  if (when.model !== undefined && when.model !== model) return false
  return true
}

/**
 * The routing target for one resolved request: the first matching rule wins,
 * otherwise the auto branch decides from the live signals.
 * @param config - resolved router configuration.
 * @param request - the call configuration the waterfall is about to return.
 * @param readSignals - reads the auto branch's signals; never called when a rule
 *   matched or the auto branch does not apply, so projection reads stay off the
 *   rule-only path.
 * @returns the target to apply, or `undefined` to leave the request untouched.
 */
function targetFor(
  config: ResolvedRouterConfig,
  request: LlmCallConfig,
  readSignals: (auto: ResolvedAutoRoute) => RouterSignals,
): RouteTarget | undefined {
  for (const rule of config.routes) {
    if (matchesRoute(rule.when, request.provider, request.model)) return rule.route
  }
  const auto = config.auto
  if (auto === undefined || !matchesRoute(auto.when, request.provider, request.model)) return undefined
  const signals = readSignals(auto)
  const elevated = (signals.contextPressureRatio !== undefined
      && signals.contextPressureRatio >= auto.contextPressureThreshold)
    || (signals.toolDensity !== undefined && signals.toolDensity >= auto.toolDensityThreshold)
  return elevated ? auto.capability : auto.economy
}

/**
 * Read the live auto-branch signals through the projection registry.
 * @param ctx - plugin context that owns the registry dependency.
 * @param session - the session whose request is being routed.
 * @param auto - the auto branch whose window the density averages over.
 * @returns both signals; each is `undefined` while its source holds no sample.
 */
function readSignals(ctx: Context, session: Session, auto: ResolvedAutoRoute): RouterSignals {
  return {
    contextPressureRatio: contextPressureRatio(ctx.sessionProjections.stateOf(session, 'contextPressure')),
    toolDensity: toolDensity(ctx.sessionProjections.stateOf(session, 'llmRouter'), auto.toolDensityWindow),
  }
}

/**
 * Install explicit-then-signal routing on the agent request waterfall. The
 * listener prepends, so the routed configuration is the waterfall's final
 * value and the loop logs and dispatches it.
 * @param ctx - plugin context that owns the projection unit and the listener.
 * @param config - routing rules and the optional auto branch.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolvedConfig = resolveRouterConfig(config, 'llm-router')
  ctx.sessionProjections.register(llmRouterProjectionDefinition)
  ctx.on('agent/request', async (payload, next): Promise<LlmCallConfig> => {
    const resolved = await next()
    const session = payload.agent.session
    const target = targetFor(resolvedConfig, resolved, auto => readSignals(ctx, session, auto))
    if (target === undefined) return resolved
    const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
    const candidate: LlmCallConfig = {
      ...withoutInheritedEffort,
      provider: target.provider,
      model: target.model,
      ...target.reasoningEffort === undefined ? {} : { reasoningEffort: target.reasoningEffort },
    }
    return callConfigEquals(candidate, resolved) ? resolved : candidate
  }, { prepend: true })
}

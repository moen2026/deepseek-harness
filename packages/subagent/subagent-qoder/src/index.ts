/**
 * Profile-named Qoder one-shot subagent provider. Every accepted run drives
 * the pinned package-local Qoder CLI in headless print mode inside the
 * delegating Session's workspace and delivers only the parsed final answer.
 *
 * @module @deepseek-ai/dsh-subagent-qoder
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  assertPositiveFinite,
  NO_START_CAPABILITIES,
  resolveChildCwd,
  type ResolvedSubagentStartRequest,
  type SubagentCapabilities,
  type SubagentProvider,
  type SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import {
  DEFAULT_QODER_PERMISSION_MODE,
  QODER_PERMISSION_MODES,
  qoderCommandArgv,
  type QoderPermissionMode,
} from './cli.ts'
import {
  DEFAULT_DISPOSE_GRACE_MS,
  qoderStartupFailure,
  startQoderRun,
  type QoderRunSpec,
} from './run.ts'

export const name = 'subagent-qoder'
export const inject = ['subagents', 'subprocess']

const DEFAULT_PROVIDER_NAME = 'qoder'

/** Deployment-owned model, turn, permission, environment, and process-release settings. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `qoder`). */
  providerName?: string
  /** Native Qoder model fixed for this instance; omitted to inherit CLI defaults. */
  model?: string
  /** Optional cap on agent turns for every run from this instance. */
  maxTurns?: number
  /**
   * Tools pre-approved for the unattended run. Headless mode auto-denies any
   * interactive approval prompt, so a task that must write needs its tool
   * names listed here (names come from the product's own tool list).
   */
  allowedTools?: string[]
  /** Tools refused for the unattended run. */
  disallowedTools?: string[]
  /**
   * Explicit environment entries layered over the subprocess seam's
   * credential-scrubbed parent environment. A personal access token
   * (`QODER_PERSONAL_ACCESS_TOKEN`) intended for the child must be supplied
   * here.
   */
  env?: Record<string, string>
  /** Native non-interactive permission behavior fixed for this instance. */
  permissionMode?: QoderPermissionMode
  /** Grace in milliseconds between subprocess managed-range termination tiers. */
  disposeGraceMs?: number
}

export const Config: z<Config> = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  model: z.string().min(1),
  maxTurns: z.number().min(1),
  allowedTools: z.array(z.string()),
  disallowedTools: z.array(z.string()),
  env: z.dict(z.string()).default({}),
  permissionMode: z.union([...QODER_PERMISSION_MODES])
    .default(DEFAULT_QODER_PERMISSION_MODE),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
})

type ResolvedConfig = Omit<Required<Config>, 'model' | 'maxTurns' | 'allowedTools' | 'disallowedTools'>
  & Pick<Config, 'model' | 'maxTurns' | 'allowedTools' | 'disallowedTools'>

/**
 * Apply defaults and validate the deployment settings once at load.
 * @param config - the raw plugin config.
 * @returns settings with defaults applied and bounds enforced.
 */
export function resolveQoderConfig(config: Config): ResolvedConfig {
  const disposeGraceMs = config.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS
  assertPositiveFinite('subagent-qoder', 'disposeGraceMs', disposeGraceMs)
  if (disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `subagent-qoder: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  const maxTurns = config.maxTurns
  if (maxTurns !== undefined && (!Number.isInteger(maxTurns) || maxTurns < 1)) {
    throw new Error('subagent-qoder: maxTurns must be a positive integer')
  }
  return {
    providerName: config.providerName ?? DEFAULT_PROVIDER_NAME,
    ...config.model === undefined ? {} : { model: config.model },
    ...maxTurns === undefined ? {} : { maxTurns },
    ...config.allowedTools === undefined ? {} : { allowedTools: config.allowedTools },
    ...config.disallowedTools === undefined ? {} : { disallowedTools: config.disallowedTools },
    env: config.env ?? {},
    permissionMode: config.permissionMode ?? DEFAULT_QODER_PERMISSION_MODE,
    disposeGraceMs,
  }
}

class QoderProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  constructor(
    readonly name: string,
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {}

  start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    const parentCwd = request.parent.session.header.cwd
    if (parentCwd === undefined) {
      throw new Error(
        'subagent-qoder: no working directory for the child — delegate from a parent session that has one',
      )
    }
    let cwd: string
    let command: string[]
    try {
      cwd = resolveChildCwd('subagent-qoder', undefined, parentCwd)
      command = qoderCommandArgv()
    } catch (error: unknown) {
      if (request.signal.aborted) {
        throw new Error('subagent-qoder: request was aborted before startup')
      }
      throw qoderStartupFailure(error)
    }
    const spec: QoderRunSpec = {
      command,
      cwd,
      ...this.config.model === undefined ? {} : { model: this.config.model },
      ...this.config.maxTurns === undefined ? {} : { maxTurns: this.config.maxTurns },
      ...this.config.allowedTools === undefined ? {} : { allowedTools: this.config.allowedTools },
      ...this.config.disallowedTools === undefined ? {} : { disallowedTools: this.config.disallowedTools },
      permissionMode: this.config.permissionMode,
      env: this.config.env,
      disposeGraceMs: this.config.disposeGraceMs,
      spawn: spawnSpec => this.ctx.subprocess.spawn(spawnSpec),
      onError: (error, stopReason) => {
        this.ctx.logger.warn(
          `subagent-qoder "${this.name}": child run failed (${stopReason}): ${error.message}`,
        )
      },
    }
    return startQoderRun(request, spec)
  }
}

/**
 * Register one Profile-named Qoder provider.
 * @param ctx - context carrying shared subagent and subprocess services.
 * @param config - registry name, run settings, child environment, and disposal grace.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveQoderConfig(config)
  ctx.subagents.registerProvider(new QoderProvider(resolved.providerName, ctx, resolved))
}

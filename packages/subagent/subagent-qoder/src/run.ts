/**
 * One-shot Qoder child lifecycle: spawn the pinned headless CLI through the
 * subprocess seam, deliver the task on stdin, settle the parsed print-mode
 * reply into a terminal result, and dispose to whole-range quiescence.
 *
 * @module @deepseek-ai/dsh-subagent-qoder/run
 */

import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  settleRunResult,
  subprocessRunHandle,
  type SubagentResult,
  type SubagentRun,
  type SubagentStartRequest,
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { parseQoderReply, qoderRunArgs, textTask, type QoderPermissionMode } from './cli.ts'

/** Default grace between subprocess termination tiers. */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/** In-memory cap for the collected print-mode stdout capture. */
const STDOUT_CAP_BYTES = 16 * 1024 * 1024

type QoderFailureStage = 'spawn' | 'run' | 'teardown'

type QoderFailureCategory = 'unknown' | 'process' | 'invalid-result' | 'product-error'

interface QoderFailureFacts {
  readonly stage: QoderFailureStage
  readonly category: QoderFailureCategory
  readonly outcome?: SubprocessOutcome | undefined
}

function failureDiagnostic(facts: QoderFailureFacts): string {
  const fields = [
    'product: Qoder',
    `stage: ${facts.stage}`,
    `category: ${facts.category}`,
  ]
  const processFields = [
    ['exit code', facts.outcome?.exitCode],
    ['signal', facts.outcome?.signal],
  ] as const
  for (const [label, value] of processFields) {
    if (value !== null && value !== undefined) fields.push(`${label}: ${value}`)
  }
  return `Product subagent failure (${fields.join('; ')})`
}

class QoderRunFailure extends Error {
  constructor(
    readonly facts: QoderFailureFacts,
    cause?: unknown,
  ) {
    super(
      `subagent-qoder: ${failureDiagnostic(facts)}`,
      cause === undefined ? undefined : { cause },
    )
    this.name = 'QoderRunFailure'
  }
}

/**
 * Hide an unpublished Host failure behind fixed safe startup facts.
 * @param cause Original Host failure retained for internal diagnostics.
 * @returns A startup failure whose message contains only fixed safe facts.
 */
export function qoderStartupFailure(cause: unknown): Error {
  return new QoderRunFailure({
    stage: 'spawn',
    category: 'unknown',
  }, cause)
}

/** Fully resolved inputs for one Qoder headless run. */
export interface QoderRunSpec {
  /** Pinned command entry (Node plus the package-local CLI script). */
  readonly command: readonly string[]
  /** Parent Session workspace, also the child's working directory. */
  readonly cwd: string
  /** Profile-selected model; omitted to inherit CLI defaults. */
  readonly model?: string
  /** Profile-selected turn cap; omitted for the product default. */
  readonly maxTurns?: number
  /** Tools pre-approved for the unattended run. */
  readonly allowedTools?: readonly string[]
  /** Tools refused for the unattended run. */
  readonly disallowedTools?: readonly string[]
  /** Profile-selected native non-interactive permission behavior. */
  readonly permissionMode: QoderPermissionMode
  /** Explicit deployment/test environment layered after the shared scrub. */
  readonly env: Record<string, string>
  /** Subprocess termination grace passed to the shared managed-range owner. */
  readonly disposeGraceMs: number
  /** Shared subprocess service spawn operation. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Diagnostic sink for a post-publication error flattened into a result. */
  readonly onError?: (error: Error, stopReason: SubagentStopReason) => void
}

function thrown(value: unknown): Error {
  /* v8 ignore next -- typed subprocess failures reject with Error. */
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Start one pinned Qoder CLI print-mode child and publish its one-shot run.
 * The task is delivered on stdin, so no prompt text enters the command line.
 * @param request - task content and the caller's cancellation signal.
 * @param spec - Workspace, environment, process service, and diagnostic policy.
 * @returns the published run once the child is spawned.
 */
// oxlint-disable-next-line typescript/require-await -- Preserve promise rejection semantics at the async provider contract.
export async function startQoderRun(
  request: Pick<SubagentStartRequest, 'prompt' | 'signal'>,
  spec: QoderRunSpec,
): Promise<SubagentRun> {
  const prompt = textTask(request.prompt)
  if (request.signal.aborted) {
    throw new Error('subagent-qoder: request was aborted before startup')
  }

  let child: SubprocessHandle
  try {
    child = spec.spawn({
      argv: [...spec.command, ...qoderRunArgs(spec)],
      cwd: spec.cwd,
      stdio: {
        stdin: { data: prompt },
        stdout: { maxBytes: STDOUT_CAP_BYTES },
        stderr: 'inherit',
      },
      graceMs: spec.disposeGraceMs,
      env: spec.env,
    })
  } catch (error: unknown) {
    throw new QoderRunFailure({
      stage: 'spawn',
      category: 'unknown',
    }, thrown(error))
  }

  // The attempt below observes the outcome; this pre-observation keeps an
  // early rejection reported through the terminal result instead of surfacing
  // as an unhandled rejection on paths that settle first.
  void child.done.catch(() => {})

  const runAbort = new AbortController()
  const requestCancel = (): void => {
    if (runAbort.signal.aborted) return
    runAbort.abort(new Error('subagent-qoder: run cancelled locally'))
    child.terminate()
  }
  const onAbort = (): void => { requestCancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })

  let captured: ContentBlock[] = []
  let diagnostic: string | undefined
  const fail = (facts: QoderFailureFacts, cause?: unknown): QoderRunFailure => {
    diagnostic = failureDiagnostic(facts)
    return new QoderRunFailure(facts, cause)
  }

  const attempt = async (): Promise<SubagentResult> => {
    let outcome: SubprocessOutcome
    try {
      outcome = await child.done
    } catch (error: unknown) {
      throw fail({ stage: 'run', category: 'process' }, thrown(error))
    }
    const stdout = child.collected.stdout?.readFrom(0).text ?? ''
    const reply = parseQoderReply(stdout)
    if (reply.kind === 'unparsable') {
      // A clean exit with no usable reply object is an unusable result; a
      // non-zero exit or a signal is a process failure.
      const cleanExit = outcome.exitCode === 0 && outcome.signal === null
      throw fail({
        stage: 'run',
        category: cleanExit ? 'invalid-result' : 'process',
        outcome,
      })
    }
    if (reply.kind === 'product-error') {
      throw fail({ stage: 'run', category: 'product-error', outcome })
    }
    captured = [{ type: 'text', text: reply.text }]
    return {
      output: captured,
      stopReason: reply.maxTokens ? 'max-tokens' : 'completed',
    }
  }

  const result = settleRunResult({
    attempt,
    collectOutput: () => captured,
    collectDiagnostic: () => diagnostic,
    cancelled: () => runAbort.signal.aborted,
    onError: spec.onError,
    signal: request.signal,
    onAbort,
  })

  const teardown = async (): Promise<void> => {
    child.terminate()
    try {
      await child.waitForExit()
    } catch (error: unknown) {
      throw new QoderRunFailure({
        stage: 'teardown',
        category: 'unknown',
      }, thrown(error))
    }
  }

  return subprocessRunHandle({
    id: brandString<SessionId>(randomUUID()),
    result,
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown,
  })
}

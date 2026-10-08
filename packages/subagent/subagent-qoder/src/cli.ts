/**
 * The Qoder CLI adapter: package-local command resolution, headless
 * print-mode arguments, one-shot task normalization, and the parsed
 * `--output-format=json` reply. Every operation is a pure function over
 * explicit inputs so the CLI contract stays testable without spawning the
 * product. The reply schema follows the observed 1.1.65 output — a single
 * JSON object carrying `is_error`, `result`, and `stop_reason`.
 *
 * @module @deepseek-ai/dsh-subagent-qoder/cli
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** Profile-selectable non-interactive Qoder permission mode. */
export type QoderPermissionMode = 'default' | 'bypass'

/**
 * Native non-interactive Qoder modes: `default` leaves the headless
 * auto-deny behavior in force (interactive approval prompts are refused),
 * while `bypass` maps to the product's `--yolo` flag and must be selected
 * explicitly.
 */
export const QODER_PERMISSION_MODES = [
  'default',
  'bypass',
] as const satisfies readonly QoderPermissionMode[]

/** Safe default for unattended Qoder runs. */
export const DEFAULT_QODER_PERMISSION_MODE: QoderPermissionMode = 'default'

/**
 * Candidate result keys probed in order when reading the reply object. The
 * official contract carries the answer under `result`; the remaining keys are
 * a bounded compatibility margin for documented output evolution.
 */
const RESULT_KEYS = ['result', 'response', 'content', 'message', 'text', 'output'] as const

/** Depth bound for nested result extraction; deeper candidates are ignored. */
const MAX_EXTRACT_DEPTH = 16

let cachedCliEntry: string | undefined

/**
 * The package-local Qoder CLI entry, resolved from the pinned
 * `@qoder-ai/qodercli` dependency instead of the host `PATH`, so an installed
 * IDE launcher with the same name can never be selected.
 * @returns Node's executable followed by the pinned CLI entry.
 */
export function qoderCommandArgv(): string[] {
  cachedCliEntry ??= resolveQoderCliEntry(
    createRequire(import.meta.url).resolve('@qoder-ai/qodercli/package.json'),
  )
  return [process.execPath, cachedCliEntry]
}

/**
 * Resolve the binary a pinned dependency manifest declares. Reads the manifest
 * rather than guessing the bundle layout, so a dependency upgrade that moves
 * its entry keeps working.
 * @param manifestPath - absolute path of the dependency's `package.json`.
 * @returns the absolute path of its `qodercli` binary entry.
 * @throws when the manifest declares no string `qodercli` binary.
 */
export function resolveQoderCliEntry(manifestPath: string): string {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    bin?: { qodercli?: unknown }
  }
  if (typeof manifest.bin?.qodercli !== 'string') {
    throw new Error('subagent-qoder: @qoder-ai/qodercli declares no qodercli binary')
  }
  return resolve(dirname(manifestPath), manifest.bin.qodercli)
}

/** Deployment-selected run arguments forwarded to the Qoder CLI. */
export interface QoderArgSelection {
  /** Model fixed for every run from this provider instance; omitted to inherit CLI defaults. */
  readonly model?: string
  /** Optional cap on agent turns for one run. */
  readonly maxTurns?: number
  /** Tools pre-approved for the unattended run, forwarded as one `--allowed-tools` list. */
  readonly allowedTools?: readonly string[]
  /** Tools refused for the unattended run, forwarded as one `--disallowed-tools` list. */
  readonly disallowedTools?: readonly string[]
  /** Selected non-interactive permission behavior. */
  readonly permissionMode: QoderPermissionMode
}

/**
 * Build the headless print-mode arguments for one run.
 * @param selection - resolved deployment run settings.
 * @returns CLI arguments after the pinned command entry.
 */
export function qoderRunArgs(selection: QoderArgSelection): string[] {
  const args = ['--print', '--output-format', 'json']
  if (selection.model !== undefined) args.push('--model', selection.model)
  if (selection.maxTurns !== undefined) args.push('--max-turns', String(selection.maxTurns))
  if (selection.allowedTools !== undefined && selection.allowedTools.length > 0) {
    args.push(`--allowed-tools=${selection.allowedTools.join(',')}`)
  }
  if (selection.disallowedTools !== undefined && selection.disallowedTools.length > 0) {
    args.push(`--disallowed-tools=${selection.disallowedTools.join(',')}`)
  }
  if (selection.permissionMode === 'bypass') args.push('--yolo')
  return args
}

/**
 * Validate and flatten the one-shot task into the single text delivered on
 * the child's stdin.
 * @param prompt - task content accepted from the shared subagent service.
 * @returns the non-empty text, multiple blocks joined by one blank line.
 */
export function textTask(prompt: readonly ContentBlock[]): string {
  if (prompt.length === 0) {
    throw new Error('subagent-qoder: the one-shot task must contain only text blocks')
  }
  const texts: string[] = []
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error('subagent-qoder: the one-shot task must contain only text blocks')
    }
    texts.push(block.text)
  }
  if (texts.every(text => text.trim().length === 0)) {
    throw new Error('subagent-qoder: the one-shot task must not be empty')
  }
  return texts.join('\n\n')
}

/** The parsed meaning of one print-mode reply. */
export type QoderReplyOutcome =
  | {
    /** The CLI completed and produced an answer. */
    readonly kind: 'result'
    /** The answer text carried by the reply. */
    readonly text: string
    /** Whether the product stopped at its token ceiling. */
    readonly maxTokens: boolean
  }
  | {
    /** The reply is a well-formed product error (`is_error: true`). */
    readonly kind: 'product-error'
  }
  | {
    /** No usable reply object was found. */
    readonly kind: 'unparsable'
  }

/**
 * Parse one `--output-format=json` stdout capture. Tolerates leading and
 * trailing noise (the CLI may interleave one-time setup notices before the
 * JSON object) by scanning for the outermost object boundaries.
 * @param stdout - the complete collected stdout.
 * @returns the reply meaning; `unparsable` when no object or no answer text is present.
 */
export function parseQoderReply(stdout: string): QoderReplyOutcome {
  const payload = extractJsonObject(stdout)
  if (payload === undefined) return { kind: 'unparsable' }
  if (payload.is_error === true) return { kind: 'product-error' }
  const text = extractResultText(payload)
  if (text === undefined) return { kind: 'unparsable' }
  return {
    kind: 'result',
    text,
    maxTokens: payload.stop_reason === 'max_tokens',
  }
}

/** Find the reply object in a capture that may carry non-JSON noise. */
function extractJsonObject(stdout: string): Record<string, unknown> | undefined {
  const text = stdout.trim()
  const direct = tryParseObject(text)
  if (direct !== undefined) return direct
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  return tryParseObject(text.slice(start, end + 1))
}

function tryParseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : undefined
  } catch {
    // The slice is not JSON; the caller falls back to the boundary window.
    return undefined
  }
}

/** Extract the first non-blank answer candidate under the probe keys. */
function extractResultText(value: unknown, depth = 0): string | undefined {
  if (depth > MAX_EXTRACT_DEPTH) return undefined
  if (typeof value === 'string') {
    return value.trim().length === 0 ? undefined : value
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractResultText(item, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (isRecord(value)) {
    for (const key of RESULT_KEYS) {
      if (!Object.hasOwn(value, key)) continue
      const found = extractResultText(value[key], depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

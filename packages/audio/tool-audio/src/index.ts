/**
 * Model-facing `transcribe_audio` tool over `ctx.audio` and `ctx.fs`: resolve a workspace
 * audio file, read it bounded, and return the provider's transcript as text. The tool
 * returns an actionable "audio unavailable" answer — without failing the session — when no
 * provider is mounted. It runtime-injects only `tools`, `audio`, `fs`, and `systemPrompt`
 * and imports no provider.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-tool-audio
 */

import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { FsError, type FsInfo, type FsTarget } from '@deepseek-ai/dsh-fs'
import { AudioError } from '@deepseek-ai/dsh-audio'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  DEFAULT_MAX_RESULT_CHARS,
  formatTranscript,
  parseTranscribeArgs,
  presentTranscribeCall,
} from './render.ts'

export {
  DEFAULT_MAX_RESULT_CHARS,
  formatTranscript,
  parseTranscribeArgs,
  presentTranscribeCall,
} from './render.ts'
export type { TranscribeArgs, TranscriptItem } from './render.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'tool-audio'

/** Services required by this plugin. */
export const inject = ['tools', 'audio', 'fs', 'systemPrompt']

/** Default tool-call timeout budget (ms), covering one transcription round trip. */
export const DEFAULT_AUDIO_TOOL_TIMEOUT_MS = 120_000

/** Default UTF-8 byte ceiling on one transcribed audio file (25 MiB). */
export const DEFAULT_MAX_AUDIO_BYTES = 26_214_400

/** The stable system-prompt guidance positioning the transcription tool and its optionality. */
export const AUDIO_PROMPT_TEXT =
  'Use transcribe_audio to convert an audio file (MP3, WAV, M4A, AAC, OGG, Opus, FLAC, or WebM) in the workspace into text. It is unavailable until an audio provider is configured — then continue without transcription, for example by suggesting the user configure one.'

/** Plugin configuration: the result cap, the audio byte budget, and the timeout budget. */
export interface Config {
  /** Largest complete rendered result in characters, including truncation metadata (default 8000). */
  maxResultChars?: number
  /** Inclusive byte ceiling on one transcribed audio file (default 26214400). */
  maxAudioBytes?: number
  /** Tool-call timeout budget in ms (default 120000). */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  maxResultChars: z.number().default(DEFAULT_MAX_RESULT_CHARS),
  maxAudioBytes: z.number().default(DEFAULT_MAX_AUDIO_BYTES),
  timeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_AUDIO_TOOL_TIMEOUT_MS),
})

type ResolvedConfig = Required<Config>

/** Actionable answer returned when no audio provider holds the seam. */
const UNAVAILABLE_TEXT =
  'Audio transcription is not available: no provider is configured. Configure a transcription endpoint (an OpenAI-compatible /audio/transcriptions service) to transcribe audio files; otherwise continue without transcription.'

/**
 * The calling agent's per-session workspace, or `undefined` for a non-agent caller.
 * @param exec - the tool-execution context.
 * @returns the session cwd the filesystem resolution applies, when one applies.
 */
function sessionCwd(exec: ToolExecution): string | undefined {
  return exec.agent?.session.header.cwd
}

/**
 * Resolve the requested path and require an existing regular file.
 * @param ctx - the plugin context providing filesystem resolution and observation events.
 * @param exec - the current tool execution.
 * @param requestedPath - the raw path supplied to the tool.
 * @returns the resolved target and its stat.
 */
async function resolveAudioTarget(
  ctx: Context,
  exec: ToolExecution,
  requestedPath: string,
): Promise<{ target: FsTarget; info: FsInfo }> {
  const cwd = sessionCwd(exec)
  const target = await ctx.fs.resolve(requestedPath, {
    ...cwd !== undefined ? { cwd } : {},
    signal: exec.signal,
  })
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new FsError(`cannot transcribe "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  }
  if (info.type !== 'file') {
    throw new FsError(`cannot transcribe "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  return { target, info }
}

/**
 * Register the `transcribe_audio` tool and its system-prompt guidance.
 * @param ctx - the plugin context (must inject `tools`, `audio`, `fs`, `systemPrompt`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('maxResultChars', resolved.maxResultChars)
  assertPositiveInteger('maxAudioBytes', resolved.maxAudioBytes)
  assertTimer('timeoutMs', resolved.timeoutMs)

  ctx.systemPrompt.section({
    name: 'tool:audio',
    order: ctx.systemPrompt.getSectionOrder('TOOL_AUDIO'),
    text: AUDIO_PROMPT_TEXT,
  })

  ctx.tools.register(defineTool({
    name: 'transcribe_audio',
    description:
      'Transcribe an audio file in the workspace (MP3, WAV, M4A, AAC, OGG, Opus, FLAC, or WebM) and return the recognized text. file_path is required; language and prompt are optional refinements. Returns an actionable unavailable message when no transcription provider is configured.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to the audio file, resolved by the filesystem backend.' },
      language: { type: 'string', description: 'Optional ISO 639-1 language hint for the transcription.' },
      prompt: { type: 'string', description: 'Optional free-text hint (for example known terms) steering the transcription.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['ok', 'unavailable'] },
          path: { type: 'string' },
          text: { type: 'string' },
          language: { type: 'string' },
          durationSec: { type: 'number' },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: value.status === 'unavailable'
          ? UNAVAILABLE_TEXT
          : formatTranscript(value.path ?? '', {
            text: value.text ?? '',
            ...value.language === undefined ? {} : { language: value.language },
            ...value.durationSec === undefined ? {} : { durationSec: value.durationSec },
          }, resolved.maxResultChars) },
      ],
      presentationMeta: (_args, value) => ({
        ...value.path === undefined ? {} : { path: value.path },
      }),
    },
    timeoutMs: resolved.timeoutMs,
    // One file per call and no shared mutable state, so concurrent calls cannot conflict.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseTranscribeArgs(args)
      const { target } = await resolveAudioTarget(ctx, exec, input.filePath)
      const data = await ctx.fs.readBytes(target, exec.signal, resolved.maxAudioBytes)
      try {
        const transcript = await ctx.audio.transcribe({
          data,
          fileName: basename(target.displayPath.replace(/\\/g, '/')),
          ...input.language === undefined ? {} : { language: input.language },
          ...input.prompt === undefined ? {} : { prompt: input.prompt },
        }, exec.signal)
        return {
          status: 'ok' as const,
          path: target.displayPath,
          text: transcript.text,
          ...transcript.language === undefined ? {} : { language: transcript.language },
          ...transcript.durationSec === undefined ? {} : { durationSec: transcript.durationSec },
        }
      } catch (error) {
        if (error instanceof AudioError && error.code === 'AUDIO_UNAVAILABLE') {
          return { status: 'unavailable' as const, path: target.displayPath }
        }
        throw error
      }
    },
    presentCall: presentTranscribeCall,
  }))
}

/** Reject a non-positive-integer config value at load, so misconfiguration fails loud. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-audio: ${name} must be a positive integer`)
  }
}

/** Reject a timer value Node would clamp instead of scheduling as configured. */
function assertTimer(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-audio: ${name} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

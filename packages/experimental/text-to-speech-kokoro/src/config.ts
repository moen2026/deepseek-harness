/** Deployment configuration for the managed local Kokoro synthesizer. */
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { ManagedWorkerConfig } from '@deepseek-ai/dsh-experimental-local-speech-runtime'

/** Local runtime, synthesis, and retention settings. */
export interface Config extends ManagedWorkerConfig {
  /** Unique registration id; consumers select this exact id. */
  providerId: string
  /** Absolute directory for the extracted Kokoro model bundle. */
  dataRoot: string
  /** Existing directory containing the extracted model bundle; omission downloads and extracts the verified tarball. */
  modelDirectory?: string | undefined
  /** Existing espeak-ng-data directory; omission uses the one extracted with the model bundle. */
  espeakDataDir?: string | undefined
  /** Default Chinese voice; `zf_*` are female and `zm_*` male voices. */
  voice: string
  /** Speech rate multiplier. */
  speed: number
  /** CPU intra-operation thread count. */
  threads: number
  /** Maximum accepted text character count. */
  maxTextChars: number
  /** Maximum synthesized WAV bytes accepted by the private worker. */
  maxAudioBytes: number
  /** Maximum download-source probe duration, including redirects. */
  modelProbeTimeoutMs: number
}

/** Validate deployment-varying runtime choices at plugin activation. */
export const Config: z<Partial<Config>, Config> = z.object({
  providerId: z.string().min(1).default('kokoro-local'),
  dataRoot: z.string().min(1).required(),
  modelDirectory: z.union([z.string().min(1), z.const(undefined)]),
  espeakDataDir: z.union([z.string().min(1), z.const(undefined)]),
  voice: z.string().pattern(/^(zf|zm)_[a-z0-9_]+$/).default('zf_001'),
  speed: z.number().min(0.5).max(2).default(1),
  threads: z.natural().min(1).default(2),
  maxTextChars: z.natural().min(1).default(4000),
  maxAudioBytes: z.natural().min(1).default(32 * 1024 * 1024),
  modelOrigin: z.union([z.string().pattern(/^https?:\/\/[^\s@]+$/), z.const(undefined)]),
  modelOrigins: z.array(z.string().pattern(/^https?:\/\/[^\s@]+$/)).min(1).default([
    'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2',
    'https://gh-proxy.com/https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2',
    'https://ghproxy.net/https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2',
  ]),
  modelProbeTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(3000),
  prepareTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(3_600_000),
  inferenceTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(120_000),
  idleTimeoutMs: z.natural().max(MAX_TIMER_DELAY_MS).default(300_000),
  maxPending: z.natural().min(1).default(4),
  graceMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(1000),
  maxLogBytes: z.natural().min(1).default(64 * 1024),
  progressIntervalMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(100),
})

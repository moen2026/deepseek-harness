/** Deployment configuration for the voice-cloning service HTTP client provider. */
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Service location and synthesis defaults for the voice-cloning provider. */
export interface Config {
  /** Unique registration id; consumers select this exact id. */
  providerId: string
  /** Provider name shown by the settings page; one deployment registers one provider per compatible service. */
  displayName: string
  /** Origin of the externally managed synthesis service. */
  serviceOrigin: string
  /** Cloned voice used when the caller omits one. */
  voice: string
  /** Speech rate multiplier. */
  speed: number
  /** Maximum accepted text character count. */
  maxTextChars: number
  /** Maximum synthesized WAV bytes accepted from the service. */
  maxAudioBytes: number
  /** Maximum accepted reference-recording bytes. */
  maxReferenceBytes: number
  /** Maximum synthesis request duration, including queueing inside the service. */
  requestTimeoutMs: number
  /** Maximum voice-roster probe duration. */
  healthTimeoutMs: number
}

/** Validate deployment-varying service location and synthesis defaults at plugin activation. */
export const Config: z<Partial<Config>, Config> = z.object({
  providerId: z.string().min(1).default('openvoice-local'),
  displayName: z.string().min(1).default('OpenVoice v2 (local)'),
  serviceOrigin: z.string().pattern(/^https?:\/\/[^\s@]+$/).default('http://127.0.0.1:9092'),
  voice: z.string().min(1).default('demo'),
  speed: z.number().min(0.5).max(2).default(1),
  maxTextChars: z.natural().min(1).default(4000),
  maxAudioBytes: z.natural().min(1).default(32 * 1024 * 1024),
  maxReferenceBytes: z.natural().min(1).default(16 * 1024 * 1024),
  requestTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(120_000),
  healthTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(5000),
})

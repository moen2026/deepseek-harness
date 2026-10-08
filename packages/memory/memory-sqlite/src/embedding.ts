/**
 * Optional external HTTP embedding client for the memory provider. The provider uses it only
 * when a deployment supplies an embedding endpoint; it reads the credential from an
 * *environment variable name* (`authEnv`) at call time so the secret never enters
 * configuration files, stored memories, or logs. Every failure surfaces as a thrown error the
 * provider catches to degrade to the lexical path — this module never logs the credential.
 * @module @deepseek-ai/dsh-memory-sqlite/embedding
 */

/** Deployment-supplied embedding endpoint description. */
export interface EmbeddingConfig {
  /** Full embeddings endpoint URL (an OpenAI-compatible `/v1/embeddings` shape). */
  readonly url: string
  /** Model name sent to the endpoint. */
  readonly model: string
  /** Name of the environment variable holding the bearer token; never the token itself. */
  readonly authEnv: string
  /** Required embedding dimension; a mismatched response is rejected. */
  readonly dimension: number
  /** Per-request timeout in milliseconds. Defaults to 15000. */
  readonly timeoutMs?: number
  /** Maximum inputs per request; longer batches are split. Defaults to 64. */
  readonly maxBatch?: number
}

/** A text-to-vector function the provider can call and tests can fake. */
export interface Embedder {
  /**
   * Embed one or more texts, preserving input order.
   * @param texts - the strings to embed.
   * @param signal - caller cancellation composed with the endpoint timeout.
   * @returns one vector of `dimension` components per input text.
   */
  embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]>
}

const DEFAULT_EMBED_TIMEOUT_MS = 15_000
const DEFAULT_EMBED_MAX_BATCH = 64

/**
 * Build an {@link Embedder} over an OpenAI-compatible embeddings endpoint.
 * @param config - the endpoint description.
 * @returns an embedder that batches texts and validates the returned dimension.
 */
export function createHttpEmbedder(config: EmbeddingConfig): Embedder {
  const timeoutMs = config.timeoutMs ?? DEFAULT_EMBED_TIMEOUT_MS
  const maxBatch = Math.max(1, config.maxBatch ?? DEFAULT_EMBED_MAX_BATCH)
  return {
    async embed(texts, signal) {
      const vectors: number[][] = []
      for (let start = 0; start < texts.length; start += maxBatch) {
        const batch = texts.slice(start, start + maxBatch)
        const part = await embedBatch(config, batch, timeoutMs, signal)
        vectors.push(...part)
      }
      return vectors
    },
  }
}

async function embedBatch(
  config: EmbeddingConfig,
  batch: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<number[][]> {
  const key = process.env[config.authEnv]
  if (key === undefined || key.trim() === '') {
    throw new Error(`memory embedding: environment variable "${config.authEnv}" is not set`)
  }
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)]
  if (signal !== undefined) signals.push(signal)
  const composed = AbortSignal.any(signals)
  const response = await fetch(config.url, {
    method: 'POST',
    signal: composed,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    // The credential is sent only as a header; it is never part of the request body or any log.
    body: JSON.stringify({ model: config.model, input: batch.slice() }),
  })
  if (!response.ok) {
    throw new Error(`memory embedding endpoint responded ${response.status}`)
  }
  const payload = await response.json() as { data?: Array<{ index?: number; embedding?: number[] }> }
  const data = payload.data
  if (!Array.isArray(data) || data.length !== batch.length) {
    throw new Error('memory embedding endpoint returned an unexpected shape')
  }
  // Preserve input order via the echoed index; reject wrong-dimension vectors.
  const ordered = new Array<number[] | undefined>(batch.length)
  for (const item of data) {
    const vector = item.embedding
    const index = item.index
    if (!Array.isArray(vector) || vector.length !== config.dimension) {
      throw new Error(`memory embedding dimension must be ${config.dimension}`)
    }
    if (typeof index !== 'number' || index < 0 || index >= batch.length) {
      throw new Error('memory embedding endpoint returned an out-of-range index')
    }
    ordered[index] = vector.map(Number)
  }
  const filled = ordered.filter((vector): vector is number[] => vector !== undefined)
  if (filled.length !== batch.length) {
    throw new Error('memory embedding endpoint omitted an input')
  }
  return filled
}

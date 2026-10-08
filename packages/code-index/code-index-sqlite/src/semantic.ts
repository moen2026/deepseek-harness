/**
 * Local, dependency-free semantic ranking for the code-index provider. Chunk and query
 * text is projected into a fixed-dimension dense vector by feature hashing over word
 * tokens and identifier subtokens (camelCase and acronym splits), so a query phrased as
 * separate words still matches a compound identifier it never spells literally. Vectors
 * are L2-normalized and stored as symmetric int8 quantization, and the provider fuses
 * the semantic ranking with BM25 by reciprocal-rank fusion. The projection is a pure
 * function of the text: no model, no endpoint, no network, and stable across processes.
 * @module @deepseek-ai/dsh-code-index-sqlite/semantic
 */

/** Dense-vector dimension; a power of two so bucket masking stays exact. */
export const SEMANTIC_DIMENSION = 128

/** Reciprocal-rank-fusion constant; matches the memory provider's fusion. */
export const SEMANTIC_RRF_K = 60

/**
 * Project one text into its int8-quantized unit vector as 128 signed bytes.
 * @param text - chunk text or a caller query.
 * @returns `SEMANTIC_DIMENSION` quantized components, one per byte.
 */
export function embedVector(text: string): Uint8Array {
  const buckets = new Float64Array(SEMANTIC_DIMENSION)
  for (const feature of embedFeatures(text)) {
    const hash = hashFeature(feature)
    const bucket = hash & (SEMANTIC_DIMENSION - 1)
    buckets[bucket] = (buckets[bucket] ?? 0) + ((hash >>> 8) & 1 ? 1 : -1)
  }
  let norm = 0
  for (const value of buckets) norm += value * value
  norm = Math.sqrt(norm)
  const scale = norm > 0 ? 127 / norm : 0
  const bytes = new Uint8Array(SEMANTIC_DIMENSION)
  const signed = new Int8Array(bytes.buffer)
  for (let i = 0; i < SEMANTIC_DIMENSION; i += 1) {
    signed[i] = Math.max(-127, Math.min(127, Math.round((buckets[i] ?? 0) * scale)))
  }
  return bytes
}

/**
 * Decode a stored quantized vector back into signed components.
 * @param bytes - the 128-byte blob read from the vector table.
 * @returns the signed quantized components.
 */
export function decodeVector(bytes: Uint8Array): Int8Array {
  const signed = new Int8Array(bytes.byteLength)
  for (let i = 0; i < bytes.byteLength; i += 1) signed[i] = bytes[i] as number
  return signed
}

/**
 * Cosine similarity between two equal-length quantized vectors; `0` when either has no energy.
 * @param a - the first quantized vector.
 * @param b - the second quantized vector.
 * @returns the cosine of the angle between the decoded vectors.
 */
export function cosineSimilarity(a: Int8Array, b: Int8Array): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    const av = a[i] as number
    const bv = b[i] as number
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Extract the hashed feature vocabulary of one text: word tokens, camelCase/acronym
 * subtokens plus adjacent subtoken pairs, and adjacent word-token pairs.
 * @param text - chunk text or a caller query.
 * @returns the feature strings projected into the dense vector.
 */
export function embedFeatures(text: string): string[] {
  const tokens = text.match(/[A-Za-z0-9]+/gu) ?? []
  const features: string[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as string
    const lower = token.toLowerCase()
    features.push(`t:${lower}`)
    const parts = splitIdentifier(token)
    if (parts.length > 1) {
      for (const part of parts) features.push(`t:${part}`)
      for (let j = 0; j + 1 < parts.length; j += 1) {
        features.push(`t:${parts[j]}_${parts[j + 1]}`)
      }
    }
    if (i + 1 < tokens.length) {
      features.push(`b:${lower}_${(tokens[i + 1] as string).toLowerCase()}`)
    }
  }
  return features
}

/** Split one identifier token into lowercase subtokens (`searchCodebase` → search, codebase). */
function splitIdentifier(token: string): string[] {
  return token
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
    .toLowerCase()
    .split(' ')
}

/** FNV-1a 32-bit hash; deterministic across processes for one feature string. */
function hashFeature(feature: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < feature.length; i += 1) {
    hash ^= feature.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Reciprocal-rank-fuse several ranked rowid lists into one score map. Each list
 * contributes `1 / (SEMANTIC_RRF_K + rank)` to a rowid's fused score; rowids present in
 * more lists, or ranked higher, win.
 * @param rankings - ordered rowid lists, best first; empty or single lists pass through their order.
 * @returns a map of rowid to fused RRF score.
 */
export function reciprocalRankFusion(rankings: readonly (readonly number[])[]): Map<number, number> {
  const scores = new Map<number, number>()
  for (const ranking of rankings) {
    for (let rank = 0; rank < ranking.length; rank += 1) {
      const rowid = ranking[rank] as number
      scores.set(rowid, (scores.get(rowid) ?? 0) + 1 / (SEMANTIC_RRF_K + rank + 1))
    }
  }
  return scores
}

/**
 * Order rowids by descending fused RRF score, breaking ties by first appearance in `seedOrder`.
 * @param scores - fused scores from {@link reciprocalRankFusion}.
 * @param seedOrder - the lexical candidate order used as a stable tiebreaker.
 * @returns the rowids sorted best-first.
 */
export function fuseOrder(scores: ReadonlyMap<number, number>, seedOrder: readonly number[]): number[] {
  return [...scores.keys()].sort((left, right) => {
    /* v8 ignore next -- both compared rowids are the map's own keys; defensive. */
    const byScore = (scores.get(right) ?? 0) - (scores.get(left) ?? 0)
    if (byScore !== 0) return byScore
    return seedOrder.indexOf(left) - seedOrder.indexOf(right)
  })
}

/**
 * SQLite long-term-memory provider for `ctx.memory`. One plugin instance is configured with a
 * filesystem `path` for its derived store. By default it is a zero-dependency lexical store:
 * `remember` writes a canonical record plus an FTS5 row, `recall` ranks with BM25, and
 * `forget`/`list` delete and enumerate by recency. When — and only when — a deployment supplies
 * an external HTTP embedding endpoint in `config.embedding`, `remember` also stores a vector and
 * `recall` prefilters lexically then fuses BM25 and in-JS cosine similarity by reciprocal-rank
 * fusion. Any embedding failure degrades to the lexical path, so memory stays available offline.
 * Registration with the seam is effect-scoped: disposal unregisters the provider and closes the
 * database. The credential is read from an environment variable named by `authEnv`, never stored.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-memory-sqlite
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  MemoryDraft,
  MemoryHit,
  MemoryListRequest,
  MemoryNamespace,
  MemoryPage,
  MemoryProvider,
  MemoryRecord,
  MemoryRecallRequest,
  MemoryRecallResult,
} from '@deepseek-ai/dsh-memory'
import { MemoryError } from '@deepseek-ai/dsh-memory'
import { openMemoryDatabase, type JournalMode } from './schema.ts'
import {
  cosineSimilarity,
  decodeVector,
  encodeVector,
  fuseOrder,
  normalizeConfidence,
  normalizeDraft,
  normalizeNamespace,
  normalizeRecall,
  reciprocalRankFusion,
  sanitizeFtsText,
} from './query.ts'
import { createHttpEmbedder, type Embedder, type EmbeddingConfig } from './embedding.ts'

export {
  MEMORY_SQLITE_APPLICATION_ID,
  MEMORY_SQLITE_SCHEMA_VERSION,
  type JournalMode,
} from './schema.ts'
export {
  cosineSimilarity,
  decodeVector,
  encodeVector,
  fuseOrder,
  normalizeConfidence,
  normalizeDraft,
  normalizeNamespace,
  normalizeQuery,
  normalizeTags,
  normalizeTtl,
  quoteFtsData,
  reciprocalRankFusion,
  sanitizeFtsText,
} from './query.ts'
export { createHttpEmbedder, type Embedder, type EmbeddingConfig } from './embedding.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'memory-sqlite'

/** Services required by this plugin. */
export const inject = ['memory']

/** Default result page size. */
export const MEMORY_SQLITE_DEFAULT_LIMIT = 10
/** Maximum accepted result page size and listing pool. */
export const MEMORY_SQLITE_MAX_LIMIT = 100
/** Default UTF-8 byte ceiling for a single memory's text. */
export const MEMORY_SQLITE_MAX_TEXT_BYTES = 8_192

/** Combined memory-provider configuration. */
export interface Config {
  /** Dedicated derived-store path; `:memory:` is supported. Missing paths are created owner-only. */
  path: string
  /** Open the database at startup or lazily on the first operation. Defaults to `startup`. */
  openAt?: 'startup' | 'lazy'
  /** SQLite journal mode. Defaults to `wal`. */
  journalMode?: JournalMode
  /** Result page size when a request omits `limit`. Defaults to 10. */
  defaultLimit?: number
  /** Largest accepted page size and listing pool. Defaults to 100. */
  maxLimit?: number
  /** UTF-8 byte ceiling for a single memory's text. Defaults to 8192. */
  maxTextBytes?: number
  /** Optional external embedding endpoint enabling the vector path; absent means lexical only. */
  embedding?: EmbeddingConfig
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  openAt: z.union(['startup', 'lazy'] as const).default('startup'),
  journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
  defaultLimit: z.number().step(1).min(1).max(MEMORY_SQLITE_MAX_LIMIT).default(MEMORY_SQLITE_DEFAULT_LIMIT),
  maxLimit: z.number().step(1).min(1).max(MEMORY_SQLITE_MAX_LIMIT).default(MEMORY_SQLITE_MAX_LIMIT),
  maxTextBytes: z.number().step(1).min(1).default(MEMORY_SQLITE_MAX_TEXT_BYTES),
  embedding: z.object({
    url: z.string(),
    model: z.string(),
    authEnv: z.string(),
    dimension: z.number().step(1).min(1),
    timeoutMs: z.number().step(1).min(1),
    maxBatch: z.number().step(1).min(1),
  }).default(undefined as never),
})

interface ResolvedConfig {
  path: string
  openAt: 'startup' | 'lazy'
  journalMode: JournalMode
  defaultLimit: number
  maxLimit: number
  maxTextBytes: number
  embedding?: EmbeddingConfig
}

/** A row read back from `memory_records` with its tags still JSON-encoded. */
type RecordRow = {
  id: string
  text: string
  tags: string
  scope: string | null
  namespace: string | null
  confidence: number | null
  created_at: string
  expires_at: string | null
}

function rowToRecord(row: RecordRow): MemoryRecord {
  const tags = JSON.parse(row.tags) as string[]
  return {
    id: row.id,
    text: row.text,
    tags,
    ...(row.scope === null ? {} : { scope: row.scope }),
    ...(row.namespace === null ? {} : { namespace: row.namespace as MemoryNamespace }),
    ...(row.confidence === null ? {} : { confidence: row.confidence }),
    createdAt: row.created_at,
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
  }
}

/** Build an `IN (?, ?, ...)` placeholder group for a non-empty id list. */
function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

/**
 * A single-provider, node:sqlite FTS5 memory store with an optional fused vector path. All work
 * is serialized through one open connection so writes, recalls, and closes never interleave.
 */
export class SqliteMemoryProvider implements MemoryProvider {
  readonly id = 'memory-sqlite'

  private readonly config: ResolvedConfig
  private readonly embedder: Embedder | undefined
  private readonly warn: (message: string) => void
  private _warnedEmbedding = false
  private _db: DatabaseSync | undefined
  private _ready: Promise<void> | undefined
  private _tail: Promise<void> = Promise.resolve()
  private _closed = false

  constructor(
    config: ResolvedConfig,
    options: { embedder?: Embedder; warn?: (message: string) => void } = {},
  ) {
    this.config = config
    this.embedder = options.embedder
    this.warn = options.warn ?? (() => undefined)
  }

  /**
   * Open the store once. Idempotent; a failed attempt is retried by the next caller.
   * @param signal aborts the open attempt if it fires before the store is ready
   */
  prime(signal?: AbortSignal): Promise<void> {
    return this._ensureReady(signal)
  }

  async remember(draft: MemoryDraft, signal?: AbortSignal): Promise<string> {
    if (this._closed) throw new MemoryError('memory provider is disposed', 'MEMORY_DISPOSED')
    signal?.throwIfAborted()
    const normalized = normalizeDraft(draft, this.config.maxTextBytes)
    const id = randomUUID()
    const now = new Date()
    const createdAt = now.toISOString()
    const expiresAt = normalized.ttlMs === undefined
      ? undefined
      : new Date(now.getTime() + normalized.ttlMs).toISOString()
    await this._serialize(async () => {
      await this._ensureReady(signal)
      const db = this.requireDb()
      const tx = () => {
        db.exec('BEGIN')
        try {
          db.prepare('INSERT INTO memory_records (id, text, tags, scope, namespace, confidence, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(
              id,
              normalized.text,
              JSON.stringify(normalized.tags),
              normalized.scope ?? null,
              normalized.namespace ?? null,
              normalized.confidence ?? null,
              createdAt,
              expiresAt ?? null,
            )
          db.prepare('INSERT INTO memory_docs (text, mem_id) VALUES (?, ?)')
            .run(sanitizeFtsText(normalized.text), id)
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
      tx()
      // The vector is best-effort: a failure degrades to lexical and never blocks the write.
      if (this.embedder !== undefined) {
        const vector = await this._embedSafely([normalized.text], signal)
        if (vector !== undefined && vector[0] !== undefined) {
          this._storeVector(db, id, vector[0])
        }
      }
    })
    return id
  }

  async recall(request: MemoryRecallRequest, signal?: AbortSignal): Promise<MemoryRecallResult> {
    if (this._closed) throw new MemoryError('memory provider is disposed', 'MEMORY_DISPOSED')
    signal?.throwIfAborted()
    const normalized = normalizeRecall(request, { defaultLimit: this.config.defaultLimit, maxLimit: this.config.maxLimit })
    return this._serialize(async () => {
      await this._ensureReady(signal)
      const db = this.requireDb()
      const pool = db.prepare(`
        SELECT mem_id AS id, -bm25(memory_docs) AS score
        FROM memory_docs
        WHERE memory_docs MATCH ?
        ORDER BY bm25(memory_docs)
        LIMIT ?
      `).all(normalized.match, normalized.pool) as Array<{ id: string; score: number }>
      if (pool.length === 0) return { hits: [] }

      const byId = this._loadRecords(db, pool.map(row => row.id))
      const lexScore = new Map(pool.map(row => [row.id, row.score]))
      // Keep lexical order, dropping records deleted mid-flight or failing tag/scope/namespace/confidence/expiry filters.
      const now = Date.now()
      const candidates = pool
        .map(row => row.id)
        .filter(id => byId.has(id) && this._matchesFilters(byId.get(id) as MemoryRecord, normalized, now))

      if (this.embedder === undefined || candidates.length === 0) {
        /* v8 ignore next -- lexScore is built from the same pool these candidates come from; defensive. */
        return { hits: this._hits(candidates.slice(0, normalized.limit), byId, id => lexScore.get(id) ?? 0) }
      }

      const queryVector = await this._embedSafely([request.query], signal)
      if (queryVector === undefined || queryVector[0] === undefined) {
        // Endpoint unreachable or errored: degrade to the already-computed lexical ranking.
        /* v8 ignore next -- lexScore is built from the same pool these candidates come from; defensive. */
        return { hits: this._hits(candidates.slice(0, normalized.limit), byId, id => lexScore.get(id) ?? 0) }
      }
      const vectors = this._loadVectors(db, candidates)
      const vectorRanked = candidates
        .map(id => ({ id, sim: vectors.has(id) ? cosineSimilarity(queryVector[0] as number[], vectors.get(id) as number[]) : undefined }))
        .filter((entry): entry is { id: string; sim: number } => entry.sim !== undefined)
        .sort((left, right) => right.sim - left.sim)
        .map(entry => entry.id)
      const scores = reciprocalRankFusion([candidates, vectorRanked])
      const fused = fuseOrder(scores, candidates).slice(0, normalized.limit)
      /* v8 ignore next -- fused ids are the fusion map's own keys; defensive. */
      return { hits: this._hits(fused, byId, id => scores.get(id) ?? 0) }
    })
  }

  async forget(id: string, signal?: AbortSignal): Promise<boolean> {
    if (this._closed) throw new MemoryError('memory provider is disposed', 'MEMORY_DISPOSED')
    signal?.throwIfAborted()
    return this._serialize(async () => {
      await this._ensureReady(signal)
      const db = this.requireDb()
      const removed = db.prepare('DELETE FROM memory_records WHERE id = ?').run(id).changes > 0
      db.prepare('DELETE FROM memory_docs WHERE mem_id = ?').run(id)
      db.prepare('DELETE FROM memory_vectors WHERE mem_id = ?').run(id)
      return removed
    })
  }

  async list(request?: MemoryListRequest, signal?: AbortSignal): Promise<MemoryPage> {
    if (this._closed) throw new MemoryError('memory provider is disposed', 'MEMORY_DISPOSED')
    signal?.throwIfAborted()
    return this._serialize(async () => {
      await this._ensureReady(signal)
      const db = this.requireDb()
      const limit = request?.limit ?? this.config.defaultLimit
      const maxLimit = Math.min(this.config.maxLimit, Number.MAX_SAFE_INTEGER - 1)
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) {
        throw new MemoryError(`memory limit must be an integer between 1 and ${maxLimit}`, 'MEMORY_INVALID_REQUEST')
      }
      const namespace = normalizeNamespace(request?.namespace)
      const minConfidence = normalizeConfidence(request?.minConfidence, 'memory minConfidence')
      const rows = db.prepare(`
        SELECT id, text, tags, scope, namespace, confidence, created_at, expires_at FROM memory_records
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `).all(maxLimit) as RecordRow[]
      const scope = request?.scope?.trim()
      const now = Date.now()
      const records = rows
        .map(rowToRecord)
        .filter(record => this._matchesFilters(record, {
          ...(scope === undefined || scope.length === 0 ? {} : { scope }),
          ...(namespace === undefined ? {} : { namespace }),
          ...(minConfidence === undefined ? {} : { minConfidence }),
          tags: request?.tags ?? [],
        }, now))
        .slice(0, limit)
      return { records }
    })
  }

  /** Close the derived database. Safe to call more than once. */
  async close(): Promise<void> {
    if (this._closed) return
    this._closed = true
    /* v8 ignore next -- _serialize settles every tail through a both-outcome handler, so it cannot reject; defensive. */
    await this._tail.catch(() => undefined)
    this._db?.close()
    this._db = undefined
  }

  private requireDb(): DatabaseSync {
    const db = this._db
    /* v8 ignore next -- callers reach requireDb only after a resolved open assigned the handle; defensive. */
    if (db === undefined) throw new MemoryError('memory database is not open', 'MEMORY_UNAVAILABLE')
    return db
  }

  private _hits(ids: readonly string[], byId: Map<string, MemoryRecord>, scoreOf: (id: string) => number): MemoryHit[] {
    return ids.map(id => ({ record: byId.get(id) as MemoryRecord, score: scoreOf(id) }))
  }

  /** Whether one loaded record passes the request's scope/namespace/confidence/expiry/tag filters. */
  private _matchesFilters(
    record: MemoryRecord,
    normalized: { scope?: string; tags?: readonly string[]; namespace?: MemoryNamespace; minConfidence?: number },
    now: number,
  ): boolean {
    if (normalized.scope !== undefined && record.scope !== normalized.scope) return false
    if (normalized.namespace !== undefined && record.namespace !== normalized.namespace) return false
    if (normalized.minConfidence !== undefined
      && (record.confidence === undefined || record.confidence < normalized.minConfidence)) return false
    if (record.expiresAt !== undefined && Date.parse(record.expiresAt) <= now) return false
    return (normalized.tags ?? []).every(tag => record.tags.includes(tag))
  }

  private _loadRecords(db: DatabaseSync, ids: readonly string[]): Map<string, MemoryRecord> {
    const rows = db.prepare(
      `SELECT id, text, tags, scope, namespace, confidence, created_at, expires_at FROM memory_records WHERE id IN (${placeholders(ids.length)})`,
    ).all(...ids) as RecordRow[]
    return new Map(rows.map((row) => {
      const record = rowToRecord(row)
      return [record.id, record] as const
    }))
  }

  private _loadVectors(db: DatabaseSync, ids: readonly string[]): Map<string, number[]> {
    const rows = db.prepare(
      `SELECT mem_id AS id, embedding AS bytes FROM memory_vectors WHERE mem_id IN (${placeholders(ids.length)})`,
    ).all(...ids) as Array<{ id: string; bytes: Uint8Array }>
    return new Map(rows.map(row => [row.id, decodeVector(row.bytes)]))
  }

  private _storeVector(db: DatabaseSync, id: string, vector: readonly number[]): void {
    db.prepare('INSERT OR REPLACE INTO memory_vectors (mem_id, embedding, dim) VALUES (?, ?, ?)')
      .run(id, encodeVector(vector), vector.length)
  }

  /**
   * Embed texts, swallowing any failure after warning once so the lexical path always works.
   * @returns the vectors on success, or `undefined` when embedding is unavailable.
   */
  private async _embedSafely(texts: readonly string[], signal?: AbortSignal): Promise<number[][] | undefined> {
    /* v8 ignore next -- both call sites guard on a configured embedder; defensive. */
    if (this.embedder === undefined) return undefined
    try {
      const vectors = await this.embedder.embed(texts, signal)
      if (vectors.length !== texts.length) {
        this._warnEmbeddingOnce('embedding response length mismatch; using lexical ranking')
        return undefined
      }
      return vectors
    } catch (error) {
      this._warnEmbeddingOnce(`embedding endpoint failed; using lexical ranking (${error instanceof Error ? error.message : String(error)})`)
      return undefined
    }
  }

  private _warnEmbeddingOnce(message: string): void {
    if (this._warnedEmbedding) return
    this._warnedEmbedding = true
    this.warn(message)
  }

  private async _ensureReady(signal?: AbortSignal): Promise<void> {
    if (this._ready === undefined) {
      this._ready = (async () => {
        this._db = await openMemoryDatabase(this.config.path, this.config.journalMode)
      })()
      this._ready.catch(() => {
        this._ready = undefined
      })
    }
    await this._ready
    signal?.throwIfAborted()
  }

  private _serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this._tail.then(task, task)
    this._tail = next.then(() => undefined, () => undefined)
    return next
  }
}

function resolveConfig(config: Config): ResolvedConfig {
  return {
    path: config.path,
    openAt: config.openAt ?? 'startup',
    journalMode: config.journalMode ?? 'wal',
    defaultLimit: config.defaultLimit ?? MEMORY_SQLITE_DEFAULT_LIMIT,
    maxLimit: config.maxLimit ?? MEMORY_SQLITE_MAX_LIMIT,
    maxTextBytes: config.maxTextBytes ?? MEMORY_SQLITE_MAX_TEXT_BYTES,
    ...(config.embedding === undefined ? {} : { embedding: config.embedding }),
  }
}

/**
 * Fail loud at load when a deployment declares an `embedding` block but omits a field the
 * vector path cannot run without. Schemastery keeps these fields plain so the whole block
 * stays optional; this restores the "if present, then complete" contract.
 * @param embedding - the declared embedding configuration.
 */
function assertEmbedding(embedding: EmbeddingConfig): void {
  const missing: string[] = []
  if (typeof embedding.url !== 'string' || embedding.url.trim() === '') missing.push('url')
  if (typeof embedding.model !== 'string' || embedding.model.trim() === '') missing.push('model')
  if (typeof embedding.authEnv !== 'string' || embedding.authEnv.trim() === '') missing.push('authEnv')
  if (!Number.isInteger(embedding.dimension) || embedding.dimension < 1) missing.push('dimension')
  if (missing.length > 0) {
    throw new MemoryError(
      `memory-sqlite: config.embedding is set but ${missing.join(', ')} must be provided`,
      'MEMORY_INVALID_REQUEST',
    )
  }
}

/** Register the SQLite memory provider and tie its lifecycle to the plugin. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  if (resolved.embedding !== undefined) assertEmbedding(resolved.embedding)
  const embedder = resolved.embedding === undefined ? undefined : createHttpEmbedder(resolved.embedding)
  const provider = new SqliteMemoryProvider(resolved, embedder === undefined ? {} : { embedder })
  const unregister = ctx.memory.registerProvider(provider)
  if (resolved.openAt === 'startup') void provider.prime().catch(() => undefined)
  ctx.effect(() => async () => {
    unregister()
    await provider.close()
  }, 'memorySqlite.provider')
}

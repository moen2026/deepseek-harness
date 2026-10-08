/**
 * SQLite knowledge-base provider for `ctx.knowledge`. One plugin instance is configured with a
 * filesystem `path` for its derived store: `ingest` writes a canonical record plus an FTS5 row
 * over title and body, `search` ranks with BM25 and returns a bounded excerpt around the first
 * match, and `remove`/`list` delete and enumerate by recency. Registration with the seam is
 * effect-scoped: disposal unregisters the provider and closes the database.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-knowledge-sqlite
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  KnowledgeDraft,
  KnowledgeHit,
  KnowledgeListRequest,
  KnowledgePage,
  KnowledgeProvider,
  KnowledgeRecord,
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
} from '@deepseek-ai/dsh-knowledge'
import { KnowledgeError } from '@deepseek-ai/dsh-knowledge'
import { openKnowledgeDatabase, type JournalMode } from './schema.ts'
import {
  normalizeDraft,
  normalizeLimit,
  normalizeSearch,
  normalizeTags,
  sanitizeFtsText,
} from './query.ts'

export {
  KNOWLEDGE_SQLITE_APPLICATION_ID,
  KNOWLEDGE_SQLITE_SCHEMA_VERSION,
  type JournalMode,
} from './schema.ts'
export {
  normalizeDraft,
  normalizeLimit,
  normalizeQuery,
  normalizeSearch,
  normalizeTags,
  quoteFtsData,
  sanitizeFtsText,
  utf8Bytes,
} from './query.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'knowledge-sqlite'

/** Services required by this plugin. */
export const inject = ['knowledge']

/** Default result page size. */
export const KNOWLEDGE_SQLITE_DEFAULT_LIMIT = 10
/** Maximum accepted result page size and listing pool. */
export const KNOWLEDGE_SQLITE_MAX_LIMIT = 100
/** Default UTF-8 byte ceiling for a single document's body. */
export const KNOWLEDGE_SQLITE_MAX_TEXT_BYTES = 65_536
/** Default UTF-8 byte ceiling for a single document's title. */
export const KNOWLEDGE_SQLITE_MAX_TITLE_BYTES = 512

/** Knowledge-provider configuration. */
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
  /** UTF-8 byte ceiling for a single document's body. Defaults to 65536. */
  maxTextBytes?: number
  /** UTF-8 byte ceiling for a single document's title. Defaults to 512. */
  maxTitleBytes?: number
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  openAt: z.union(['startup', 'lazy'] as const).default('startup'),
  journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
  defaultLimit: z.number().step(1).min(1).max(KNOWLEDGE_SQLITE_MAX_LIMIT).default(KNOWLEDGE_SQLITE_DEFAULT_LIMIT),
  maxLimit: z.number().step(1).min(1).max(KNOWLEDGE_SQLITE_MAX_LIMIT).default(KNOWLEDGE_SQLITE_MAX_LIMIT),
  maxTextBytes: z.number().step(1).min(1).default(KNOWLEDGE_SQLITE_MAX_TEXT_BYTES),
  maxTitleBytes: z.number().step(1).min(1).default(KNOWLEDGE_SQLITE_MAX_TITLE_BYTES),
})

interface ResolvedConfig {
  path: string
  openAt: 'startup' | 'lazy'
  journalMode: JournalMode
  defaultLimit: number
  maxLimit: number
  maxTextBytes: number
  maxTitleBytes: number
}

/** A row read back from `knowledge_records` with its tags still JSON-encoded. */
type RecordRow = {
  id: string
  title: string
  text: string
  tags: string
  source: string | null
  created_at: string
}

function rowToRecord(row: RecordRow): KnowledgeRecord {
  const tags = JSON.parse(row.tags) as string[]
  return {
    id: row.id,
    title: row.title,
    text: row.text,
    tags,
    ...(row.source === null ? {} : { source: row.source }),
    createdAt: row.created_at,
  }
}

/** Build an `IN (?, ?, ...)` placeholder group for a non-empty id list. */
function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

/** Whether one loaded record carries every requested tag. */
function matchesTags(record: KnowledgeRecord, tags: readonly string[] | undefined): boolean {
  return (tags ?? []).every(tag => record.tags.includes(tag))
}

/**
 * A single-provider, node:sqlite FTS5 knowledge store. All work is serialized through one
 * open connection so ingests, searches, and closes never interleave.
 */
export class SqliteKnowledgeProvider implements KnowledgeProvider {
  readonly id = 'knowledge-sqlite'

  private readonly config: ResolvedConfig
  private _db: DatabaseSync | undefined
  private _ready: Promise<void> | undefined
  private _tail: Promise<void> = Promise.resolve()
  private _closed = false

  constructor(config: ResolvedConfig) {
    this.config = config
  }

  /**
   * Open the store once. Idempotent; a failed attempt is retried by the next caller.
   * @param signal aborts the open attempt if it fires before the store is ready
   */
  prime(signal?: AbortSignal): Promise<void> {
    return this._ensureReady(signal)
  }

  /* jscpd:ignore-start -- the single-connection serialization scaffolding intentionally
   * parallels dsh-memory-sqlite's; both derived stores keep exactly one open connection
   * per store so writes, reads, and closes never interleave. */

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
    if (db === undefined) throw new KnowledgeError('knowledge database is not open', 'KNOWLEDGE_UNAVAILABLE')
    return db
  }

  private async _ensureReady(signal?: AbortSignal): Promise<void> {
    if (this._ready === undefined) {
      this._ready = (async () => {
        this._db = await openKnowledgeDatabase(this.config.path, this.config.journalMode)
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

  /* jscpd:ignore-end */

  async ingest(draft: KnowledgeDraft, signal?: AbortSignal): Promise<string> {
    if (this._closed) throw new KnowledgeError('knowledge provider is disposed', 'KNOWLEDGE_DISPOSED')
    signal?.throwIfAborted()
    const normalized = normalizeDraft(draft, { maxTitleBytes: this.config.maxTitleBytes, maxTextBytes: this.config.maxTextBytes })
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    await this._serialize(async () => {
      await this._ensureReady(signal)
      const db = this.requireDb()
      db.exec('BEGIN')
      try {
        db.prepare('INSERT INTO knowledge_records (id, title, text, tags, source, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, normalized.title, normalized.text, JSON.stringify(normalized.tags), normalized.source ?? null, createdAt)
        db.prepare('INSERT INTO knowledge_docs (title, text, doc_id) VALUES (?, ?, ?)')
          .run(sanitizeFtsText(normalized.title), sanitizeFtsText(normalized.text), id)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    })
    return id
  }

  async search(request: KnowledgeSearchRequest, signal?: AbortSignal): Promise<KnowledgeSearchResult> {
    if (this._closed) throw new KnowledgeError('knowledge provider is disposed', 'KNOWLEDGE_DISPOSED')
    signal?.throwIfAborted()
    const normalized = normalizeSearch(request, { defaultLimit: this.config.defaultLimit, maxLimit: this.config.maxLimit })
    return this._serialize(async () => {
      await this._ensureReady(signal)
      const db = this.requireDb()
      const pool = db.prepare(`
        SELECT doc_id AS id, -bm25(knowledge_docs) AS score, snippet(knowledge_docs, 1, '', '', '…', 24) AS snippet
        FROM knowledge_docs
        WHERE knowledge_docs MATCH ?
        ORDER BY bm25(knowledge_docs)
        LIMIT ?
      `).all(normalized.match, normalized.pool) as Array<{ id: string; score: number; snippet: string }>
      if (pool.length === 0) return { hits: [] }

      const ids = pool.map(row => row.id)
      const rows = db.prepare(
        `SELECT id, title, text, tags, source, created_at FROM knowledge_records WHERE id IN (${placeholders(ids.length)})`,
      ).all(...ids) as RecordRow[]
      const byId = new Map(rows.map((row) => {
        const record = rowToRecord(row)
        return [record.id, record] as const
      }))
      const scoreOf = new Map(pool.map(row => [row.id, row.score]))
      const snippetOf = new Map(pool.map(row => [row.id, row.snippet]))
      // Keep lexical order, dropping records deleted mid-flight or failing the tag filter.
      const hits: KnowledgeHit[] = ids
        .filter(id => byId.has(id) && matchesTags(byId.get(id) as KnowledgeRecord, normalized.tags))
        .slice(0, normalized.limit)
        .map(id => ({ record: byId.get(id) as KnowledgeRecord, score: scoreOf.get(id) ?? 0, snippet: snippetOf.get(id) ?? '' }))
      return { hits }
    })
  }

  async remove(id: string, signal?: AbortSignal): Promise<boolean> {
    if (this._closed) throw new KnowledgeError('knowledge provider is disposed', 'KNOWLEDGE_DISPOSED')
    signal?.throwIfAborted()
    return this._serialize(async () => {
      await this._ensureReady(signal)
      const db = this.requireDb()
      const removed = db.prepare('DELETE FROM knowledge_records WHERE id = ?').run(id).changes > 0
      db.prepare('DELETE FROM knowledge_docs WHERE doc_id = ?').run(id)
      return removed
    })
  }

  async list(request?: KnowledgeListRequest, signal?: AbortSignal): Promise<KnowledgePage> {
    if (this._closed) throw new KnowledgeError('knowledge provider is disposed', 'KNOWLEDGE_DISPOSED')
    signal?.throwIfAborted()
    return this._serialize(async () => {
      await this._ensureReady(signal)
      const db = this.requireDb()
      const limit = normalizeLimit(request?.limit, this.config.defaultLimit, this.config.maxLimit)
      const tags = normalizeTags(request?.tags)
      const rows = db.prepare(`
        SELECT id, title, text, tags, source, created_at FROM knowledge_records
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `).all(this.config.maxLimit) as RecordRow[]
      const records = rows
        .map(rowToRecord)
        .filter(record => matchesTags(record, tags))
        .slice(0, limit)
      return { records }
    })
  }
}

function resolveConfig(config: Config): ResolvedConfig {
  return {
    path: config.path,
    openAt: config.openAt ?? 'startup',
    journalMode: config.journalMode ?? 'wal',
    defaultLimit: config.defaultLimit ?? KNOWLEDGE_SQLITE_DEFAULT_LIMIT,
    maxLimit: config.maxLimit ?? KNOWLEDGE_SQLITE_MAX_LIMIT,
    maxTextBytes: config.maxTextBytes ?? KNOWLEDGE_SQLITE_MAX_TEXT_BYTES,
    maxTitleBytes: config.maxTitleBytes ?? KNOWLEDGE_SQLITE_MAX_TITLE_BYTES,
  }
}

/** Register the SQLite knowledge provider and tie its lifecycle to the plugin. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const provider = new SqliteKnowledgeProvider(resolved)
  const unregister = ctx.knowledge.registerProvider(provider)
  if (resolved.openAt === 'startup') void provider.prime().catch(() => undefined)
  ctx.effect(() => async () => {
    unregister()
    await provider.close()
  }, 'knowledgeSqlite.provider')
}

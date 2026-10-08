/**
 * Hybrid code-index provider for `ctx.codeIndex`. One plugin instance is configured with a
 * derived-index `path`, a workspace `root`, and an optional deployment-supplied embeddings
 * endpoint. On first search (or eagerly at startup) it walks `root`, packs each text file
 * into block-aware chunks (block boundaries are never cut mid-block), writes an FTS5 table
 * keyed by relative path, and — when the endpoint is configured — stores one float32 vector
 * per chunk. A normalized query ranks BM25 and, when vectors exist, endpoint embeddings,
 * fused by reciprocal-rank fusion into snippet-rendered hits; an endpoint failure degrades
 * to the lexical path with a warning at most once per provider. The corpus is private — the
 * provider publishes no index-building surface; the seam exposes only `search`.
 * @module @deepseek-ai/dsh-code-index-hybrid
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CodeIndexProvider, CodeSearchPage, CodeSearchRequest, CodeSearchHit } from '@deepseek-ai/dsh-code-index'
import { CodeIndexError } from '@deepseek-ai/dsh-code-index'
import {
  BINARY_EXTENSIONS,
  DEFAULT_SKIP_DIRS,
  FTS_HIGHLIGHT_END,
  FTS_HIGHLIGHT_START,
  LANGUAGE_BY_EXTENSION,
  fuseOrder,
  globToRegExp,
  makeSnippet,
  normalizeSearch,
  reciprocalRankFusion,
  type NormalizedSearch,
} from '@deepseek-ai/dsh-code-index-sqlite'
import { createHttpEmbedder, type Embedder, type EmbeddingConfig } from '@deepseek-ai/dsh-memory-sqlite'
import { chunkFile } from './chunk.ts'
import { openHybridIndexDatabase, type JournalMode } from './schema.ts'

export { CODE_INDEX_HYBRID_APPLICATION_ID, CODE_INDEX_HYBRID_SCHEMA_VERSION, type JournalMode } from './schema.ts'
export { chunkFile, type ChunkedBlock } from './chunk.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'code-index-hybrid'

/** Services required by this plugin. */
export const inject = ['codeIndex']

/** Smallest BM25 and semantic candidate pool a fused search considers. */
export const CODE_INDEX_HYBRID_SEMANTIC_POOL = 60

/** Default result page size. */
export const CODE_INDEX_HYBRID_DEFAULT_LIMIT = 20
/** Maximum accepted result page size. */
export const CODE_INDEX_HYBRID_MAX_LIMIT = 200
/** Default snippet length in Unicode code points. */
export const CODE_INDEX_HYBRID_SNIPPET_CHARS = 240
/** Default target lines per indexed chunk. */
export const CODE_INDEX_HYBRID_CHUNK_LINES = 40
/** Default trailing lines the next chunk re-opens. */
export const CODE_INDEX_HYBRID_CHUNK_OVERLAP = 4
/** Default per-file size ceiling. */
export const CODE_INDEX_HYBRID_MAX_FILE_BYTES = 1_000_000
/** Default total file ceiling per index build. */
export const CODE_INDEX_HYBRID_MAX_FILES = 20_000

/** Combined hybrid code-index configuration. */
export interface Config {
  /** Dedicated derived-index path; `:memory:` is supported. Missing paths are created owner-only. */
  path: string
  /** Absolute workspace root to walk and index. */
  root: string
  /** Open the database at startup or the first search. Defaults to `startup`. */
  openAt?: 'startup' | 'first-search'
  /** SQLite journal mode. Defaults to `wal`. */
  journalMode?: JournalMode
  /** Result page size when a request omits `limit`. Defaults to 20. */
  defaultLimit?: number
  /** Largest accepted page size. Defaults to 200. */
  maxLimit?: number
  /** Maximum snippet length in Unicode code points. Defaults to 240. */
  snippetChars?: number
  /** Target lines per indexed chunk. Defaults to 40. */
  chunkLines?: number
  /** Trailing lines the next chunk re-opens. Defaults to 4. */
  chunkOverlap?: number
  /** Per-file size ceiling in bytes. Defaults to 1000000. */
  maxFileBytes?: number
  /** Total file ceiling per index build. Defaults to 20000. */
  maxFiles?: number
  /** Directory names always skipped in addition to the built-in set. */
  skipDirs?: string[]
  /** Glob patterns (`*`/`?`) restricting which relative paths are indexed when non-empty. */
  includeGlobs?: string[]
  /** Glob patterns (`*`/`?`) excluding relative paths from indexing. */
  excludeGlobs?: string[]
  /**
   * Deployment-supplied embeddings endpoint enabling the vector path. DSH never selects a
   * model or provider; source text from the indexed workspace is sent to this endpoint, so
   * point it only at a service trusted with that source. Absent means lexical only.
   */
  embedding?: EmbeddingConfig
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  root: z.string().required(),
  openAt: z.union(['startup', 'first-search'] as const).default('startup'),
  journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
  defaultLimit: z.number().step(1).min(1).max(CODE_INDEX_HYBRID_MAX_LIMIT).default(CODE_INDEX_HYBRID_DEFAULT_LIMIT),
  maxLimit: z.number().step(1).min(1).max(CODE_INDEX_HYBRID_MAX_LIMIT).default(CODE_INDEX_HYBRID_MAX_LIMIT),
  snippetChars: z.number().step(1).min(1).default(CODE_INDEX_HYBRID_SNIPPET_CHARS),
  chunkLines: z.number().step(1).min(1).default(CODE_INDEX_HYBRID_CHUNK_LINES),
  chunkOverlap: z.number().step(1).min(0).default(CODE_INDEX_HYBRID_CHUNK_OVERLAP),
  maxFileBytes: z.number().step(1).min(1).default(CODE_INDEX_HYBRID_MAX_FILE_BYTES),
  maxFiles: z.number().step(1).min(1).default(CODE_INDEX_HYBRID_MAX_FILES),
  skipDirs: z.array(z.string()).default([]),
  includeGlobs: z.array(z.string()).default([]),
  excludeGlobs: z.array(z.string()).default([]),
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
  root: string
  openAt: 'startup' | 'first-search'
  journalMode: JournalMode
  defaultLimit: number
  maxLimit: number
  snippetChars: number
  chunkLines: number
  chunkOverlap: number
  maxFileBytes: number
  maxFiles: number
  skipDirs: Set<string>
  includeMatchers: RegExp[]
  excludeMatchers: RegExp[]
  embedding: EmbeddingConfig | undefined
}

/** One file on disk, relative to the root with forward-slash separators. */
interface ScannedFile {
  path: string
  absolute: string
  size: number
  mtimeMs: number
  language?: string
}

/** One chunk staged for embedding during a reconcile. */
interface PendingChunk {
  rowid: number
  text: string
}

function resolveConfig(config: Config): ResolvedConfig {
  const embedding = config.embedding
  if (embedding !== undefined && (embedding.url.trim() === '' || embedding.model.trim() === '' || embedding.authEnv.trim() === '')) {
    throw new Error('config.embedding is set but url, model, authEnv must be provided')
  }
  return {
    path: config.path,
    root: config.root,
    openAt: config.openAt ?? 'startup',
    journalMode: config.journalMode ?? 'wal',
    defaultLimit: config.defaultLimit ?? CODE_INDEX_HYBRID_DEFAULT_LIMIT,
    maxLimit: config.maxLimit ?? CODE_INDEX_HYBRID_MAX_LIMIT,
    snippetChars: config.snippetChars ?? CODE_INDEX_HYBRID_SNIPPET_CHARS,
    chunkLines: config.chunkLines ?? CODE_INDEX_HYBRID_CHUNK_LINES,
    chunkOverlap: config.chunkOverlap ?? CODE_INDEX_HYBRID_CHUNK_OVERLAP,
    maxFileBytes: config.maxFileBytes ?? CODE_INDEX_HYBRID_MAX_FILE_BYTES,
    maxFiles: config.maxFiles ?? CODE_INDEX_HYBRID_MAX_FILES,
    skipDirs: new Set(config.skipDirs ?? []),
    includeMatchers: (config.includeGlobs ?? []).map(globToRegExp),
    excludeMatchers: (config.excludeGlobs ?? []).map(globToRegExp),
    embedding,
  }
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot).toLowerCase()
}

/** Encode a float32 vector as a little-endian-order BLOB for `code_vec`. */
function encodeFloat32Vector(vector: readonly number[]): Uint8Array {
  const floats = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i += 1) floats[i] = vector[i] as number
  return new Uint8Array(floats.buffer.slice(0))
}

/** Decode a stored float32 BLOB back into its components. */
function decodeFloat32Vector(bytes: Uint8Array): Float32Array {
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

/** Cosine similarity between two equal-length float32 vectors; `0` when either has no energy. */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
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
 * A single-provider hybrid code index. All work is serialized through one open
 * connection; the first search reconciles the corpus with the filesystem.
 */
export class HybridCodeIndexProvider implements CodeIndexProvider {
  readonly id = 'code-index-hybrid'

  private readonly config: ResolvedConfig
  private readonly embedder: Embedder | undefined
  private _db: DatabaseSync | undefined
  private _ready: Promise<void> | undefined
  private _tail: Promise<void> = Promise.resolve()
  private _closed = false
  private _warnedEmbedding = false

  /**
   * @param config - the resolved plugin configuration.
   * @param embedder - injectable text-to-vector function overriding the configured HTTP endpoint; tests use this seam.
   */
  constructor(config: ResolvedConfig, embedder?: Embedder) {
    this.config = config
    this.embedder = embedder ?? (config.embedding === undefined ? undefined : createHttpEmbedder(config.embedding))
  }

  /**
   * Open and reconcile the index once. Idempotent and safe to await from multiple
   * callers; a failed attempt is retried by the next caller.
   * @param signal - cancellation honored during the initial reconcile.
   */
  prime(signal?: AbortSignal): Promise<void> {
    return this._ensureReady(signal)
  }

  async search(request: CodeSearchRequest, signal?: AbortSignal): Promise<CodeSearchPage> {
    if (this._closed) throw new CodeIndexError('code-index provider is disposed', 'CODE_INDEX_DISPOSED')
    signal?.throwIfAborted()
    return this._serialize(async () => {
      await this._ensureReady(signal)
      const db = this._db
      /* v8 ignore next -- _ensureReady above either assigned this handle or rejected; defensive. */
      if (db === undefined) throw new CodeIndexError('code-index database is not open', 'CODE_INDEX_UNAVAILABLE')
      const normalized = normalizeSearch(request, { defaultLimit: this.config.defaultLimit, maxLimit: this.config.maxLimit })
      const clauses: string[] = ['code_docs MATCH ?']
      const params: Array<string | number> = [normalized.match]
      if (normalized.pathLike !== undefined) {
        clauses.push("replace(code_docs.path, '\\', '/') LIKE ? ESCAPE '\\'")
        params.push(normalized.pathLike)
      }
      if (normalized.language !== undefined) {
        clauses.push('code_docs.language = ?')
        params.push(normalized.language)
      }
      if (this.embedder === undefined) return this._lexicalPage(db, normalized, clauses, params)
      return this._fusedPage(db, normalized, request.query, signal, clauses, params)
    })
  }

  /** Rank one search by BM25 alone; the shape every fused search degrades to. */
  private _lexicalPage(
    db: DatabaseSync,
    normalized: NormalizedSearch,
    clauses: readonly string[],
    params: readonly (string | number)[],
  ): CodeSearchPage {
    const rows = db.prepare(`
      SELECT
        code_docs.path AS path,
        code_docs.start_line AS start_line,
        code_docs.end_line AS end_line,
        code_docs.language AS language,
        -bm25(code_docs) AS score,
        snippet(code_docs, 0, ?, ?, '...', 16) AS marked
      FROM code_docs
      WHERE ${clauses.join(' AND ')}
      ORDER BY bm25(code_docs)
      LIMIT ?
    `).all(FTS_HIGHLIGHT_START, FTS_HIGHLIGHT_END, ...params, normalized.limit) as Array<{
      path: string
      start_line: number
      end_line: number
      language: string | null
      score: number
      marked: string
    }>
    const hits: CodeSearchHit[] = rows.map(row => ({
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      ...(row.language === null ? {} : { language: row.language }),
      score: row.score,
      snippet: makeSnippet(row.marked, this.config.snippetChars),
    }))
    return { hits }
  }

  /**
   * Rank one search by fusing the BM25 ordering with endpoint-embedding similarity over
   * stored float32 vectors, using reciprocal-rank fusion; semantic-only matches (BM25
   * recalls nothing) are added to the page. An embedding failure degrades to the lexical
   * page with a warning at most once per provider.
   */
  private async _fusedPage(
    db: DatabaseSync,
    normalized: NormalizedSearch,
    rawQuery: string,
    signal: AbortSignal | undefined,
    clauses: readonly string[],
    params: readonly (string | number)[],
  ): Promise<CodeSearchPage> {
    const queryVector = await this._queryVector(rawQuery, signal)
    if (queryVector === undefined) return this._lexicalPage(db, normalized, clauses, params)
    const pool = Math.max(normalized.limit * 4, CODE_INDEX_HYBRID_SEMANTIC_POOL)
    const lexicalRows = db.prepare(`
      SELECT
        code_docs.rowid AS rowid,
        code_docs.path AS path,
        code_docs.start_line AS start_line,
        code_docs.end_line AS end_line,
        code_docs.language AS language,
        -bm25(code_docs) AS score,
        snippet(code_docs, 0, ?, ?, '...', 16) AS marked
      FROM code_docs
      WHERE ${clauses.join(' AND ')}
      ORDER BY bm25(code_docs)
      LIMIT ?
    `).all(FTS_HIGHLIGHT_START, FTS_HIGHLIGHT_END, ...params, pool) as Array<{
      rowid: number
      path: string
      start_line: number
      end_line: number
      language: string | null
      score: number
      marked: string
    }>
    const byRowid = new Map<number, {
      path: string
      startLine: number
      endLine: number
      language: string | null
      snippet: string
    }>()
    const lexicalRanking: number[] = []
    for (const row of lexicalRows) {
      lexicalRanking.push(row.rowid)
      byRowid.set(row.rowid, {
        path: row.path,
        startLine: row.start_line,
        endLine: row.end_line,
        language: row.language,
        snippet: makeSnippet(row.marked, this.config.snippetChars),
      })
    }
    // The semantic scan covers every vector-bearing chunk under the path/language
    // refinements only — never the MATCH expression, whose hit set is what fusion is
    // supposed to broaden. Vectors of a foreign dimension (a changed
    // `config.embedding.dimension`) cannot be compared and are skipped.
    const filters: string[] = []
    const filterParams: (string | number)[] = []
    if (normalized.pathLike !== undefined) {
      filters.push("replace(code_docs.path, '\\', '/') LIKE ? ESCAPE '\\'")
      filterParams.push(normalized.pathLike)
    }
    if (normalized.language !== undefined) {
      filters.push('code_docs.language = ?')
      filterParams.push(normalized.language)
    }
    const semanticRows = db.prepare(`
      SELECT code_docs.rowid AS rowid, code_vec.vec AS vec
      FROM code_docs
      JOIN code_vec ON code_vec.rowid = code_docs.rowid
      WHERE code_vec.dim = ?${filters.length > 0 ? ` AND ${filters.join(' AND ')}` : ''}
    `).all(queryVector.length, ...filterParams) as Array<{ rowid: number; vec: Uint8Array }>
    const scored: Array<{ rowid: number; similarity: number }> = []
    for (const row of semanticRows) {
      const similarity = cosineSimilarity(queryVector, decodeFloat32Vector(row.vec))
      if (similarity > 0) scored.push({ rowid: row.rowid, similarity })
    }
    scored.sort((left, right) => right.similarity - left.similarity)
    const semanticRanking = scored.slice(0, pool).map(entry => entry.rowid)
    const fusedScores = reciprocalRankFusion([lexicalRanking, semanticRanking])
    const fused = fuseOrder(fusedScores, lexicalRanking).slice(0, normalized.limit)
    const fetchMeta = db.prepare('SELECT path, start_line, end_line, language, text FROM code_docs WHERE rowid = ?')
    const hits: CodeSearchHit[] = []
    for (const rowid of fused) {
      const base = byRowid.get(rowid)
      if (base !== undefined) {
        hits.push({
          path: base.path,
          startLine: base.startLine,
          endLine: base.endLine,
          ...(base.language === null ? {} : { language: base.language }),
          score: fusedScores.get(rowid) as number,
          snippet: base.snippet,
        })
        continue
      }
      const row = fetchMeta.get(rowid) as {
        path: string
        start_line: number
        end_line: number
        language: string | null
        text: string
      }
      hits.push({
        path: row.path,
        startLine: row.start_line,
        endLine: row.end_line,
        ...(row.language === null ? {} : { language: row.language }),
        score: fusedScores.get(rowid) as number,
        snippet: makeSnippet(row.text, this.config.snippetChars),
      })
    }
    return { hits }
  }

  /** Embed the caller query, or return `undefined` after a warn-once endpoint failure. */
  private async _queryVector(rawQuery: string, signal: AbortSignal | undefined): Promise<Float32Array | undefined> {
    if (this.embedder === undefined) return undefined
    try {
      const [vector] = await this.embedder.embed([rawQuery], signal)
      if (vector === undefined) return undefined
      return new Float32Array(vector)
    } catch (error: unknown) {
      this._warnEmbedding(error)
      return undefined
    }
  }

  /** Degrade to lexical with one warning per provider; never name the credential. */
  private _warnEmbedding(error: unknown): void {
    if (this._warnedEmbedding) return
    this._warnedEmbedding = true
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`code-index-hybrid: embedding endpoint unavailable, continuing lexical-only (${message})`)
  }

  /** Close the derived database. Safe to call more than once. */
  async close(): Promise<void> {
    if (this._closed) return
    this._closed = true
    /* v8 ignore next -- _tail always settles through a both-outcome handler, so it cannot reject; defensive. */
    await this._tail.catch(() => undefined)
    this._db?.close()
    this._db = undefined
  }

  private async _ensureReady(signal?: AbortSignal): Promise<void> {
    if (this._ready === undefined) {
      this._ready = (async () => {
        this._db = await openHybridIndexDatabase(this.config.path, this.config.journalMode)
        await this._reindex(signal)
      })()
      this._ready.catch(() => {
        this._ready = undefined
      })
    }
    await this._ready
  }

  private _serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this._tail.then(task, task)
    this._tail = next.then(() => undefined, () => undefined)
    return next
  }

  /** Reconcile the corpus with the filesystem, embedding only newly chunked text. */
  private async _reindex(signal?: AbortSignal): Promise<void> {
    const db = this._db
    /* v8 ignore next -- callers reach this only right after the open assigned the handle; defensive. */
    if (db === undefined) return
    signal?.throwIfAborted()
    const scanned = this._scan()
    const existing = new Map<string, { size: number; mtime: number }>()
    for (const row of db.prepare('SELECT path, size, mtime FROM code_files').all() as Array<{ path: string; size: number; mtime: number }>) {
      existing.set(row.path, { size: row.size, mtime: row.mtime })
    }
    const live = new Set<string>()
    const upsert = db.prepare(
      'INSERT INTO code_files (path, size, mtime, language, generation) VALUES (?, ?, ?, ?, ?)',
    )
    const deleteChunks = db.prepare('DELETE FROM code_docs WHERE path = ?')
    const deleteVectors = db.prepare('DELETE FROM code_vec WHERE rowid IN (SELECT rowid FROM code_docs WHERE path = ?)')
    const deleteFile = db.prepare('DELETE FROM code_files WHERE path = ?')
    const insertChunk = db.prepare(
      'INSERT INTO code_docs (text, path, start_line, end_line, language) VALUES (?, ?, ?, ?, ?)',
    )
    const generation = (db.prepare('SELECT global_generation FROM index_state WHERE singleton = 1').get() as { global_generation: number }).global_generation + 1

    const pending: PendingChunk[] = []
    for (const file of scanned) {
      live.add(file.path)
      const prior = existing.get(file.path)
      if (prior !== undefined && prior.size === file.size && prior.mtime === file.mtimeMs) continue
      // Vectors are keyed by chunk rowid, so they must go before the chunk rows they derive from.
      deleteVectors.run(file.path)
      deleteChunks.run(file.path)
      db.prepare('DELETE FROM code_files WHERE path = ?').run(file.path)
      const text = this._readText(file)
      if (text === undefined) continue
      upsert.run(file.path, file.size, file.mtimeMs, file.language ?? null, generation)
      for (const chunk of chunkFile(text, this.config.chunkLines, this.config.chunkOverlap)) {
        const inserted = insertChunk.run(
          sanitize(chunk.text),
          file.path,
          chunk.startLine,
          chunk.endLine,
          file.language ?? null,
        )
        if (this.embedder !== undefined) pending.push({ rowid: Number(inserted.lastInsertRowid), text: chunk.text })
      }
    }
    for (const path of existing.keys()) {
      if (live.has(path)) continue
      deleteVectors.run(path)
      deleteChunks.run(path)
      deleteFile.run(path)
    }
    await this._embedPending(db, pending, signal)
    db.prepare('UPDATE index_state SET global_generation = ? WHERE singleton = 1').run(generation)
  }

  /** Embed staged chunks and store one float32 vector per chunk; failures keep the lexical corpus. */
  private async _embedPending(db: DatabaseSync, pending: readonly PendingChunk[], signal?: AbortSignal): Promise<void> {
    if (this.embedder === undefined || pending.length === 0) return
    const insertVector = db.prepare('INSERT INTO code_vec (rowid, vec, dim) VALUES (?, ?, ?)')
    try {
      const vectors = await this.embedder.embed(pending.map(chunk => chunk.text), signal)
      if (vectors.length !== pending.length) {
        throw new Error(`embedding endpoint returned ${vectors.length} vectors for ${pending.length} inputs`)
      }
      vectors.forEach((vector, index) => {
        const chunk = pending[index] as PendingChunk
        insertVector.run(chunk.rowid, encodeFloat32Vector(vector), vector.length)
      })
    } catch (error: unknown) {
      this._warnEmbedding(error)
    }
  }

  /** Read one file as UTF-8 text, skipping binary content by a NUL marker in the head window. */
  private _readText(file: ScannedFile): string | undefined {
    try {
      const buffer = readFileSync(file.absolute)
      const head = buffer.subarray(0, Math.min(buffer.length, 8000))
      if (head.includes(0)) return undefined
      return buffer.toString('utf8')
    } catch {
      /* v8 ignore next -- a read failure needs an external filesystem race between scan and read. */
      return undefined
    }
  }

  private _scan(): ScannedFile[] {
    const root = resolve(this.config.root)
    const results: ScannedFile[] = []
    const stack: string[] = [root]
    const skip = this.config.skipDirs
    while (stack.length > 0) {
      const dir = stack.pop() as string
      let entries: Dirent[]
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        /* v8 ignore next -- an unreadable directory needs an external permission or deletion race. */
        continue
      }
      for (const entry of entries) {
        if (results.length >= this.config.maxFiles) return results
        const absolute = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (skip.has(entry.name) || DEFAULT_SKIP_DIRS.has(entry.name)) continue
          stack.push(absolute)
          continue
        }
        /* v8 ignore next -- a dirent that is neither file nor directory cannot be built portably; defensive. */
        if (!entry.isFile()) continue
        const rel = relative(root, absolute).split(sep).join('/')
        if (!this._shouldIndex(rel)) continue
        let stats
        try {
          stats = statSync(absolute)
        } catch {
          /* v8 ignore next -- a stat failure needs an external filesystem race after the dirent was read. */
          continue
        }
        if (stats.size > this.config.maxFileBytes) continue
        const extension = extensionOf(rel)
        if (BINARY_EXTENSIONS.has(extension)) continue
        const language = LANGUAGE_BY_EXTENSION[extension]
        results.push({ path: rel, absolute, size: stats.size, mtimeMs: stats.mtimeMs, ...(language === undefined ? {} : { language }) })
      }
    }
    return results
  }

  private _shouldIndex(rel: string): boolean {
    for (const matcher of this.config.excludeMatchers) if (matcher.test(rel)) return false
    if (this.config.includeMatchers.length === 0) return true
    return this.config.includeMatchers.some(matcher => matcher.test(rel))
  }
}

/** Reserved FTS5 highlight markers must never enter indexed text. */
function sanitize(text: string): string {
  return text
    .replaceAll('\0', '\uFFFD')
    .replaceAll(FTS_HIGHLIGHT_START, '\uFFFD')
    .replaceAll(FTS_HIGHLIGHT_END, '\uFFFD')
}

/** Register the hybrid code-index provider and tie its lifecycle to the plugin. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const provider = new HybridCodeIndexProvider(resolved)
  const unregister = ctx.codeIndex.registerProvider(provider)
  if (resolved.openAt === 'startup') void provider.prime().catch(() => undefined)
  ctx.effect(() => async () => {
    unregister()
    await provider.close()
  }, 'codeIndexHybrid.provider')
}

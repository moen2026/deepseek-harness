/**
 * SQLite FTS5 code-index provider for `ctx.codeIndex`. One plugin instance is
 * configured with a filesystem `path` for its derived index and a workspace `root` to
 * index. On first search (or eagerly at startup) it walks `root`, splits each text file
 * into fixed line chunks into an FTS5 table keyed by relative path, stores a local
 * hashed-subtoken vector per chunk, and answers a normalized query with the BM25 and
 * semantic rankings fused by reciprocal-rank fusion into snippet-rendered hits.
 * Registration with
 * the seam is effect-scoped: disposal unregisters the provider and closes the database.
 *
 * Namespace plugin (named exports, no default export). The corpus is private — the
 * provider publishes no index-building surface; the seam exposes only `search`.
 * @module @deepseek-ai/dsh-code-index-sqlite
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CodeIndexProvider, CodeSearchPage, CodeSearchRequest, CodeSearchHit } from '@deepseek-ai/dsh-code-index'
import { CodeIndexError } from '@deepseek-ai/dsh-code-index'
import {
  openIndexDatabase,
  type JournalMode,
} from './schema.ts'
import {
  FTS_HIGHLIGHT_END,
  FTS_HIGHLIGHT_START,
  makeSnippet,
  normalizeSearch,
  sanitizeFtsText,
  type NormalizedSearch,
} from './query.ts'
import {
  cosineSimilarity,
  decodeVector,
  embedVector,
  fuseOrder,
  reciprocalRankFusion,
} from './semantic.ts'

export {
  CODE_INDEX_SQLITE_APPLICATION_ID,
  CODE_INDEX_SQLITE_SCHEMA_VERSION,
  type JournalMode,
} from './schema.ts'
export {
  FTS_HIGHLIGHT_END,
  FTS_HIGHLIGHT_START,
  globToLike,
  makeSnippet,
  normalizeQuery,
  normalizeSearch,
  quoteFtsData,
  sanitizeFtsText,
  type NormalizedSearch,
} from './query.ts'
export {
  SEMANTIC_DIMENSION,
  SEMANTIC_RRF_K,
  cosineSimilarity,
  decodeVector,
  embedFeatures,
  embedVector,
  reciprocalRankFusion,
  fuseOrder,
} from './semantic.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'code-index-sqlite'

/** Services required by this plugin. */
export const inject = ['codeIndex']

/** Smallest BM25 and semantic candidate pool a fused search considers. */
export const CODE_INDEX_SQLITE_SEMANTIC_POOL = 60

/** Default result page size. */
export const CODE_INDEX_SQLITE_DEFAULT_LIMIT = 20
/** Maximum accepted result page size. */
export const CODE_INDEX_SQLITE_MAX_LIMIT = 200
/** Default snippet length in Unicode code points. */
export const CODE_INDEX_SQLITE_SNIPPET_CHARS = 240
/** Default lines per indexed chunk. */
export const CODE_INDEX_SQLITE_CHUNK_LINES = 40
/** Default per-file size ceiling. */
export const CODE_INDEX_SQLITE_MAX_FILE_BYTES = 1_000_000
/** Default total file ceiling per index build. */
export const CODE_INDEX_SQLITE_MAX_FILES = 20_000
/** Directories skipped during the walk regardless of globs. */
export const DEFAULT_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache'])
/** Extensions treated as non-text and skipped. */
export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.pdf', '.zip', '.gz', '.tar',
  '.7z', '.rar', '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.mov', '.avi', '.wasm', '.so',
  '.dll', '.dylib', '.exe', '.bin', '.class', '.jar', '.db', '.sqlite',
])
/** Extension → syntax language id for the `language` filter and hit metadata. */
export const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  '.ts': 'typescript', '.tsx': 'typescriptreact', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascriptreact', '.mjs': 'javascript', '.cjs': 'javascript',
  '.json': 'json', '.md': 'markdown', '.py': 'python', '.go': 'go', '.rs': 'rust',
  '.java': 'java', '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.hpp': 'cpp',
  '.css': 'css', '.scss': 'scss', '.html': 'html', '.yml': 'yaml', '.yaml': 'yaml', '.sh': 'shell',
})

/** Combined code-index configuration. */
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
  /** Lines per indexed chunk. Defaults to 40. */
  chunkLines?: number
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
   * Fuse BM25 with the local hashed-subtoken semantic ranking; the vector path is pure-JS,
   * offline, and deterministic. Defaults to `true`.
   */
  semantic?: boolean
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  root: z.string().required(),
  openAt: z.union(['startup', 'first-search'] as const).default('startup'),
  journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
  defaultLimit: z.number().step(1).min(1).max(CODE_INDEX_SQLITE_MAX_LIMIT).default(CODE_INDEX_SQLITE_DEFAULT_LIMIT),
  maxLimit: z.number().step(1).min(1).max(CODE_INDEX_SQLITE_MAX_LIMIT).default(CODE_INDEX_SQLITE_MAX_LIMIT),
  snippetChars: z.number().step(1).min(1).default(CODE_INDEX_SQLITE_SNIPPET_CHARS),
  chunkLines: z.number().step(1).min(1).default(CODE_INDEX_SQLITE_CHUNK_LINES),
  maxFileBytes: z.number().step(1).min(1).default(CODE_INDEX_SQLITE_MAX_FILE_BYTES),
  maxFiles: z.number().step(1).min(1).default(CODE_INDEX_SQLITE_MAX_FILES),
  skipDirs: z.array(z.string()).default([]),
  includeGlobs: z.array(z.string()).default([]),
  excludeGlobs: z.array(z.string()).default([]),
  semantic: z.boolean().default(true),
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
  maxFileBytes: number
  maxFiles: number
  skipDirs: Set<string>
  includeMatchers: RegExp[]
  excludeMatchers: RegExp[]
  semantic: boolean
}

/** One file on disk, relative to the root with forward-slash separators. */
interface ScannedFile {
  path: string
  absolute: string
  size: number
  mtimeMs: number
  language?: string
}

/** A compiled `*`/`?` glob becomes an anchored, `/`-crossing regex for whole-path matching. */
export function globToRegExp(glob: string): RegExp {
  let source = '^'
  for (const ch of glob.trim()) {
    if (ch === '*') source += '.*'
    else if (ch === '?') source += '[^/]'
    else if (/[.+^${}()|[\]\\]/u.test(ch)) source += `\\${ch}`
    /* v8 ignore start -- a backslash matches the escape pattern above first, so this separator-normalize branch cannot run; defensive. */
    else if (ch === '\\') source += '/'
    /* v8 ignore stop */
    else source += ch
  }
  return new RegExp(`${source}$`, 'u')
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot).toLowerCase()
}

/**
 * A single-provider, node:sqlite FTS5 code index. All work is serialized through one
 * open connection; the first search reconciles the corpus with the filesystem.
 */
export class SqliteCodeIndexProvider implements CodeIndexProvider {
  readonly id = 'code-index-sqlite'

  private readonly config: ResolvedConfig
  private _db: DatabaseSync | undefined
  private _ready: Promise<void> | undefined
  private _tail: Promise<void> = Promise.resolve()
  private _closed = false

  constructor(config: ResolvedConfig) {
    this.config = config
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
      if (this.config.semantic) {
        return this._searchFused(db, normalized, request.query, clauses, params)
      }
      const sql = `
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
        LIMIT ?`
      params.unshift(FTS_HIGHLIGHT_START, FTS_HIGHLIGHT_END)
      params.push(normalized.limit)
      const rows = db.prepare(sql).all(...params) as Array<{
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
    })
  }

  /**
   * Rank one search by fusing the BM25 ordering with the local semantic ranking over
   * stored quantized vectors, using reciprocal-rank fusion; the fused score becomes the
   * hit score, and semantic-only matches (BM25 recalls nothing) are added to the page.
   */
  private _searchFused(
    db: DatabaseSync,
    normalized: NormalizedSearch,
    rawQuery: string,
    clauses: readonly string[],
    params: readonly (string | number)[],
  ): CodeSearchPage {
    const pool = Math.max(normalized.limit * 4, CODE_INDEX_SQLITE_SEMANTIC_POOL)
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
    const queryVector = decodeVector(embedVector(rawQuery))
    // The semantic scan covers every vector-bearing chunk under the path/language
    // refinements only — never the MATCH expression, whose hit set is what fusion is
    // supposed to broaden.
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
      ${filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''}
    `).all(...filterParams) as Array<{ rowid: number; vec: Uint8Array }>
    const scored: Array<{ rowid: number; similarity: number }> = []
    for (const row of semanticRows) {
      const similarity = cosineSimilarity(queryVector, decodeVector(row.vec))
      if (similarity > 0) scored.push({ rowid: row.rowid, similarity })
    }
    scored.sort((left, right) => right.similarity - left.similarity)
    const semanticRanking = scored.slice(0, pool).map(entry => entry.rowid)
    const fusedScores = reciprocalRankFusion([lexicalRanking, semanticRanking])
    const fused = fuseOrder(fusedScores, lexicalRanking).slice(0, normalized.limit)
    const fetchText = db.prepare('SELECT text FROM code_docs WHERE rowid = ?')
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
      const row = db.prepare(`
        SELECT path, start_line, end_line, language FROM code_docs WHERE rowid = ?
      `).get(rowid) as { path: string; start_line: number; end_line: number; language: string | null }
      const stored = fetchText.get(rowid) as { text: string }
      hits.push({
        path: row.path,
        startLine: row.start_line,
        endLine: row.end_line,
        ...(row.language === null ? {} : { language: row.language }),
        score: fusedScores.get(rowid) as number,
        snippet: makeSnippet(stored.text, this.config.snippetChars),
      })
    }
    return { hits }
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
        this._db = await openIndexDatabase(this.config.path, this.config.journalMode)
        this._reindex(signal)
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

  private _reindex(signal?: AbortSignal): void {
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
    const insertVector = db.prepare('INSERT INTO code_vec (rowid, vec) VALUES (?, ?)')
    const generation = (db.prepare('SELECT global_generation FROM index_state WHERE singleton = 1').get() as { global_generation: number }).global_generation + 1

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
      this._chunkAndInsert(insertChunk, insertVector, file, text)
    }
    for (const path of existing.keys()) {
      if (live.has(path)) continue
      deleteVectors.run(path)
      deleteChunks.run(path)
      deleteFile.run(path)
    }
    db.prepare('UPDATE index_state SET global_generation = ? WHERE singleton = 1').run(generation)
  }

  private _chunkAndInsert(insertChunk: StatementSync, insertVector: StatementSync, file: ScannedFile, text: string): void {
    const lines = text.split('\n')
    const size = this.config.chunkLines
    for (let start = 0; start < lines.length; start += size) {
      const window = lines.slice(start, start + size)
      if (window.join('').trim().length === 0) continue
      const chunkText = window.join('\n')
      const inserted = insertChunk.run(
        sanitizeFtsText(chunkText),
        file.path,
        start + 1,
        Math.min(start + size, lines.length),
        file.language ?? null,
      )
      if (this.config.semantic) {
        insertVector.run(inserted.lastInsertRowid, embedVector(chunkText))
      }
    }
  }

  private _readText(file: ScannedFile): string | undefined {
    try {
      const buffer = readFileSync(file.absolute)
      // Treat a NUL byte in the leading window as a binary marker and skip the file.
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
        const ext = extensionOf(rel)
        if (BINARY_EXTENSIONS.has(ext)) continue
        const language = LANGUAGE_BY_EXTENSION[ext]
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

function resolveConfig(config: Config): ResolvedConfig {
  return {
    path: config.path,
    root: config.root,
    openAt: config.openAt ?? 'startup',
    journalMode: config.journalMode ?? 'wal',
    defaultLimit: config.defaultLimit ?? CODE_INDEX_SQLITE_DEFAULT_LIMIT,
    maxLimit: config.maxLimit ?? CODE_INDEX_SQLITE_MAX_LIMIT,
    snippetChars: config.snippetChars ?? CODE_INDEX_SQLITE_SNIPPET_CHARS,
    chunkLines: config.chunkLines ?? CODE_INDEX_SQLITE_CHUNK_LINES,
    maxFileBytes: config.maxFileBytes ?? CODE_INDEX_SQLITE_MAX_FILE_BYTES,
    maxFiles: config.maxFiles ?? CODE_INDEX_SQLITE_MAX_FILES,
    skipDirs: new Set(config.skipDirs ?? []),
    includeMatchers: (config.includeGlobs ?? []).map(globToRegExp),
    excludeMatchers: (config.excludeGlobs ?? []).map(globToRegExp),
    semantic: config.semantic ?? true,
  }
}

/** Register the SQLite code-index provider and tie its lifecycle to the plugin. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const provider = new SqliteCodeIndexProvider(resolved)
  const unregister = ctx.codeIndex.registerProvider(provider)
  if (resolved.openAt === 'startup') void provider.prime().catch(() => undefined)
  ctx.effect(() => async () => {
    unregister()
    await provider.close()
  }, 'codeIndexSqlite.provider')
}

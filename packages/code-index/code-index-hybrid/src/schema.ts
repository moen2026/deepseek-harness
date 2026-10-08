/**
 * Derived-index schema for the hybrid code-index provider: a guarded, owner-only
 * SQLite database holding one file fingerprint table, one FTS5 chunk table, and one
 * float32 vector table, opened with an application-id guard so an unrelated database is
 * never reset in place.
 * @module @deepseek-ai/dsh-code-index-hybrid/schema
 */

import type { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/** Current derived-index schema version. Incompatible versions reset in place. */
export const CODE_INDEX_HYBRID_SCHEMA_VERSION = 1

/** SQLite application id protecting unrelated databases from derived resets. */
export const CODE_INDEX_HYBRID_APPLICATION_ID = 0x4453484a

/** Supported SQLite journal modes. */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

/** User tables this schema owns, including the FTS5 shadow tables. */
const DERIVED_USER_TABLES = new Set([
  'index_state',
  'code_files',
  'code_docs',
  'code_vec',
  'code_docs_data',
  'code_docs_idx',
  'code_docs_content',
  'code_docs_docsize',
  'code_docs_config',
])

/**
 * Open, validate, and initialize a hybrid code-index database.
 * @param path - dedicated derived-index path or `:memory:`; missing filesystem paths are created owner-only.
 * @param journalMode - validated SQLite journal mode.
 * @returns initialized database handle owned by the hybrid provider.
 */
export async function openHybridIndexDatabase(path: string, journalMode: JournalMode): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    try {
      const handle = await open(actual, 'wx', 0o600)
      await handle.close()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(actual)
  try {
    const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const userTables = listUserTables(db)
    if (applicationId !== 0 && applicationId !== CODE_INDEX_HYBRID_APPLICATION_ID) {
      throw new Error(`hybrid code-index database at "${actual}" belongs to another application`)
    }
    if (applicationId === 0 && userTables.length > 0) {
      throw new Error(`hybrid code-index database at "${actual}" is not an empty or recognized derived index`)
    }
    if (applicationId === CODE_INDEX_HYBRID_APPLICATION_ID) {
      const unknownTables = userTables.filter(name => !DERIVED_USER_TABLES.has(name))
      if (unknownTables.length > 0) {
        throw new Error(
          `hybrid code-index database at "${actual}" has unrecognized user tables: ${unknownTables.join(', ')}`,
        )
      }
      if (version !== CODE_INDEX_HYBRID_SCHEMA_VERSION) resetDerivedSchema(db, userTables)
    }
    // journalMode is a validated closed union, not caller-controlled SQL.
    db.exec(`PRAGMA journal_mode = ${journalMode.toUpperCase()}`)
    ensureSchema(db)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

function listUserTables(db: DatabaseSync): string[] {
  const rows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
  ).all() as Array<{ name: string }>
  return rows.map(row => row.name)
}

function resetDerivedSchema(db: DatabaseSync, userTables: readonly string[]): void {
  for (const name of userTables) {
    db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(name)}`)
  }
  db.exec('PRAGMA user_version = 0')
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`PRAGMA application_id = ${CODE_INDEX_HYBRID_APPLICATION_ID}`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS index_state (
      singleton         INTEGER PRIMARY KEY CHECK (singleton = 1),
      global_generation INTEGER NOT NULL
    ) STRICT
  `)
  db.exec('INSERT OR IGNORE INTO index_state (singleton, global_generation) VALUES (1, 0)')
  db.exec(`
    CREATE TABLE IF NOT EXISTS code_files (
      path       TEXT PRIMARY KEY,
      size       INTEGER NOT NULL,
      mtime      REAL NOT NULL,
      language   TEXT,
      generation INTEGER NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS code_docs USING fts5(
      text,
      path UNINDEXED,
      start_line UNINDEXED,
      end_line UNINDEXED,
      language UNINDEXED,
      tokenize = 'unicode61'
    )
  `)
  // One float32 vector per FTS5 chunk, keyed by the chunk's rowid; `dim` guards a
  // deployment that changed `config.embedding.dimension` against the stored corpus.
  db.exec(`
    CREATE TABLE IF NOT EXISTS code_vec (
      rowid INTEGER PRIMARY KEY,
      vec   BLOB NOT NULL,
      dim   INTEGER NOT NULL
    ) STRICT
  `)
  db.exec(`PRAGMA user_version = ${CODE_INDEX_HYBRID_SCHEMA_VERSION}`)
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

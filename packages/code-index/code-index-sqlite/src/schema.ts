/**
 * Derived-index schema for the SQLite code-index provider: a guarded, owner-only
 * database holding one file fingerprint table and one FTS5 chunk table, opened with an
 * application-id guard so an unrelated database is never reset in place.
 * @module @deepseek-ai/dsh-code-index-sqlite/schema
 */

import type { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/** Current derived-index schema version. Incompatible versions reset in place. */
export const CODE_INDEX_SQLITE_SCHEMA_VERSION = 2

/** SQLite application id protecting unrelated databases from derived resets. */
export const CODE_INDEX_SQLITE_APPLICATION_ID = 0x44534849

/** Supported SQLite journal modes. */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

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
 * Exclusively create a missing database file with owner-only permissions.
 * Existing files retain their modes, and errors other than `EEXIST` propagate.
 */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/**
 * Open, validate, and initialize a code-index database.
 * @param path - dedicated derived-index path or `:memory:`; missing filesystem paths are created owner-only.
 * @param journalMode - validated SQLite journal mode.
 * @returns initialized database handle owned by the code-index provider.
 */
export async function openIndexDatabase(path: string, journalMode: JournalMode): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    await createDatabaseFile(actual)
  }
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(actual)
  try {
    const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const userTables = listUserTables(db)
    if (applicationId !== 0 && applicationId !== CODE_INDEX_SQLITE_APPLICATION_ID) {
      throw new Error(`code-index database at "${actual}" belongs to another application`)
    }
    if (applicationId === 0 && userTables.length > 0) {
      throw new Error(`code-index database at "${actual}" is not an empty or recognized derived index`)
    }
    if (applicationId === CODE_INDEX_SQLITE_APPLICATION_ID) {
      assertDerivedUserTables(actual, userTables)
      if (version !== CODE_INDEX_SQLITE_SCHEMA_VERSION) resetDerivedSchema(db, userTables)
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

function assertDerivedUserTables(path: string, userTables: readonly string[]): void {
  const unknownTables = userTables.filter(name => !DERIVED_USER_TABLES.has(name))
  if (unknownTables.length > 0) {
    throw new Error(
      `code-index database at "${path}" has unrecognized user tables: ${unknownTables.join(', ')}`,
    )
  }
}

function resetDerivedSchema(db: DatabaseSync, userTables: readonly string[]): void {
  for (const name of userTables) {
    db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(name)}`)
  }
  db.exec('PRAGMA user_version = 0')
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`PRAGMA application_id = ${CODE_INDEX_SQLITE_APPLICATION_ID}`)
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
  // One int8-quantized unit vector per FTS5 chunk, keyed by the chunk's rowid.
  db.exec(`
    CREATE TABLE IF NOT EXISTS code_vec (
      rowid INTEGER PRIMARY KEY,
      vec  BLOB NOT NULL
    ) STRICT
  `)
  db.exec(`PRAGMA user_version = ${CODE_INDEX_SQLITE_SCHEMA_VERSION}`)
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

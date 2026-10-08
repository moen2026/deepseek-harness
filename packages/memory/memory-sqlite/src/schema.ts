/**
 * Derived-store schema for the SQLite long-term-memory provider: a guarded, owner-only
 * database holding one canonical records table, one FTS5 lexical table keyed by record id,
 * and an optional vector side table, opened with an application-id guard so an unrelated
 * database is never reset in place.
 * @module @deepseek-ai/dsh-memory-sqlite/schema
 */

import type { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/** Current derived-store schema version. Incompatible versions reset in place. */
export const MEMORY_SQLITE_SCHEMA_VERSION = 2

/** SQLite application id protecting unrelated databases from derived resets. */
export const MEMORY_SQLITE_APPLICATION_ID = 0x4453484d

/** Supported SQLite journal modes. */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

const DERIVED_USER_TABLES = new Set([
  'memory_records',
  'memory_docs',
  'memory_docs_data',
  'memory_docs_idx',
  'memory_docs_content',
  'memory_docs_docsize',
  'memory_docs_config',
  'memory_vectors',
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
 * Open, validate, and initialize a memory database.
 * @param path - dedicated derived-store path or `:memory:`; missing filesystem paths are created owner-only.
 * @param journalMode - validated SQLite journal mode.
 * @returns initialized database handle owned by the memory provider.
 */
export async function openMemoryDatabase(path: string, journalMode: JournalMode): Promise<DatabaseSync> {
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
    if (applicationId !== 0 && applicationId !== MEMORY_SQLITE_APPLICATION_ID) {
      throw new Error(`memory database at "${actual}" belongs to another application`)
    }
    if (applicationId === 0 && userTables.length > 0) {
      throw new Error(`memory database at "${actual}" is not an empty or recognized derived store`)
    }
    if (applicationId === MEMORY_SQLITE_APPLICATION_ID) {
      assertDerivedUserTables(actual, userTables)
      if (version !== MEMORY_SQLITE_SCHEMA_VERSION) resetDerivedSchema(db, userTables)
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
      `memory database at "${path}" has unrecognized user tables: ${unknownTables.join(', ')}`,
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
  db.exec(`PRAGMA application_id = ${MEMORY_SQLITE_APPLICATION_ID}`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_records (
      id         TEXT PRIMARY KEY,
      text       TEXT NOT NULL,
      tags       TEXT NOT NULL,
      scope      TEXT,
      namespace  TEXT,
      confidence REAL,
      created_at TEXT NOT NULL,
      expires_at TEXT
    ) STRICT
  `)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_docs USING fts5(
      text,
      mem_id UNINDEXED,
      tokenize = 'unicode61'
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_vectors (
      mem_id    TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      dim       INTEGER NOT NULL
    ) STRICT
  `)
  db.exec(`PRAGMA user_version = ${MEMORY_SQLITE_SCHEMA_VERSION}`)
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

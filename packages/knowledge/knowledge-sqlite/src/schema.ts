/**
 * Derived-store schema for the SQLite knowledge-base provider: a guarded, owner-only
 * database holding one canonical documents table and one FTS5 lexical table keyed by
 * document id, opened with an application-id guard so an unrelated database is never
 * reset in place.
 * @module @deepseek-ai/dsh-knowledge-sqlite/schema
 */

import type { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/** Current derived-store schema version. Incompatible versions reset in place. */
export const KNOWLEDGE_SQLITE_SCHEMA_VERSION = 1

/** SQLite application id protecting unrelated databases from derived resets. */
export const KNOWLEDGE_SQLITE_APPLICATION_ID = 0x4453484b

/** Supported SQLite journal modes. */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

const DERIVED_USER_TABLES = new Set([
  'knowledge_records',
  'knowledge_docs',
  'knowledge_docs_data',
  'knowledge_docs_idx',
  'knowledge_docs_content',
  'knowledge_docs_docsize',
  'knowledge_docs_config',
])

/* jscpd:ignore-start -- the derived-store open guard intentionally parallels
 * dsh-memory-sqlite's; extracting a shared opener would couple two independently
 * versioned storage schemas to one helper package. */
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
 * Open, validate, and initialize a knowledge database.
 * @param path - dedicated derived-store path or `:memory:`; missing filesystem paths are created owner-only.
 * @param journalMode - validated SQLite journal mode.
 * @returns initialized database handle owned by the knowledge provider.
 */
export async function openKnowledgeDatabase(path: string, journalMode: JournalMode): Promise<DatabaseSync> {
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
    if (applicationId !== 0 && applicationId !== KNOWLEDGE_SQLITE_APPLICATION_ID) {
      throw new Error(`knowledge database at "${actual}" belongs to another application`)
    }
    if (applicationId === 0 && userTables.length > 0) {
      throw new Error(`knowledge database at "${actual}" is not an empty or recognized derived store`)
    }
    if (applicationId === KNOWLEDGE_SQLITE_APPLICATION_ID) {
      assertDerivedUserTables(actual, userTables)
      if (version !== KNOWLEDGE_SQLITE_SCHEMA_VERSION) resetDerivedSchema(db, userTables)
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
      `knowledge database at "${path}" has unrecognized user tables: ${unknownTables.join(', ')}`,
    )
  }
}

function resetDerivedSchema(db: DatabaseSync, userTables: readonly string[]): void {
  for (const name of userTables) {
    db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(name)}`)
  }
  db.exec('PRAGMA user_version = 0')
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}
/* jscpd:ignore-end */

function ensureSchema(db: DatabaseSync): void {
  db.exec(`PRAGMA application_id = ${KNOWLEDGE_SQLITE_APPLICATION_ID}`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_records (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      text       TEXT NOT NULL,
      tags       TEXT NOT NULL,
      source     TEXT,
      created_at TEXT NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_docs USING fts5(
      title,
      text,
      doc_id UNINDEXED,
      tokenize = 'unicode61'
    )
  `)
  db.exec(`PRAGMA user_version = ${KNOWLEDGE_SQLITE_SCHEMA_VERSION}`)
}

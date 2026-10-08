import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CODE_INDEX_SQLITE_APPLICATION_ID,
  CODE_INDEX_SQLITE_SCHEMA_VERSION,
  openIndexDatabase,
} from '../src/schema.ts'

/** Open a raw SQLite handle for arranging a database the index must refuse or reset. */
async function rawDatabase(path: string) {
  const { DatabaseSync } = await import('node:sqlite')
  return new DatabaseSync(path)
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-code-index-schema-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('openIndexDatabase guards', () => {
  it('creates a missing index inside missing directories and reopens it without a reset', async () => {
    await withRoot(async (root) => {
      const path = join(root, 'nested', 'deeper', 'index.sqlite')
      const first = await openIndexDatabase(path, 'wal')
      first.close()
      // The second open finds the file already present, so the exclusive create must tolerate EEXIST.
      const second = await openIndexDatabase(path, 'wal')
      const { user_version: version } = second.prepare('PRAGMA user_version').get() as { user_version: number }
      expect(version).toBe(CODE_INDEX_SQLITE_SCHEMA_VERSION)
      second.close()
    })
  })

  it('propagates a path failure that is not EEXIST instead of silently continuing', async () => {
    // Node rejects the NUL byte before any syscall, producing a non-EEXIST failure.
    await expect(openIndexDatabase('index\0store.sqlite', 'wal')).rejects.toThrow(/null bytes/)
  })

  it('refuses a database owned by another application', async () => {
    await withRoot(async (root) => {
      const path = join(root, 'foreign.db')
      const db = await rawDatabase(path)
      db.exec('PRAGMA application_id = 12345')
      db.close()
      await expect(openIndexDatabase(path, 'wal')).rejects.toThrow(/belongs to another application/)
    })
  })

  it('refuses an unowned database that already holds user tables', async () => {
    await withRoot(async (root) => {
      const path = join(root, 'stray.db')
      const db = await rawDatabase(path)
      db.exec('CREATE TABLE stray (x TEXT)')
      db.close()
      await expect(openIndexDatabase(path, 'wal')).rejects.toThrow(/not an empty or recognized derived index/)
    })
  })

  it('resets a recognized index whose schema version is stale', async () => {
    await withRoot(async (root) => {
      const path = join(root, 'stale.db')
      const db = await rawDatabase(path)
      db.exec(`PRAGMA application_id = ${CODE_INDEX_SQLITE_APPLICATION_ID}`)
      db.exec('CREATE TABLE code_files (path TEXT)')
      db.close()
      const opened = await openIndexDatabase(path, 'wal')
      const { user_version: version } = opened.prepare('PRAGMA user_version').get() as { user_version: number }
      expect(version).toBe(CODE_INDEX_SQLITE_SCHEMA_VERSION)
      opened.close()
    })
  })

  it('refuses a recognized index that carries an unrecognized user table', async () => {
    await withRoot(async (root) => {
      const path = join(root, 'intruder.db')
      const db = await rawDatabase(path)
      db.exec(`PRAGMA application_id = ${CODE_INDEX_SQLITE_APPLICATION_ID}`)
      db.exec('CREATE TABLE intruder (x TEXT)')
      db.close()
      await expect(openIndexDatabase(path, 'wal')).rejects.toThrow(/unrecognized user tables: intruder/)
    })
  })
})

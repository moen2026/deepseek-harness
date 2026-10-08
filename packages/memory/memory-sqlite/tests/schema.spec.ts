import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MEMORY_SQLITE_APPLICATION_ID,
  MEMORY_SQLITE_SCHEMA_VERSION,
  openMemoryDatabase,
} from '../src/schema.ts'

/** Open a raw SQLite handle for arranging a database the memory store must refuse or reset. */
async function rawDatabase(path: string) {
  const { DatabaseSync } = await import('node:sqlite')
  return new DatabaseSync(path)
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-schema-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('openMemoryDatabase guards', () => {
  it('reopens an existing derived store without resetting it', async () => {
    await withRoot(async (root) => {
      const path = join(root, 'memory.db')
      const first = await openMemoryDatabase(path, 'wal')
      first.close()
      // The second open finds the file already present, so the exclusive create must tolerate EEXIST.
      const second = await openMemoryDatabase(path, 'wal')
      const { user_version: version } = second.prepare('PRAGMA user_version').get() as { user_version: number }
      expect(version).toBe(MEMORY_SQLITE_SCHEMA_VERSION)
      second.close()
    })
  })

  it('propagates a path failure that is not EEXIST instead of silently continuing', async () => {
    // Node rejects the NUL byte before any syscall, producing a non-EEXIST failure.
    await expect(openMemoryDatabase('memory\0store.sqlite', 'wal')).rejects.toThrow(/null bytes/)
  })

  it('refuses a database owned by another application', async () => {
    await withRoot(async (root) => {
      const path = join(root, 'foreign.db')
      const db = await rawDatabase(path)
      db.exec('PRAGMA application_id = 12345')
      db.close()
      await expect(openMemoryDatabase(path, 'wal')).rejects.toThrow(/belongs to another application/)
    })
  })

  it('refuses an unowned database that already holds user tables', async () => {
    await withRoot(async (root) => {
      const path = join(root, 'stray.db')
      const db = await rawDatabase(path)
      db.exec('CREATE TABLE stray (x TEXT)')
      db.close()
      await expect(openMemoryDatabase(path, 'wal')).rejects.toThrow(/not an empty or recognized derived store/)
    })
  })

  it('resets a derived store whose schema version is stale', async () => {
    await withRoot(async (root) => {
      const path = join(root, 'stale.db')
      const db = await rawDatabase(path)
      db.exec(`PRAGMA application_id = ${MEMORY_SQLITE_APPLICATION_ID}`)
      db.exec('CREATE TABLE memory_records (id TEXT)')
      db.close()
      const opened = await openMemoryDatabase(path, 'wal')
      const { user_version: version } = opened.prepare('PRAGMA user_version').get() as { user_version: number }
      expect(version).toBe(MEMORY_SQLITE_SCHEMA_VERSION)
      opened.close()
    })
  })

  it('refuses a recognized store that carries an unrecognized user table', async () => {
    await withRoot(async (root) => {
      const path = join(root, 'intruder.db')
      const db = await rawDatabase(path)
      db.exec(`PRAGMA application_id = ${MEMORY_SQLITE_APPLICATION_ID}`)
      db.exec('CREATE TABLE intruder (x TEXT)')
      db.close()
      await expect(openMemoryDatabase(path, 'wal')).rejects.toThrow(/unrecognized user tables: intruder/)
    })
  })
})

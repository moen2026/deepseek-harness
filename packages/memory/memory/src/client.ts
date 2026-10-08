/**
 * Browser-safe vocabulary shared by the memory browser Remote face and the Web
 * memory center. Type-only re-exports of the seam's records join it so a
 * browser consumer can read the whole face from one entry.
 * @module @deepseek-ai/dsh-memory/client
 */

/** The availability answer of the memory browser face's `status` probe. */
export interface MemoryBrowserStatus {
  /** Whether a memory provider currently holds the seam. */
  readonly available: boolean
}

export type { MemoryListRequest, MemoryNamespace, MemoryPage, MemoryRecord } from './types.ts'

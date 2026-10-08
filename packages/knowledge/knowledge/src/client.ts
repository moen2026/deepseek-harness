/** Browser-safe knowledge vocabulary. @module @deepseek-ai/dsh-knowledge/client */
export type * from './types.ts'

/** One availability probe answer from the browser Remote face. */
export interface KnowledgeBrowserStatus {
  /** Whether a knowledge provider currently holds the seam. */
  readonly available: boolean
}

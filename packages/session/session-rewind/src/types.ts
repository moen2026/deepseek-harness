/** Per-turn file-tool rewind state, the Host service serving it, and the restore outcome. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One turn's rewind record: the file-tool paths captured before that turn first changed them. */
export interface RewindSummary {
  /** The turn the checkpoint was taken before. */
  turn: number
  /** Captured path count; restore covers exactly these paths. */
  paths: number
}

/** One path a restore could not bring back. */
export interface RewindSkippedPath {
  /** Slash-separated path relative to the Session working directory, absolute elsewhere. */
  path: string
  /**
   * `oversized`: the pre-turn content exceeded the configured byte cap and was never stored.
   * `unwritable`: writing the restored content failed.
   */
  reason: 'oversized' | 'unwritable'
}

/** The effect of restoring one turn's rewind record, with display paths. */
export interface RewindOutcome {
  /** The restored turn. */
  turn: number
  /** Paths written back to their pre-turn content. */
  restored: string[]
  /** Paths that did not exist before the turn and were deleted. */
  removed: string[]
  /** Paths left untouched because their pre-turn state could not be reproduced. */
  skipped: RewindSkippedPath[]
}

/** Serves the per-turn rewind records of live Sessions. */
export interface SessionRewind {
  /**
   * Every turn with captured paths, oldest first.
   * @param sessionId - the Session whose rewind records to list.
   * @returns the summaries, or an empty list once the Session was disposed or when this Host never recorded it.
   */
  list(sessionId: SessionId): RewindSummary[]
  /**
   * Restore every path one turn's file tools changed to its content before that turn. A path
   * absent before the turn is deleted; a later turn's edits to a covered path are overwritten.
   * @param sessionId - the Session whose rewind record to restore.
   * @param turn - the turn whose pre-turn state to reproduce.
   * @param signal - cancels the queued restore work.
   * @returns the outcome, or undefined when no record exists for that turn, once the Session was
   *   disposed, or when this Host never recorded it.
   */
  restore(sessionId: SessionId, turn: number, signal?: AbortSignal): Promise<RewindOutcome | undefined>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Per-turn file-tool rewind records of live Sessions. */
    sessionRewind: SessionRewind
  }
}

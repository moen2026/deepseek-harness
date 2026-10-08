# Session Rewind

English | [中文](session-rewind.zh.md)

Per-turn restore points for the files a Session's file tools change, owned by [`@deepseek-ai/dsh-session-rewind`](../../packages/session/session-rewind). Before a `write`, `edit`, or mutating `str_replace_editor` call first changes a path in a top-level turn, the plugin captures the path's pre-turn content content-addressed under the Session's temporary directory — or records that the path did not exist. The model-facing `workspace_rewind` tool and the Host-facing `sessionRewind` service reproduce one turn's pre-turn state. Nothing is appended to the Session log: captures stay on the Host, and a restore is already recorded as its own tool call and result. Package READMEs own coverage rules, bounds, and record lifetime; the [tool catalog](../tool-catalog.md#deepseek-aidsh-session-rewind) owns the generated tool schema.

Source: [`packages/session/session-rewind/src/index.ts`](../../packages/session/session-rewind/src/index.ts)

## Restore outcomes

A restore applies one turn's captures in `display` order — the same relative-or-absolute label rule the workspace-changes summaries use — and never fails because one path could not be written back:

```ts type-equiv
/** One turn's rewind record: the file-tool paths captured before that turn first changed them. */
interface RewindSummary {
  /** The turn the checkpoint was taken before. */
  turn: number
  /** Captured path count; restore covers exactly these paths. */
  paths: number
}
```

```ts type-equiv
/** The effect of restoring one turn's rewind record, with display paths. */
interface RewindOutcome {
  /** The restored turn. */
  turn: number
  /** Paths written back to their pre-turn content. */
  restored: string[]
  /** Paths that did not exist before the turn and were deleted. */
  removed: string[]
  /** Paths left untouched because their pre-turn state could not be reproduced. */
  skipped: RewindSkippedPath[]
}
```

```ts type-equiv
/** One path a restore could not bring back. */
interface RewindSkippedPath {
  /** Slash-separated path relative to the Session working directory, absolute elsewhere. */
  path: string
  /**
   * `oversized`: the pre-turn content exceeded the configured byte cap and was never stored.
   * `unwritable`: writing the restored content failed.
   */
  reason: 'oversized' | 'unwritable'
}
```

An `oversized` capture is neither stored nor restored: the file's content after the turn survives a rewind. A `unwritable` skip logs a warning and lets the restore continue. Records live only as long as their Session in this Host process, and only the last 64 turns of a Session keep theirs; a Host restart loses every restore point.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessionrewind--sessionrewind"></a>

### `ctx.sessionRewind` — `SessionRewind`

Serves the per-turn rewind records of live Sessions.

```ts cordis-catalog
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
```

Types: [SessionId](core.md)

Source: [`packages/session/session-rewind/src/types.ts`](../../packages/session/session-rewind/src/types.ts)
<!-- END GENERATED cordis-surface -->

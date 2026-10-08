# Session Rewind

[English](session-rewind.md) | 中文

面向 Session 文件工具改动的逐轮还原点，由 [`@deepseek-ai/dsh-session-rewind`](../../packages/session/session-rewind) 拥有。在 `write`、`edit` 或有修改作用的 `str_replace_editor` 调用首次改动顶层轮次中的某路径之前，插件把该路径的轮前内容以内容寻址方式捕获到 Session 的临时目录——或记录该路径当时不存在。面向模型的 `workspace_rewind` 工具与面向 Host 的 `sessionRewind` 服务重现某一轮的轮前状态。Session 日志不追加任何内容：捕获留在 Host 上，恢复本身已经作为它自己的工具调用与结果被记录。包 README 拥有覆盖规则、上限与记录存活期；[工具目录](../tool-catalog.zh.md#deepseek-aidsh-session-rewind)拥有生成的工具 schema。

Source: [`packages/session/session-rewind/src/index.ts`](../../packages/session/session-rewind/src/index.ts)

## 恢复结果

恢复按 `display` 顺序应用某一轮的捕获——与 workspace-changes 摘要使用的相对或绝对标签规则相同——并且不会因为某个路径写不回去而失败：

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

`oversized` 捕获既不存储也不恢复：文件在轮次之后的内容在回退中保留。`unwritable` 跳过会记录警告并让恢复继续。记录只在本 Host 进程内随其 Session 存活，且每个 Session 只保留最近 64 轮的记录；Host 重启会失去全部还原点。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [SessionId](core.zh.md)

Source: [`packages/session/session-rewind/src/types.ts`](../../packages/session/session-rewind/src/types.ts)
<!-- END GENERATED cordis-surface -->

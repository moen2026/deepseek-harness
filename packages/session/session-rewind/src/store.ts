/** Per-Session rewind store: pre-mutation captures, the restore service, and disposal of the temporary directory. */
import { copyFile, mkdir, mkdtemp, realpath, rm, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { captureFile, mutationPath, type Capture } from './capture.ts'
import type { RewindOutcome, RewindSummary } from './types.ts'

/** Facts shared by every store of one plugin instance. */
export interface RewindEnvironment {
  /** Directory that receives each Session's temporary directory. */
  tempRoot: string
  /** Inclusive byte cap on a stored pre-turn copy; a larger file cannot be restored. */
  maxFileBytes: number
  /** Maximum paths one turn's checkpoint captures; later mutations of the turn are not covered. */
  maxPaths: number
  /** Failure reporter; a failed capture is skipped and restore reports what it covered. */
  warn: (message: string) => void
}

/** Everything one turn accumulates; a new turn gets a new object so queued captures for an older turn keep their own. */
interface TurnState {
  readonly turn: number
  /** Content of each file-tool-mutated path before the turn's first mutation of it, by canonical absolute path. */
  readonly captures: Map<string, Capture>
}

function freshState(turn: number): TurnState {
  return { turn, captures: new Map() }
}

/** Slash-separated form of a native path. */
function toPosix(path: string): string {
  return path.split(sep).join('/')
}

/** Whether `path` is `root` or lies under it. */
function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Symlink-resolved path. A path that does not exist yet is resolved through
 * its nearest existing ancestor, so a file created through a directory
 * symlink has the same canonical spelling before and after it exists.
 * @param path - absolute path.
 * @returns the canonical spelling used for capture and restore.
 */
export async function canonicalPath(path: string): Promise<string> {
  const missing: string[] = []
  let head = path
  while (true) {
    try {
      return join(await realpath(head), ...missing)
    } catch {
      // A missing or unreadable component is kept lexically under its nearest resolvable ancestor;
      // a path with no existing ancestor but the root keeps its spelling entirely.
      const parent = dirname(head)
      if (parent === head || dirname(parent) === parent) return path
      missing.unshift(head.split(sep).pop() ?? head)
      head = parent
    }
  }
}

/** Slash-separated label of a captured path: relative inside the working directory, absolute elsewhere. */
function displayPathOf(absolute: string, cwd: string): string {
  return isInside(cwd, absolute) ? toPosix(relative(cwd, absolute)) : toPosix(absolute)
}

/**
 * Serializes one Session's rewind work: the whole-file capture before each
 * file-tool mutation and the queued restores. Captures and copies live in a
 * temporary directory owned by the store; disposal removes it. Tool execution
 * waits for pending work so a capture never races a mutation, and a restore
 * runs on the same chain so it never races a capture.
 */
export class SessionRewindStore {
  private chain: Promise<void> = Promise.resolve()
  /** The open turn; before the first `turn/start` it is an empty placeholder no event can match. */
  private state = freshState(0)
  /** Canonical working directory, resolved by the first turn. */
  private cwd: string | undefined
  /** Temporary directory holding this Session's captured copies. */
  private scratch: Promise<string> | undefined
  /** Closed turns' capture maps by turn number. */
  private readonly closed = new Map<number, Map<string, Capture>>()
  private readonly lifetime = new AbortController()

  constructor(
    private readonly cwdHint: string,
    private readonly env: RewindEnvironment,
  ) {}

  /**
   * Open a turn with fresh per-turn capture state.
   * @param turn - the turn number from `turn/start`.
   */
  start(turn: number): void {
    this.closed.set(this.state.turn, this.state.captures)
    if (this.closed.size > 64) {
      const oldest = this.closed.keys().next().value
      if (oldest !== undefined) this.closed.delete(oldest)
    }
    this.state = freshState(turn)
  }

  /**
   * Queue the capture of the path a file tool is about to mutate, before the
   * tool runs; only the turn's first mutation of a path captures it, and the
   * turn's checkpoint stops growing once `maxPaths` paths are covered. Await
   * {@link settled} afterwards so the tool cannot overtake the capture.
   * @param name - wire tool name.
   * @param args - parsed call arguments.
   */
  capture(name: string, args: unknown): void {
    const path = mutationPath(name, args)
    if (path === undefined) return
    const state = this.state
    void this.enqueue(async () => {
      this.cwd ??= await canonicalPath(this.cwdHint)
      const absolute = await canonicalPath(resolve(this.cwd, path))
      if (state.captures.has(absolute)) return
      if (state.captures.size >= this.env.maxPaths) {
        this.env.warn(`session-rewind: turn ${String(state.turn)} exceeded ${String(this.env.maxPaths)} paths; ${path} is not covered`)
        return
      }
      const capture = await captureFile(absolute, join(await this.scratchDir(), 'captures'), this.env.maxFileBytes)
      if (capture !== undefined) state.captures.set(absolute, capture)
    })
  }

  /** Resolves once every queued capture has settled. */
  settled(): Promise<void> {
    return this.chain
  }

  /** Every turn with captured paths, oldest first.
   * @returns one `{ turn, paths }` summary per captured turn, ordered by turn. */
  list(): RewindSummary[] {
    const entries = [...this.closed.entries(), [this.state.turn, this.state.captures] as const]
    return entries
      .filter(([, captures]) => captures.size > 0)
      .map(([turn, captures]) => ({ turn, paths: captures.size }))
      .sort((a, b) => a.turn - b.turn)
  }

  /**
   * Restore every captured path of one turn to its pre-turn content: a stored
   * copy is written back, a path absent before the turn is deleted, and an
   * oversized or otherwise unrestorable path is skipped. The work runs on the
   * capture chain, so it never races a pending capture.
   * @param turn - the turn whose pre-turn state to reproduce.
   * @param signal - cancels the restore; an aborted restore may leave earlier paths restored.
   * @returns the outcome, or undefined when nothing was captured for that turn.
   */
  async restore(turn: number, signal: AbortSignal): Promise<RewindOutcome | undefined> {
    const captures = this.closed.get(turn) ?? (this.state.turn === turn ? this.state.captures : undefined)
    if (captures === undefined || captures.size === 0) return undefined
    const outcome: RewindOutcome = { turn, restored: [], removed: [], skipped: [] }
    let failure: string | undefined
    await this.enqueue(async (chainSignal) => {
      const isAborted = () => signal.aborted || chainSignal.aborted
      this.cwd ??= await canonicalPath(this.cwdHint)
      const { cwd } = this
      const ordered = [...captures.entries()]
        .map(([absolute, capture]) => ({ absolute, capture, display: displayPathOf(absolute, cwd) }))
        .sort((a, b) => (a.display < b.display ? -1 : a.display > b.display ? 1 : 0))
      for (const { absolute, capture, display } of ordered) {
        if (isAborted()) break
        try {
          if (capture.kind === 'oversized') {
            outcome.skipped.push({ path: display, reason: 'oversized' })
          } else if (capture.kind === 'absent') {
            await unlink(absolute)
            outcome.removed.push(display)
          } else {
            await mkdir(dirname(absolute), { recursive: true })
            await copyFile(capture.file, absolute)
            outcome.restored.push(display)
          }
        } catch (error: unknown) {
          if (isAborted()) break
          outcome.skipped.push({ path: display, reason: 'unwritable' })
          failure = error instanceof Error ? error.message : 'unknown write-back failure'
        }
      }
    }).catch(() => undefined)
    if (failure !== undefined) this.env.warn(`session-rewind: restore of turn ${String(turn)} skipped paths: ${failure}`)
    return outcome
  }

  /**
   * Abort queued work and remove the temporary directory.
   * @returns once the temporary directory is gone.
   */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    await this.chain
    if (this.scratch !== undefined) await rm(await this.scratch, { recursive: true, force: true })
  }

  private enqueue(task: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const run = this.chain.then(async () => {
      if (this.lifetime.signal.aborted) return
      await task(this.lifetime.signal)
    })
    this.chain = run
    return run
  }

  /** This Session's temporary directory, created on first use. */
  private scratchDir(): Promise<string> {
    this.scratch ??= mkdtemp(join(this.env.tempRoot, 'dsh-session-rewind-'))
    return this.scratch
  }
}

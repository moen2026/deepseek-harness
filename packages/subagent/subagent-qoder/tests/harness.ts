/**
 * Shared fixtures and fakes for the subagent-qoder suites: recorded CLI
 * captures and the fake subprocess handle whose collected stdout is fixed at
 * construction.
 */

import { readFileSync } from 'node:fs'
import { vi } from 'vitest'
import type {
  SubprocessHandle,
  SubprocessOutcome,
} from '@deepseek-ai/dsh-subprocess'

/** Read one recorded CLI capture or manifest fixture. */
export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

/** The recorded success reply most run-level cases settle with. */
export const SUCCESS_REPLY = fixture('print-json-success.json')

/** The recorded unauthenticated reply (a product error). */
export const NOT_LOGGED_IN_REPLY = fixture('print-json-not-logged-in.json')

/** Construction options of a {@link fakeChild}. */
export interface FakeChildOptions {
  /** Complete collected stdout the handle reports. */
  readonly stdout?: string
  /** Whether `terminate()` settles the child (default true). */
  readonly exitOnTerminate?: boolean
  /** Failure thrown by `waitForExit()`. */
  readonly waitForExitError?: Error
}

/** A live fake subprocess handle plus the controls a case drives it with. */
export interface FakeChild {
  /** The handle under test. */
  readonly handle: SubprocessHandle
  /** Settle the outcome (idempotent). */
  readonly settle: (outcome?: SubprocessOutcome) => void
  /** Reject the outcome promise (idempotent). */
  readonly fail: (error: Error) => void
  /** Termination spy. */
  readonly terminate: ReturnType<typeof vi.fn>
  /** Quiescence-wait spy. */
  readonly waitForExit: ReturnType<typeof vi.fn>
}

/** Build one fake child whose collected stdout is fixed at construction. */
export function fakeChild(options: FakeChildOptions = {}): FakeChild {
  const stdout = options.stdout ?? ''
  let exited = false
  let resolveDone!: (outcome: SubprocessOutcome) => void
  let rejectDone!: (error: Error) => void
  const done = new Promise<SubprocessOutcome>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  const settle = (outcome: SubprocessOutcome = { exitCode: 0, signal: null }): void => {
    if (exited) return
    exited = true
    resolveDone(outcome)
  }
  const fail = (error: Error): void => {
    if (exited) return
    exited = true
    rejectDone(error)
  }
  const terminate = vi.fn(() => {
    if (options.exitOnTerminate !== false) settle()
  })
  const waitForExit = vi.fn(async () => {
    if (options.waitForExitError !== undefined) throw options.waitForExitError
    await done.catch(() => {})
    return true
  })
  return {
    handle: {
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      control: undefined,
      collected: {
        stdout: {
          readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }),
        },
      },
      done,
      terminate,
      waitForExit,
    },
    settle,
    fail,
    terminate,
    waitForExit,
  }
}

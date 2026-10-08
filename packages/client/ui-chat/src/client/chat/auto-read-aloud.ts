/** Automatic read-aloud preference and the closing-reply projection it reads. */
import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-store'
import type { ChatNode } from '../contract/chat-nodes.ts'
import { assistantText } from './turn-assistant.ts'

/**
 * Create the browser-wide automatic read-aloud preference source.
 * @returns a persisted source shared by every Session header in one plugin lifecycle.
 */
export function createAutoReadAloudStore(): SnapshotStore<boolean> {
  return createSnapshotStore(false, {
    persist: { name: 'dsh.chat.autoReadAloud' },
  })
}

/** One completed assistant reply eligible for automatic reading. */
export interface ClosingSpeech {
  /** Session-log seq of the closing reply. */
  readonly seq: number
  /** Plain reply text to read. */
  readonly text: string
}

/**
 * Project the latest Turn's closing reply for automatic reading. The scan
 * starts at the newest visible node and stops at the first Turn tail, so a
 * tail whose closing is empty or absent reads nothing instead of replaying an
 * earlier Turn's reply.
 * @param order - visible Chat node keys in transcript order.
 * @param readNode - resolve one key to its typed Chat node.
 * @returns the closing reply, or null when the latest Turn has none.
 */
export function latestClosingSpeech(
  order: readonly string[],
  readNode: (key: string) => ChatNode | undefined,
): ClosingSpeech | null {
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const key = order[index]
    if (key === undefined) continue
    const node = readNode(key)
    if (node === undefined || node.kind !== 'turn-tail') continue
    const { closing } = node.data
    if (closing === null) return null
    const text = assistantText(closing.blocks).trim()
    if (text === '') return null
    return { seq: closing.finalNode.seq, text }
  }
  return null
}

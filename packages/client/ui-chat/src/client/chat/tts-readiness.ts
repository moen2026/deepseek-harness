/** One reconnecting Host synthesis readiness mirror shared by every read-aloud row. */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TtsCatalog } from '@deepseek-ai/dsh-experimental-api-text-to-speech/types'
import type {} from '@deepseek-ai/dsh-experimental-api-text-to-speech/remote'

/** Complete synthesis provider state, with a separate transport failure that never rewrites Host readiness. */
export interface TtsReadiness {
  readonly catalog: TtsCatalog | null
  readonly connected: boolean
  readonly error: string | null
}

/**
 * Subscribe once per Client plugin, independent of rendered pages and Sessions,
 * folding each accepted stream item into `state`. Callers wait for the `remote.tts`
 * service before joining, so a composition without the synthesis Remote keeps
 * the disconnected snapshot instead of a failed open.
 * @param ctx - mounted synthesis Remote owner.
 * @param state - the shared readiness snapshot the caller provides.
 * @returns joined observation cleanup.
 */
export function observeTtsReadiness(ctx: Context, state: SnapshotStore<TtsReadiness>): { dispose: () => Promise<void> } {
  let disposed = false
  const isDisposed = (): boolean => disposed
  const fail = (error: unknown): void => {
    state.set({ ...state.getSnapshot(), connected: false, error: error instanceof Error ? error.message : String(error) })
  }
  const stream = ctx.remote.$stream<TtsCatalog>({
    name: 'TTS readiness', open: signal => ctx.remote.tts.follow(signal),
    ended: () => new RemoteStreamCarrierError('TTS readiness stream ended'), carrierFailed: fail,
  })
  const observing = (async () => {
    try {
      for await (const item of stream) {
        state.set({ catalog: item.value, connected: true, error: null })
        item.accept()
      }
    } catch (error) { if (!isDisposed()) fail(error) }
  })()
  return { dispose: async () => { disposed = true; await stream.dispose(); await observing } }
}

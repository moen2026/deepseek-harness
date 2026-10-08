/**
 * Browser entry mounting this package's generated synthesis Remote
 * contribution. The read-aloud bundle patch inserts the plugin, so every
 * composition that serves the Host synthesizer also serves its Client
 * descriptors; compositions without it show no trace of the namespace.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote Context merge (the mounted descriptors live there).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import ttsRemote from '@deepseek-ai/dsh-experimental-api-text-to-speech/remote'

/** Required services (cordis fiber inject). */
export const inject = ['remote']

/**
 * Mount the `tts` Remote namespace onto the Client runtime.
 * @param ctx - Client runtime owning the Remote.
 * @returns Remote disposer.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await ctx.remote.$mount(ttsRemote)
}

/**
 * Collaboration-style profile injection over the memory seam: reads saved `style`
 * memories and contributes them to the runtime context so the model applies durable
 * user preferences across turns and sessions. The profile is re-read after every
 * turn end; an absent or failing provider contributes nothing and keeps the last
 * successful text. Model visibility rides the ordinary runtime-context mechanism,
 * so every injected snapshot is recorded in the session log before it can shape a
 * request.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-memory-profile
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { MemoryRecord } from '@deepseek-ai/dsh-memory'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name for loader diagnostics. */
export const name = 'memory-profile'

/** Services required by this plugin. */
export const inject = ['memory', 'systemPrompt']

/** Default cap on injected style memories per snapshot. */
export const MEMORY_PROFILE_DEFAULT_MAX_ITEMS = 20

/** Plugin configuration: the snapshot size cap. */
export interface Config {
  /** Largest number of style memories injected in one runtime-context snapshot (default 20). */
  maxItems?: number
}

export const Config: z<Config> = z.object({
  maxItems: z.number().default(MEMORY_PROFILE_DEFAULT_MAX_ITEMS),
})

/** Reject a non-positive-integer config value at load, so misconfiguration fails loud. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`memory-profile: ${name} must be a positive integer`)
  }
}

/**
 * Render the profile context text for the given style memories.
 * @param records - stored style records, in the provider's listing order.
 * @returns the guidance text, or `''` when there is nothing to inject.
 */
export function renderProfile(records: readonly MemoryRecord[]): string {
  if (records.length === 0) return ''
  return [
    'Saved collaboration style preferences for this user. Apply them unless the current task says otherwise:',
    ...records.map(record => `- ${record.text}`),
  ].join('\n')
}

/**
 * Register the style-profile context contribution and refresh it after every turn.
 * @param ctx - the plugin context (must inject `memory` and `systemPrompt`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const maxItems = config.maxItems ?? MEMORY_PROFILE_DEFAULT_MAX_ITEMS
  assertPositiveInteger('maxItems', maxItems)
  let cached = ''
  let refreshing = false
  const refresh = (): void => {
    if (refreshing) return
    refreshing = true
    void ctx.memory.list({ namespace: 'style', limit: maxItems })
      .then((page) => { cached = renderProfile(page.records) })
      // An absent or failing provider keeps the last successful text instead of
      // flapping the injected context to empty on a transient read error.
      .catch(() => undefined)
      .finally(() => { refreshing = false })
  }
  refresh()
  ctx.systemPrompt.context({
    name: 'memory:profile',
    order: ctx.systemPrompt.getContextOrder('MEMORY_PROFILE'),
    text: () => cached,
  })
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'turn/end') refresh()
  }, { global: true })
}

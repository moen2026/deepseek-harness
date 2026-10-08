/**
 * The memory center: a right-Sidebar page type listing the deployment's stored
 * long-term memories with availability probing and durable deletion, plus the
 * transcript card of the memories one Turn wrote.
 *
 * The page reaches the Sidebar through its public path only: the definition
 * into `ctx.sidebarRightTabs` — whose guide entry is how the product opens the
 * center — and the body into the keyed `sidebar.right.pane.tab` seat under the
 * definition's `id`. One catalog source backs the page; the Host face answers
 * an unheld seam explicitly, so a deployment without a provider renders the
 * unavailable state rather than a failed read a retry cannot clear.
 *
 * A `memory_write` call renders at Turn level: a Turn Definition publishes the
 * settled results against their Turn, and ui-chat's
 * `conversation.chat.turnTail` list seat renders the card beneath the closing
 * prose, outside the collapsible Tool group. The call's Tool-group cell stays
 * with ui-tool's generic keyed tool view, so this package registers no
 * `tool.call.toolview` entry for the wire name.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-chat SlotMap merge (the conversation.chat.turnTail seat).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createMemoryCatalog } from './catalog-source.ts'
import { MEMORY_ID, memoryCenterDefinition } from './definition.ts'
import { MemoryTab } from './MemoryTab.tsx'
import { MemoryTurnCard } from './MemoryTurnCard.tsx'
import { memoryTurnDefinition } from './memory-turn.ts'
import { en, NS, zh, type MemoryCatalogKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Memory center page and transcript-card copy. */
    'memory.catalog': MemoryCatalogKey
  }
}

/** Required services for the Remote face, dictionaries, the Sidebar page type, and the Turn card. */
export const inject = ['slots', 'locale', 'remote', 'remote.memory', 'sidebarRightTabs', 'uiConversation']

/**
 * Register the memory center's dictionaries, catalog source, page type, body,
 * and the transcript card of one remembered memory.
 * @param ctx - browser services used by these contributions.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-memory: dictionaries')
  const t = ctx.locale.bind(NS)
  const catalog = createMemoryCatalog({
    status: () => ctx.remote.memory.status(),
    list: () => ctx.remote.memory.list(),
    forget: id => ctx.remote.memory.forget(id),
    subscribeReset: listener => ctx.on('connection/reset', listener),
  })
  const detail = { hooks: catalog.hooks, onDelete: catalog.onDelete, onRetry: catalog.onRetry }
  ctx.effect(() => ctx.sidebarRightTabs.register(memoryCenterDefinition(t)), 'ui-memory: page type')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: MEMORY_ID,
    locale: NS,
    inject: () => detail,
  }, MemoryTab))
  // The written memories are Turn-level elements, not Tool-group rows: the Turn
  // Definition publishes the settled results and this tail list entry renders
  // the cards beneath the closing prose.
  ctx.uiConversation.events.register(memoryTurnDefinition)
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: 'memory-remembered',
    order: 21,
    locale: NS,
    inject: () => ({}),
  }, MemoryTurnCard))
}

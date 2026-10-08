/**
 * The knowledge center: a right-Sidebar page type listing the deployment's
 * stored knowledge documents with availability probing and durable deletion.
 *
 * The page reaches the Sidebar through its public path only: the definition
 * into `ctx.sidebarRightTabs` — whose guide entry is how the product opens the
 * center — and the body into the keyed `sidebar.right.pane.tab` seat under the
 * definition's `id`. One catalog source backs the page; the Host face answers
 * an unheld seam explicitly, so a deployment without a provider renders the
 * unavailable state rather than a failed read a retry cannot clear.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createKnowledgeCatalog } from './catalog-source.ts'
import { KNOWLEDGE_ID, knowledgeCenterDefinition } from './definition.ts'
import { KnowledgeTab } from './KnowledgeTab.tsx'
import { en, NS, zh, type KnowledgeCatalogKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Knowledge center page copy. */
    'knowledge.catalog': KnowledgeCatalogKey
  }
}

/** Required services for the Remote face, dictionaries, and the Sidebar page type. */
export const inject = ['slots', 'locale', 'remote', 'remote.knowledge', 'sidebarRightTabs']

/**
 * Register the knowledge center's dictionaries, catalog source, page type, and body.
 * @param ctx - browser services used by these contributions.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-knowledge: dictionaries')
  const t = ctx.locale.bind(NS)
  const catalog = createKnowledgeCatalog({
    status: () => ctx.remote.knowledge.status(),
    list: () => ctx.remote.knowledge.list(),
    remove: id => ctx.remote.knowledge.remove(id),
    subscribeReset: listener => ctx.on('connection/reset', listener),
  })
  const detail = { hooks: catalog.hooks, onDelete: catalog.onDelete, onRetry: catalog.onRetry }
  ctx.effect(() => ctx.sidebarRightTabs.register(knowledgeCenterDefinition(t)), 'ui-knowledge: page type')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: KNOWLEDGE_ID,
    locale: NS,
    inject: () => detail,
  }, KnowledgeTab))
}

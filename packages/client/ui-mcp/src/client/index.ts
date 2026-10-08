/**
 * The MCP panel: a right-Sidebar page type listing the deployment's connected
 * MCP servers with their model-facing tools and reported resources.
 *
 * The page reaches the Sidebar through its public path only: the definition
 * into `ctx.sidebarRightTabs` — whose guide entry is how the product opens the
 * panel — and the body into the keyed `sidebar.right.pane.tab` seat under the
 * definition's `id`. One catalog source backs the page; the Host face answers
 * a serverless deployment explicitly, so the page renders the unavailable
 * state rather than a failed read a retry cannot clear.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createMcpCatalog } from './catalog-source.ts'
import { MCP_ID, mcpPanelDefinition } from './definition.ts'
import { McpTab } from './McpTab.tsx'
import { en, NS, zh, type McpPanelKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP panel page copy. */
    'mcp.panel': McpPanelKey
  }
}

/** Required services for the Remote face, dictionaries, and the Sidebar page type. */
export const inject = ['slots', 'locale', 'remote', 'remote.mcp', 'sidebarRightTabs']

/**
 * Register the MCP panel's dictionaries, catalog source, page type, and body.
 * @param ctx - browser services used by these contributions.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-mcp: dictionaries')
  const t = ctx.locale.bind(NS)
  const catalog = createMcpCatalog({
    status: () => ctx.remote.mcp.status(),
    servers: () => ctx.remote.mcp.servers(),
    subscribeReset: listener => ctx.on('connection/reset', listener),
  })
  const detail = { hooks: catalog.hooks, onRetry: catalog.onRetry }
  ctx.effect(() => ctx.sidebarRightTabs.register(mcpPanelDefinition(t)), 'ui-mcp: page type')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: MCP_ID,
    locale: NS,
    inject: () => detail,
  }, McpTab))
}

/**
 * Stage one of the MCP panel page's registration: what it IS.
 *
 * A page type: it recognizes no resource address, because its content is the
 * deployment's whole server set rather than one addressed server, and is
 * opened by kind from the guide page. `builtin` is the ordinary band for a
 * type shipped with the product.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

/** This implementation's identity in the tab system: the key its body registers under. */
export const MCP_ID = '@deepseek-ai/dsh-client-ui-mcp'

/** The tab kind this package owns. */
export const MCP_KIND = 'mcp'

/**
 * The MCP panel's registry definition, carrying its guide-page entry:
 * picking that entry is how the product opens the panel.
 * @param t - namespace-bound translate, read fresh on every title call.
 * @returns the definition to register.
 */
export function mcpPanelDefinition(t: TranslateNS<'mcp.panel'>): SidebarRightTabDefinition {
  return {
    id: MCP_ID,
    kind: MCP_KIND,
    priority: 'builtin',
    title: () => t('tab.label'),
    guide: [{
      id: 'mcp',
      order: 22,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
    }],
  }
}

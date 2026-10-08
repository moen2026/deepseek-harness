/**
 * Stage one of the knowledge center page's registration: what it IS.
 *
 * A page type: it recognizes no resource address, because its content is the
 * deployment's whole corpus rather than one addressed document, and is opened
 * by kind from the guide page. `builtin` is the ordinary band for a type
 * shipped with the product.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

/** This implementation's identity in the tab system: the key its body registers under. */
export const KNOWLEDGE_ID = '@deepseek-ai/dsh-client-ui-knowledge'

/** The tab kind this package owns. */
export const KNOWLEDGE_KIND = 'knowledge'

/**
 * The knowledge center's registry definition, carrying its guide-page entry:
 * picking that entry is how the product opens the center.
 * @param t - namespace-bound translate, read fresh on every title call.
 * @returns the definition to register.
 */
export function knowledgeCenterDefinition(t: TranslateNS<'knowledge.catalog'>): SidebarRightTabDefinition {
  return {
    id: KNOWLEDGE_ID,
    kind: KNOWLEDGE_KIND,
    priority: 'builtin',
    title: () => t('tab.label'),
    guide: [{
      id: 'knowledge',
      order: 20,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
    }],
  }
}

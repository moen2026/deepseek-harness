/**
 * `knowledge.catalog` namespace dictionaries: the knowledge tab's chrome, its
 * guide entry, and the document list with its deletion copy.
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'knowledge.catalog'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'tab.label': '知识库',
  'guide.title': '知识库',
  'guide.description': '浏览此部署存储的知识文档。',
  'unavailable.title': '知识库不可用',
  'unavailable.description': '当前部署没有配置知识提供方。',
  'list.loading': '正在加载知识文档…',
  'list.error': '无法加载知识文档。',
  'list.retry': '重试',
  'list.empty': '知识库为空。',
  'delete.action': '删除',
  'delete.pending': '正在删除…',
  'delete.label': '删除知识文档：{title}',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<KnowledgeCatalogKey, string> = {
  'tab.label': 'Knowledge',
  'guide.title': 'Knowledge',
  'guide.description': 'Browse the knowledge documents this deployment stores.',
  'unavailable.title': 'Knowledge base unavailable',
  'unavailable.description': 'This deployment has no knowledge provider configured.',
  'list.loading': 'Loading knowledge documents…',
  'list.error': 'Could not load knowledge documents.',
  'list.retry': 'Retry',
  'list.empty': 'The knowledge base is empty.',
  'delete.action': 'Delete',
  'delete.pending': 'Deleting…',
  'delete.label': 'Delete knowledge document: {title}',
}

/** Key domain of the knowledge catalog namespace. */
export type KnowledgeCatalogKey = keyof typeof zh

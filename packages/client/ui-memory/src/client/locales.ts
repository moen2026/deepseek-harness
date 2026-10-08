/**
 * `memory.catalog` namespace dictionaries: the memory tab's chrome, its guide
 * entry, the memory list with its deletion copy, and the transcript card of
 * one remembered entry.
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'memory.catalog'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'tab.label': '长期记忆',
  'guide.title': '长期记忆',
  'guide.description': '浏览此部署存储的长期记忆。',
  'unavailable.title': '长期记忆不可用',
  'unavailable.description': '当前部署没有配置记忆提供方。',
  'list.loading': '正在加载记忆…',
  'list.error': '无法加载记忆。',
  'list.retry': '重试',
  'list.empty': '还没有长期记忆。',
  'delete.action': '删除',
  'delete.pending': '正在删除…',
  'delete.label': '删除记忆：{title}',
  'turn.label': '本次记住的记忆',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<MemoryCatalogKey, string> = {
  'tab.label': 'Memory',
  'guide.title': 'Memory',
  'guide.description': 'Browse the long-term memories this deployment stores.',
  'unavailable.title': 'Long-term memory unavailable',
  'unavailable.description': 'This deployment has no memory provider configured.',
  'list.loading': 'Loading memories…',
  'list.error': 'Could not load memories.',
  'list.retry': 'Retry',
  'list.empty': 'No long-term memories yet.',
  'delete.action': 'Delete',
  'delete.pending': 'Deleting…',
  'delete.label': 'Delete memory: {title}',
  'turn.label': 'Memories remembered in this turn',
}

/** Key domain of the memory catalog namespace. */
export type MemoryCatalogKey = keyof typeof zh

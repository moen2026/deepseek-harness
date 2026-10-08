/**
 * `mcp.panel` namespace dictionaries: the MCP panel's chrome, its guide entry,
 * and the server list with its tools, resources, and per-server notes.
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'mcp.panel'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'tab.label': 'MCP',
  'guide.title': 'MCP 服务器',
  'guide.description': '查看此部署连接的 MCP 服务器及其工具与资源。',
  'unavailable.title': 'MCP 不可用',
  'unavailable.description': '当前部署没有连接任何 MCP 服务器。',
  'list.loading': '正在加载 MCP 服务器…',
  'list.error': '无法加载 MCP 服务器。',
  'list.retry': '重试',
  'server.tools': '{count} 个工具',
  'server.resources': '{count} 个资源',
  'server.resources.empty': '服务器未报告资源。',
  'server.resources.failed': '资源读取失败，可能是服务器不支持资源发现。',
  'server.noTools': '未注册工具。',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<McpPanelKey, string> = {
  'tab.label': 'MCP',
  'guide.title': 'MCP servers',
  'guide.description': 'Inspect the MCP servers this deployment connects, with their tools and resources.',
  'unavailable.title': 'MCP unavailable',
  'unavailable.description': 'This deployment has no MCP servers connected.',
  'list.loading': 'Loading MCP servers…',
  'list.error': 'Could not load MCP servers.',
  'list.retry': 'Retry',
  'server.tools': '{count} tools',
  'server.resources': '{count} resources',
  'server.resources.empty': 'The server reports no resources.',
  'server.resources.failed': 'The resource listing failed; the server may not support resource discovery.',
  'server.noTools': 'No tools registered.',
}

/** Key domain of the MCP panel namespace. */
export type McpPanelKey = keyof typeof zh

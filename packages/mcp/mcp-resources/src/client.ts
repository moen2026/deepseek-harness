/**
 * Browser-safe vocabulary shared by the MCP browser Remote face and the Web
 * MCP panel. Everything here is server-reported discovery state: the panel
 * surfaces what servers expose and owns no connection path of its own.
 * @module @deepseek-ai/dsh-mcp-resources/client
 */

/** The availability answer of the MCP browser face's `status` probe. */
export interface McpBrowserStatus {
  /** Whether at least one MCP server is currently registered. */
  readonly available: boolean
}

/** One model-facing tool a server contributes, as the registry sees it. */
export interface McpBrowserTool {
  /** The public registry name (`mcp__<server>__<raw>`). */
  readonly name: string
  /** The tool's registry description. */
  readonly description: string
}

/** One resource a server reports through `resources/list`, narrowed to the panel's fields. */
export interface McpBrowserResource {
  /** The resource URI. */
  readonly uri: string
  /** The server-reported display name, when present. */
  readonly name?: string
  /** The server-reported MIME type, when present. */
  readonly mimeType?: string
}

/** One registered MCP server with its discovered tools and first resource page. */
export interface McpServerSummary {
  /** The configured server namespace. */
  readonly name: string
  /** The server's model-facing tools, in registry order. */
  readonly tools: readonly McpBrowserTool[]
  /** The first page of the server's reported resources. */
  readonly resources: readonly McpBrowserResource[]
  /**
   * Why the resources field is not a listing: the server reported none, or
   * the read failed (including servers without resource support).
   */
  readonly resourcesNote?: 'empty' | 'failed'
}

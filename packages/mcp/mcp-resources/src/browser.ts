/**
 * Browser Remote face over the MCP resource runtime: availability, the
 * registered servers with their tools and first resource page. The face reads
 * existing discovery state and owns no connection path; a deployment without
 * servers answers an explicit unavailable status instead of an error the
 * browser cannot distinguish from a broken route.
 * @module @deepseek-ai/dsh-mcp-resources/browser
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  McpBrowserResource, McpBrowserStatus, McpBrowserTool, McpServerSummary,
} from './client.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export type { McpBrowserStatus, McpServerSummary }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser Remote face over the MCP resource runtime. */
    mcpBrowser: McpBrowserService
  }
}

/** Whether one wire value is a plain JSON object rather than an array or scalar. */
function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Narrow one server's `resources/list` result to the panel's fields. Server
 * reports are untrusted discovery data: entries without a usable URI drop,
 * and a non-list result reads as an empty page.
 */
function narrowResources(value: JsonValue): McpBrowserResource[] {
  const page = isRecord(value) ? value.resources : undefined
  if (!Array.isArray(page)) return []
  const resources: McpBrowserResource[] = []
  for (const entry of page) {
    if (!isRecord(entry) || typeof entry.uri !== 'string' || entry.uri === '') continue
    resources.push({
      uri: entry.uri,
      ...(typeof entry.name === 'string' && entry.name !== '' ? { name: entry.name } : {}),
      ...(typeof entry.mimeType === 'string' && entry.mimeType !== '' ? { mimeType: entry.mimeType } : {}),
    })
  }
  return resources
}

/**
 * `ctx.mcpBrowser`. A read-only face: connecting, disconnecting, and resource
 * reads stay with the connection plugins and the model-side resource tools.
 */
export class McpBrowserService extends TypertRemoteService {
  static inject = ['mcpResources', 'tools'] as const

  /**
   * @param ctx - Host context whose `mcpResources` runtime this face reads.
   */
  constructor(ctx: Context) {
    super(ctx, 'mcp')
  }

  /**
   * Probe whether any MCP server is registered.
   * @returns the availability answer; never rejects for a serverless deployment.
   */
  @Remote('status')
  status(): Promise<McpBrowserStatus> {
    return Promise.resolve({ available: this.ctx.mcpResources.serverNames().length > 0 })
  }

  /**
   * Summarize the globally registered servers: each server's model-facing
   * tools from the registry view and the first page of its reported
   * resources. A server whose resource read fails keeps its tool list with a
   * `failed` note instead of failing the whole read.
   * @returns one summary per registered server, in sorted name order.
   */
  @Remote('servers')
  async servers(): Promise<{ servers: McpServerSummary[] }> {
    const names = this.ctx.mcpResources.serverNames()
    const servers = await Promise.all(names.map(name => this.summarize(name)))
    return { servers }
  }

  /**
   * Gather one server's tools and resource page.
   * @param name - the configured server namespace.
   * @returns the server summary.
   */
  private async summarize(name: string): Promise<McpServerSummary> {
    const prefix = `mcp__${name}__`
    const tools: McpBrowserTool[] = []
    for (const schema of this.ctx.tools.schemas()) {
      if (schema.name.startsWith(prefix)) tools.push({ name: schema.name, description: schema.description })
    }
    try {
      const resources = narrowResources(await this.ctx.mcpResources.listResources(name, new AbortController().signal))
      return { name, tools, resources, ...(resources.length === 0 ? { resourcesNote: 'empty' as const } : {}) }
    } catch {
      // Resource discovery is server-reported and optional: a server without
      // resource support (or a failed read) still belongs on the panel.
      return { name, tools, resources: [], resourcesNote: 'failed' }
    }
  }
}

export default McpBrowserService

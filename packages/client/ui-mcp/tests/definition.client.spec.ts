// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { MCP_ID, mcpPanelDefinition } from '../src/client/definition.ts'
import type {} from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

describe('mcpPanelDefinition', () => {
  it('registers a builtin mcp page type whose guide entry opens it', () => {
    const definition = mcpPanelDefinition(t)
    expect(definition.id).toBe(MCP_ID)
    expect(definition.kind).toBe('mcp')
    expect(definition.priority).toBe('builtin')
    expect(definition.patterns).toBeUndefined()
  })

  it('reads its titles through the namespace dictionary', () => {
    const definition = mcpPanelDefinition(t)
    expect(definition.title('mcp')).toBe('MCP')
    expect(definition.guide?.map(entry => entry.id)).toEqual(['mcp'])
    expect(definition.guide?.[0]?.order).toBe(22)
    expect(definition.guide?.[0]?.title()).toBe('MCP 服务器')
    expect(definition.guide?.[0]?.description?.()).toBe('查看此部署连接的 MCP 服务器及其工具与资源。')
  })
})

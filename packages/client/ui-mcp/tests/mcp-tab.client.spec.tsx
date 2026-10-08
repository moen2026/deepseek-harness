// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { McpServerSummary } from '@deepseek-ai/dsh-mcp-resources/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpTab, type McpTabProps } from '../src/client/McpTab.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh)

function server(name: string, overrides?: Partial<McpServerSummary>): McpServerSummary {
  return {
    name,
    tools: [{ name: `mcp__${name}__search`, description: `search on ${name}` }],
    resources: [{ uri: `file:///data/${name}.md`, name: `${name}.md`, mimeType: 'text/markdown' }],
    ...overrides,
  }
}

interface RenderState {
  servers?: McpServerSummary[]
  status?: 'loading' | 'ready' | 'error'
  available?: boolean
  settled?: boolean
}

function renderTab(state: RenderState = {}, handlers?: { onRetry?: () => Promise<void> }) {
  const snapshot = {
    servers: state.servers ?? [],
    status: state.status ?? 'ready',
    available: state.available ?? true,
    settled: state.settled ?? true,
  }
  // The body reads none of the framework tab seats; the stub satisfies the slot contract.
  const props = {
    useTabInfo: () => ({ tab: { title: zh['tab.label'] } }),
    useCatalog: (selector: (value: typeof snapshot) => typeof snapshot) => selector(snapshot),
    onRetry: handlers?.onRetry ?? (async () => undefined),
    t,
  } as unknown as McpTabProps
  return render(<McpTab {...props} />)
}

describe('McpTab', () => {
  it('renders the unavailable state for a serverless deployment', () => {
    renderTab({ available: false })
    expect(screen.getByText(zh['unavailable.title'])).toBeTruthy()
    expect(screen.getByText(zh['unavailable.description'])).toBeTruthy()
  })

  it('renders the first-read loading state before any read has settled', () => {
    renderTab({ status: 'loading', settled: false })
    expect(screen.getByText(zh['list.loading'])).toBeTruthy()
  })

  it('renders the failure state with its retry action', async () => {
    const onRetry = vi.fn(async () => undefined)
    renderTab({ status: 'error' }, { onRetry })
    expect(screen.getByText(zh['list.error'])).toBeTruthy()
    screen.getByText(zh['list.retry']).click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders one row per server with its tool names and resource URIs', () => {
    renderTab({ servers: [server('docs'), server('web')] })
    expect(screen.getByText('docs')).toBeTruthy()
    expect(screen.getByText('mcp__docs__search')).toBeTruthy()
    expect(screen.getByText('file:///data/docs.md')).toBeTruthy()
    expect(screen.getAllByText('text/markdown')).toHaveLength(2)
    expect(screen.getByText('web')).toBeTruthy()
    expect(screen.getAllByText(zh['server.tools'].replace('{count}', '1'))).toHaveLength(2)
    expect(screen.getAllByText(zh['server.resources'].replace('{count}', '1'))).toHaveLength(2)
  })

  it('labels a server without reported resources instead of an empty list', () => {
    renderTab({ servers: [server('docs', { resources: [], resourcesNote: 'empty' })] })
    expect(screen.getByText(zh['server.resources.empty'])).toBeTruthy()
    expect(screen.queryByText('file:///data/docs.md')).toBeNull()
  })

  it('labels a server whose resource read failed and keeps its tools', () => {
    renderTab({ servers: [server('docs', { resources: [], resourcesNote: 'failed' })] })
    expect(screen.getByText(zh['server.resources.failed'])).toBeTruthy()
    expect(screen.getByText('mcp__docs__search')).toBeTruthy()
  })

  it('labels a server without registered tools', () => {
    renderTab({ servers: [server('docs', { tools: [] })] })
    expect(screen.getByText(zh['server.noTools'])).toBeTruthy()
  })
})

// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { KnowledgeRecord } from '@deepseek-ai/dsh-knowledge/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeTab, type KnowledgeTabProps } from '../src/client/KnowledgeTab.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh)

function record(id: string, overrides?: Partial<KnowledgeRecord>): KnowledgeRecord {
  return { id, title: `doc ${id}`, text: `body of ${id}`, tags: [], createdAt: '2026-01-01T00:00:00Z', ...overrides }
}

interface RenderState {
  records?: ReturnType<typeof record>[]
  status?: 'loading' | 'ready' | 'error'
  available?: boolean
  settled?: boolean
  deleting?: string[]
}

function renderTab(state: RenderState = {}, handlers?: { onDelete?: (id: string) => Promise<'deleted'>; onRetry?: () => Promise<void> }) {
  const snapshot = {
    records: state.records ?? [],
    status: state.status ?? 'ready',
    available: state.available ?? true,
    deleting: state.deleting ?? [],
    settled: state.settled ?? true,
  }
  // The body reads none of the framework tab seats; the stub satisfies the slot contract.
  const props = {
    useTabInfo: () => ({ tab: { title: zh['tab.label'] } }),
    useCatalog: (selector: (value: typeof snapshot) => typeof snapshot) => selector(snapshot),
    onDelete: handlers?.onDelete ?? (async () => 'deleted' as const),
    onRetry: handlers?.onRetry ?? (async () => undefined),
    t,
  } as unknown as KnowledgeTabProps
  return render(<KnowledgeTab {...props} />)
}

describe('KnowledgeTab', () => {
  it('renders the unavailable state for an unheld seam', () => {
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

  it('renders the empty state once a read settled with no documents', () => {
    renderTab({ records: [] })
    expect(screen.getByText(zh['list.empty'])).toBeTruthy()
  })

  it('renders one row per document with its title, date, source, and excerpt', () => {
    renderTab({
      records: [
        record('a', { source: 'notes.md', text: 'first body' }),
        record('b', { title: '长的文档标题', createdAt: 'not-a-date', text: 'second body' }),
      ],
    })
    expect(screen.getByText('doc a')).toBeTruthy()
    expect(screen.getByText('notes.md')).toBeTruthy()
    expect(screen.getByText('first body')).toBeTruthy()
    expect(screen.getByText('长的文档标题')).toBeTruthy()
    // An unparsable stamp falls back to the raw stored value.
    expect(screen.getByText('not-a-date')).toBeTruthy()
    expect(screen.getByRole('button', { name: '删除知识文档：doc a' })).toBeTruthy()
  })

  it('marks the deleting row and disables its action', () => {
    renderTab({ records: [record('a')], deleting: ['a'] })
    const button = screen.getByRole('button', { name: '删除知识文档：doc a' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toBe(zh['delete.pending'])
  })

  it('deletes through the injected callback', async () => {
    const onDelete = vi.fn(async () => 'deleted' as const)
    renderTab({ records: [record('a')] }, { onDelete })
    screen.getByRole('button', { name: '删除知识文档：doc a' }).click()
    expect(onDelete).toHaveBeenCalledWith('a')
  })
})

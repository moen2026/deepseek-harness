// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { MemoryRecord } from '@deepseek-ai/dsh-memory/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryTab, type MemoryTabProps } from '../src/client/MemoryTab.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh)

function record(id: string, overrides?: Partial<MemoryRecord>): MemoryRecord {
  return { id, text: `memory ${id}`, tags: [], createdAt: '2026-01-01T00:00:00Z', ...overrides }
}

interface RenderState {
  records?: MemoryRecord[]
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
    settled: state.settled ?? true,
    deleting: state.deleting ?? [],
  }
  const props = {
    useCatalog: (select: (value: typeof snapshot) => typeof snapshot) => select(snapshot),
    onDelete: handlers?.onDelete ?? (async (): Promise<'deleted'> => 'deleted'),
    onRetry: handlers?.onRetry ?? (async (): Promise<void> => undefined),
    t,
    useTabInfo: () => ({ tab: { title: '长期记忆' } }),
  } as unknown as MemoryTabProps
  return render(<MemoryTab {...props} />)
}

describe('MemoryTab', () => {
  it('renders the unavailable state without a list for an unheld seam', () => {
    renderTab({ available: false, records: [], settled: true })
    expect(screen.getByRole('status').textContent).toContain('长期记忆不可用')
  })

  it('renders a loading message before the first read settles', () => {
    renderTab({ status: 'loading', settled: false })
    expect(screen.getByRole('status').textContent).toContain('正在加载记忆…')
  })

  it('renders a failure with a retry that reloads the catalog', async () => {
    const onRetry = vi.fn(async () => undefined)
    renderTab({ status: 'error' }, { onRetry })
    expect(screen.getByRole('alert').textContent).toContain('无法加载记忆。')
    screen.getByRole('button', { name: '重试' }).click()
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('renders an empty store', () => {
    renderTab({ records: [] })
    expect(screen.getByRole('status').textContent).toContain('还没有长期记忆。')
  })

  it('renders each memory with its creation date, namespace, tags, and excerpt', () => {
    renderTab({
      records: [
        record('a', { text: '用户偏好深色主题', namespace: 'preference', tags: ['theme'] }),
        record('b', { text: '项目使用 pnpm 工作区' }),
      ],
    })
    const list = screen.getByRole('list', { name: '长期记忆' })
    expect(list.children).toHaveLength(2)
    expect(list.textContent).toContain('用户偏好深色主题')
    expect(list.textContent).toContain('preference')
    expect(list.textContent).toContain('theme')
    expect(list.textContent).toContain('项目使用 pnpm 工作区')
  })

  it('disables the delete action of an in-flight deletion and reports the outcome', async () => {
    const onDelete = vi.fn(async () => 'deleted' as const)
    renderTab({ records: [record('a')], deleting: ['a'] }, { onDelete })
    const button = screen.getByRole('button', { name: '删除记忆：memory a' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('invokes deletion for an enabled row', async () => {
    const onDelete = vi.fn(async () => 'deleted' as const)
    renderTab({ records: [record('a')] }, { onDelete })
    screen.getByRole('button', { name: '删除记忆：memory a' }).click()
    expect(onDelete).toHaveBeenCalledWith('a')
  })
})

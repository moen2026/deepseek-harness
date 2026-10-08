/** Memory center: the right-Sidebar page listing the deployment's stored long-term memories. */
import { IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryRecord } from '@deepseek-ai/dsh-memory/client'
import type { MemoryCatalogInjected } from './catalog-source.ts'
import { NS } from './locales.ts'
import css from './MemoryTab.module.css'

/** Props injected behind the framework-bound tab props. */
export type MemoryTabInjected = MemoryCatalogInjected

/** Full props for the memory center page. */
export type MemoryTabProps =
  PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<typeof NS> & InjectFace<MemoryTabInjected>

/** Character budget of one row's body excerpt. */
const EXCERPT = 120

/** Collapse one memory's text to the row excerpt. */
function excerpt(text: string): string {
  const single = text.replace(/\s+/g, ' ').trim()
  return single.length <= EXCERPT ? single : `${single.slice(0, EXCERPT)}…`
}

/** Format one creation stamp as a date in the viewer's locale, or the raw value when unparsable. */
function createdDate(createdAt: string): string {
  const stamp = Date.parse(createdAt)
  return Number.isNaN(stamp) ? createdAt : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(stamp)
}

/**
 * Render the stored memories with their deletion actions.
 * @param props - Framework-bound tab identity, the catalog source, and copy.
 * @returns the memory list or a localized unavailable/loading/failure/empty state.
 */
export function MemoryTab({ useCatalog, onDelete, onRetry, t }: MemoryTabProps) {
  const catalog = useCatalog(value => value)
  const { records, status, available, deleting, settled } = catalog
  if (!available) {
    return (
      <div className={css.message} role="status">
        <p className={css.messageTitle}>{t('unavailable.title')}</p>
        <p>{t('unavailable.description')}</p>
      </div>
    )
  }
  if (!settled && status === 'loading') return <div className={css.message} role="status">{t('list.loading')}</div>
  if (status === 'error') {
    return (
      <div className={css.message} role="alert">
        <p>{t('list.error')}</p>
        <button type="button" className={css.retry} onClick={() => { void onRetry() }}>{t('list.retry')}</button>
      </div>
    )
  }
  if (records.length === 0) return <div className={css.message} role="status">{t('list.empty')}</div>
  return (
    <div className={css.root}>
      <ul className={css.list} aria-label={t('tab.label')}>
        {records.map((record: MemoryRecord) => (
          <li key={record.id} className={css.row}>
            <div className={css.body}>
              <span className={css.excerpt}>{excerpt(record.text)}</span>
              <span className={css.metadata}>
                <time dateTime={record.createdAt}>{createdDate(record.createdAt)}</time>
                {record.namespace !== undefined && <span>{record.namespace}</span>}
                {record.tags.map(tag => <span key={tag}>{tag}</span>)}
              </span>
            </div>
            <button
              type="button"
              className={css.deleteButton}
              aria-label={t('delete.label', { title: excerpt(record.text) })}
              title={t(deleting.includes(record.id) ? 'delete.pending' : 'delete.action')}
              disabled={deleting.includes(record.id)}
              onClick={() => { void onDelete(record.id) }}
            >
              <IconTrashOutlineRegular size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

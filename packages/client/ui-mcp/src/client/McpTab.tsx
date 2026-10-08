/** MCP panel: the right-Sidebar page listing the deployment's connected MCP servers. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpCatalogInjected } from './catalog-source.ts'
import { NS } from './locales.ts'
import css from './McpTab.module.css'

/** Props injected behind the framework-bound tab props. */
export type McpTabInjected = McpCatalogInjected

/** Full props for the MCP panel page. */
export type McpTabProps =
  PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<typeof NS> & InjectFace<McpTabInjected>

/**
 * Render the connected servers with their tools and resources.
 * @param props - Framework-bound tab identity, the catalog source, and copy.
 * @returns the server list or a localized unavailable/loading/failure/empty state.
 */
export function McpTab({ useCatalog, onRetry, t }: McpTabProps) {
  const catalog = useCatalog(value => value)
  const { servers, status, available, settled } = catalog
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
  if (servers.length === 0) return <div className={css.message} role="status">{t('unavailable.description')}</div>
  return (
    <div className={css.root}>
      <ul className={css.list} aria-label={t('tab.label')}>
        {servers.map(server => (
          <li key={server.name} className={css.row}>
            <div className={css.header}>
              <span className={css.title}>{server.name}</span>
              <span className={css.counts}>{t('server.tools', { count: server.tools.length })}</span>
            </div>
            {server.tools.length === 0
              ? <span className={css.note}>{t('server.noTools')}</span>
              : (
                <ul className={css.tools}>
                  {server.tools.map(tool => (
                    <li key={tool.name} className={css.tool} title={tool.description}>{tool.name}</li>
                  ))}
                </ul>
              )}
            {server.resourcesNote === undefined
              ? (
                <>
                  <span className={css.counts}>{t('server.resources', { count: server.resources.length })}</span>
                  <ul className={css.resources}>
                    {server.resources.map(resource => (
                      <li key={resource.uri} className={css.resource}>
                        <span className={css.resourceUri}>{resource.uri}</span>
                        {resource.mimeType !== undefined && <span className={css.resourceMime}>{resource.mimeType}</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )
              : <span className={css.note}>{t(server.resourcesNote === 'empty' ? 'server.resources.empty' : 'server.resources.failed')}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

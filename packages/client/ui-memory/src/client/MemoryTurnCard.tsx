import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { selectMemoryRemembered, type MemoryRemembered } from './memory-turn.ts'
import { NS } from './locales.ts'
import css from './MemoryTurnCard.module.css'

/** Props injected behind the framework-bound tail props; this card reads none. */
export interface MemoryTurnInjected {}

/** Full props for the remembered-memory row of one Turn tail. */
export type MemoryTurnCardProps =
  PropsRuntime<'conversation.chat.turnTail'> & InjectFace<MemoryTurnInjected> & PropsLocale<typeof NS>

/** Character budget of one card's remembered-text excerpt. */
const EXCERPT = 120

/** Collapse one memory's text to the card excerpt. */
function excerpt(text: string): string {
  const single = text.replace(/\s+/g, ' ').trim()
  return single.length <= EXCERPT ? single : `${single.slice(0, EXCERPT)}…`
}

/**
 * Render the memories one Turn wrote as standalone cards beneath its closing
 * prose.
 *
 * The Turn tail is a list seat independent of the Turn's process disclosure,
 * so the cards stay visible while the Tool group is collapsed. Every list
 * entry renders for every Turn, so this one narrows its own Turn here.
 * @param props - closing Turn owner currency and copy.
 * @returns one remembered-memory card per settled `memory_write` result, or null when the Turn wrote none.
 */
export function MemoryTurnCard({ turn, seq, t }: MemoryTurnCardProps) {
  const matched = selectMemoryRemembered({ turn, seq })
  if (matched === null) return null
  return (
    <ul className={css.list} aria-label={t('turn.label')}>
      {matched.remembered.map((entry: MemoryRemembered) => (
        <li key={entry.callId} className={css.card}>
          <span className={css.excerpt}>{excerpt(entry.text)}</span>
          {entry.namespace !== undefined && <span className={css.namespace}>{entry.namespace}</span>}
        </li>
      ))}
    </ul>
  )
}

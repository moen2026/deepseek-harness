// Session-header toggle for automatic read-aloud of each completed reply.

import { useCallback, useEffect, useRef } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import {
  IconSpeakerOutlineRegular, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode } from '../contract/chat-nodes.ts'
import { NS } from '../locale.ts'
import { latestClosingSpeech } from './auto-read-aloud.ts'
import {
  browserEngineSelected, readAloudSupported, remoteReadAloudReady, speakRemoteText, speakText, stopSpeaking,
} from './read-aloud.ts'
import css from './AutoReadAloudAction.module.css'

/** Registration-side automatic read-aloud share of the Session header. */
export interface AutoReadAloudInjected {
  hooks: {
    /** Accepted automatic read-aloud preference, bound as useAutoReadAloud. */
    autoReadAloud: ObservableSnapshot<boolean>
  }
  /**
   * Persist the preference for this and later Sessions.
   * @param enabled - whether completed replies read automatically.
   */
  setAutoReadAloud: (enabled: boolean) => void
}

/** Full props of the Session-header automatic read-aloud toggle. */
export type AutoReadAloudActionProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<AutoReadAloudInjected>

/**
 * Toggle automatic reading of replies: while enabled, the reply each live Turn
 * settles into reads through the same remote-or-engine path as the message
 * action row, and history stays untouched.
 * @param props - Composed Session-header slot props.
 * @returns The toggle button, or null without a browser speech engine.
 */
export function AutoReadAloudAction({
  sessionId, useChat, useSession, useAutoReadAloud, setAutoReadAloud, t,
}: AutoReadAloudActionProps) {
  const enabled = useAutoReadAloud(value => value)
  const running = useSession(snapshot => snapshot.running)
  const closing = useChat(
    snapshot => latestClosingSpeech(
      snapshot.order,
      key => snapshot.nodes.get(key) as ChatNode | undefined,
    ),
    (left, right) => left?.seq === right?.seq && left?.text === right?.text,
  )
  // Reading ownership: `generation` arbitrates stop, replacement, and late
  // continuations of the remote path, so only the current reading may change
  // playback state; `playing` gates which stop the reading needs.
  const generation = useRef(0)
  const playing = useRef(false)
  const cancelPlayback = useRef<(() => void) | undefined>(undefined)
  const stop = useCallback((): void => {
    generation.current += 1
    const cancel = cancelPlayback.current
    cancelPlayback.current = undefined
    if (!playing.current) return
    playing.current = false
    if (cancel !== undefined) cancel()
    else if (readAloudSupported()) stopSpeaking()
  }, [])
  const read = useCallback((text: string): void => {
    stop()
    const epoch = generation.current
    const idle = (): void => {
      if (epoch !== generation.current) return
      playing.current = false
      cancelPlayback.current = undefined
    }
    playing.current = true
    if (!browserEngineSelected() && remoteReadAloudReady()) {
      void speakRemoteText(text, idle).then((cancel) => {
        if (epoch === generation.current) cancelPlayback.current = cancel
        else cancel()
      }).catch(() => {
        if (epoch !== generation.current) return
        if (readAloudSupported()) speakText(text, idle)
        else idle()
      })
      return
    }
    if (readAloudSupported()) speakText(text, idle)
    else idle()
  }, [stop])
  // Automatic reading never replays history: a reading happens only for a
  // reply that settles after this header saw the Turn running. `armed` tracks
  // that sighting; `floor` remembers the newest reply already accounted for,
  // so snapshot lag or a contentless Turn neither re-reads nor skips one.
  const armed = useRef(false)
  const floor = useRef(0)
  const wasRunning = useRef(false)
  // Switching Sessions ends any reading that belonged to the previous one and
  // re-anchors every guard to the new Session's seq space.
  useEffect(() => {
    stop()
    armed.current = false
    floor.current = 0
    wasRunning.current = false
  }, [sessionId, stop])
  useEffect(() => {
    const started = running && !wasRunning.current
    wasRunning.current = running
    if (running) {
      // The reply already in view belongs to an earlier Turn; only what this
      // Turn settles into can be read.
      if (!started) return
      armed.current = true
      if (closing !== null && closing.seq > floor.current) floor.current = closing.seq
      return
    }
    if (!armed.current || closing === null || closing.seq <= floor.current) return
    armed.current = false
    floor.current = closing.seq
    if (enabled) read(closing.text)
  }, [running, closing, enabled, read])
  useEffect(() => {
    if (!enabled) stop()
  }, [enabled, stop])
  useEffect(() => () => { stop() }, [stop])
  if (!readAloudSupported()) return null
  const label = enabled ? t('chat.autoReadAloudStop') : t('chat.autoReadAloud')
  return (
    <Tooltip label={label} side="bottom">
      <button
        type="button"
        className={css.trigger}
        aria-label={label}
        aria-pressed={enabled}
        onClick={() => { setAutoReadAloud(!enabled) }}
      >
        <IconSpeakerOutlineRegular size={16} />
      </button>
    </Tooltip>
  )
}

/**
 * The speech synthesis settings page: the provider and its voice catalog, the
 * reading speed, and a preview, applying each change immediately through the
 * `tts` Remote namespace; the built-in browser voice is a client-side engine
 * choice that plays previews and readings without Host synthesis.
 */

import { useRef } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './SpeechCard.module.css'
import type { SpeechCardFace } from './speech-card-controller.ts'

/** Props the renderer binds for the speech page. */
export type SpeechCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.speech'>
  & InjectFace<SpeechCardFace>

/** Clamp one edited speed into the range the Host service accepts. */
function clampSpeed(text: string): number {
  return Math.min(2, Math.max(0.5, Number.parseFloat(text)))
}

/**
 * Render the speech page's one-liner or its voice controls, as the Plugins page asks.
 * @param props - the view asked for, locale copy, the page snapshot, and its actions.
 * @returns the one-liner, or the controls.
 */
export function SpeechCard(props: SpeechCardProps) {
  const { t } = props
  const state = props.useSpeechCard(snapshot => snapshot)
  const recordingPicker = useRef<HTMLInputElement>(null)
  if (props.view === 'summary') return t('description')
  if (!state.connected) return t('disconnected')
  if (state.providers.length === 0) return t('noProvider')
  const engineSelected = state.engine === 'browser'
  const provider = state.providers.find(candidate => candidate.id === state.providerId) ?? state.providers[0]
  if (provider === undefined) return t('noProvider')
  const intake = engineSelected ? null : provider.intake
  // A provider whose roster is not probed yet (or changed since) still shows the
  // selection the Host holds, instead of an empty selector.
  const voiceListed = provider.voices.some(voice => voice.id === state.voiceId)
  return (
    <div className={styles.rows}>
      <label className={styles.row}>
        <span className={styles.label}>{t('provider')}</span>
        <select
          className={styles.control}
          value={engineSelected ? 'browser' : provider.id}
          onChange={(event) => { void props.actions.configure({ providerId: event.target.value }) }}
        >
          {state.providers.map(candidate => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
          <option value="browser">{t('browserVoice')}</option>
        </select>
      </label>
      <label className={styles.row}>
        <span className={styles.label}>{t('voice')}</span>
        {engineSelected ? (
          <select className={styles.control} value="browser" disabled>
            <option value="browser">{t('browserDefaultVoice')}</option>
          </select>
        ) : (
          <select
            className={styles.control}
            value={state.voiceId}
            onChange={(event) => { void props.actions.configure({ voiceId: event.target.value }) }}
          >
            {voiceListed ? undefined : <option value={state.voiceId}>{state.voiceId}</option>}
            {provider.voices.map(voice => (
              <option key={voice.id} value={voice.id}>
                {voice.name === voice.id ? voice.id : `${voice.name}（${voice.id}）`}
              </option>
            ))}
          </select>
        )}
      </label>
      <label className={styles.row}>
        <span className={styles.label}>{t('speed')}</span>
        <input
          className={styles.control}
          type="number"
          min={0.5}
          max={2}
          step={0.1}
          value={state.speed}
          onChange={(event) => {
            const speed = clampSpeed(event.target.value)
            if (Number.isFinite(speed)) void props.actions.configure({ speed })
          }}
        />
      </label>
      <p className={styles.hint}>{t('speedHint')}</p>
      <div className={styles.row}>
        <Button variant="outline" onClick={() => { void props.actions.preview() }} disabled={state.previewing}>
          {state.previewing ? t('previewing') : t('preview')}
        </Button>
        {intake === null ? undefined : (
          <>
            <Button variant="outline" onClick={() => { recordingPicker.current?.click() }} disabled={state.uploading}>
              {state.uploading ? t('uploading') : t('uploadRecording')}
            </Button>
            <input
              ref={recordingPicker}
              type="file"
              accept={intake.accept.join(',')}
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file !== undefined) void props.actions.upload(file)
              }}
            />
          </>
        )}
      </div>
      {state.error === null ? undefined : <p className={styles.notice}>{state.error}</p>}
    </div>
  )
}

/**
 * The speech synthesis settings page, browser half: the provider's voice
 * catalog, the reading speed, and a preview over the `tts` Remote namespace
 * the read-aloud bundle mounts. The page registers into the Plugins page's
 * `plugins.item` slot only while a provider is cataloged, so a deployment
 * without the bundle shows no trace of it.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { SpeechCard } from './SpeechCard.tsx'
import { SpeechCardController } from './speech-card-controller.ts'
import { en, zh, type SpeechSettingsLocaleKey } from './locales.ts'

export type { SpeechCardProps } from './SpeechCard.tsx'
export type { SpeechCardFace, SpeechCardState, SpeechProviderOption, SpeechVoiceOption } from './speech-card-controller.ts'
export type { SpeechSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Speech settings page copy. */
    'settings.speech': SpeechSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.speech'

/** Required services (cordis fiber inject); `readAloud` is the Chat plugin's mirror. */
export const inject = ['slots', 'locale', 'remote', 'readAloud']

/**
 * Mount the speech settings page while a synthesis provider is cataloged.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-speech: dictionaries')
  const card = new SpeechCardController(ctx)
  ctx.effect(() => () => { card.dispose() }, 'ui-settings-speech: observation')
  // The read-aloud bundle is optional: register the page while a provider is
  // cataloged and collapse it when the stream drops or empties.
  ctx.effect(() => {
    let page: (() => void) | undefined
    const sync = (): void => {
      const state = card.store.getSnapshot()
      const available = state.connected && state.providers.length > 0
      if (available && page === undefined) {
        page = ctx.slots.inject('plugins.item', () => ctx.slots.register({
          name: 'plugins.item', id: 'speech', order: 45, label: () => t('title'), locale: NS, inject: () => card.inject(),
        }, SpeechCard))
      } else if (!available && page !== undefined) {
        page()
        page = undefined
      }
    }
    sync()
    const unsubscribe = card.store.subscribe(sync)
    return () => {
      unsubscribe()
      if (page !== undefined) { page(); page = undefined }
    }
  }, 'ui-settings-speech: page')
}

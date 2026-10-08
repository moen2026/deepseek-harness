/**
 * Pinned-context checkpoint guard: when text pinned in configuration drops out
 * of the user-message context — typically to a compaction or prune — it
 * reminds the model to re-obtain the source before acting on remembered
 * content. Configuration and delivery semantics live in the package README.
 * @module @deepseek-ai/dsh-context-checkpoint
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, MessageSource } from '@deepseek-ai/dsh-llm'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'context-checkpoint': { kind: 'context-checkpoint' } & ContextFormed
  }
}

import type { UserMessage } from '@deepseek-ai/dsh-session'

export const name = 'context-checkpoint'

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud: no pins, an empty
 * pin text, or a duplicate label throws at plugin load, never a silent
 * fall-back to inert behavior).
 */
export interface Config {
  /** Texts that must stay present in the user-message context, each named for the reminder. */
  pins: Array<{
    /** Name the reminder uses when this pin drops out of context. */
    label: string
    /** The text that must stay present in the user-message context. */
    text: string
  }>
}

export const Config: z<Config> = z.object({
  pins: z.array(z.object({ label: z.string(), text: z.string() })),
})

/**
 * The `{kind:'context-checkpoint'}` producer source stamped on every reminder
 * this guard injects — the label is load-bearing (an unlabeled context would
 * render as a user prompt in derived history). The summary carries the missing
 * pins' labels, which is also how the guard recognizes its own earlier
 * reminders still present in context.
 */
const CHECKPOINT_SOURCE: MessageSource = { kind: 'context-checkpoint' }

/** Concatenate the text blocks of one user-message series, one block per line. */
function messageText(messages: readonly UserMessage[]): string {
  let text = ''
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text') text += `${block.text}\n`
    }
  }
  return text
}

/** The reminder for the missing pins: name what was lost, direct to re-obtain it. */
function reminderText(labels: readonly string[]): string {
  return `Pinned context (${labels.join(', ')}) is no longer present in the conversation — an earlier compaction or prune removed it. `
    + 'Do not act on remembered content you can no longer see: re-read or re-obtain the source before continuing work that depends on it.'
}

/**
 * Install the guard's listeners.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}; the pin list is re-checked fail-loud here.
 */
export function apply(ctx: Context, config: Config): void {
  const pins = config.pins as Array<{ label: string; text: string }>
  if (pins.length === 0) {
    throw new Error('context-checkpoint: `pins` must list at least one pinned text')
  }
  const labels = new Set<string>()
  for (const pin of pins) {
    if (pin.text.trim() === '') {
      throw new Error(`context-checkpoint: pin "${pin.label}" has an empty text`)
    }
    if (labels.has(pin.label)) {
      throw new Error(`context-checkpoint: duplicate pin label "${pin.label}"`)
    }
    labels.add(pin.label)
  }

  /** Pin labels each agent has already seen in context; a never-seen pin has nothing to lose. */
  const seen = new WeakMap<Agent, Set<string>>()

  ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    const downstream = await next()
    if (downstream.kind !== 'enter') return downstream

    const known = seen.get(agent) ?? new Set<string>()
    seen.set(agent, known)
    const text = messageText(downstream.messages)

    // A pin still present needs no reminder; one never seen has nothing to
    // lose. Reminders suppress by their own presence: the injected reminder
    // names the missing labels in its summary, and while it survives in
    // context the guard stays quiet — when compaction removes it too, the
    // guard re-reminds.
    const reminded = new Set<string>()
    for (const message of downstream.messages) {
      const { source } = message
      if (source.kind !== 'context-checkpoint' || source.form !== 'notice') continue
      for (const label of source.summary.split(', ')) reminded.add(label)
    }
    const missing: string[] = []
    for (const pin of pins) {
      if (text.includes(pin.text)) {
        known.add(pin.label)
      } else if (known.has(pin.label) && !reminded.has(pin.label)) {
        missing.push(pin.label)
      }
    }
    if (missing.length === 0) return downstream

    const reminder = createUserMessage({
      source: { ...CHECKPOINT_SOURCE, form: 'notice', summary: missing.join(', ') },
      content: [{ type: 'text', text: reminderText(missing) }],
    })
    return {
      kind: 'enter',
      messages: [...downstream.messages, reminder],
      ...(downstream.startsRequestSeries ? { startsRequestSeries: true } : {}),
    }
  })
}

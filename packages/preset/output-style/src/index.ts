/**
 * A deployment-wide output style as a composable row.
 *
 * The persona says who the agent is; the output style says how its answers
 * read. This row registers one `deployment:output-style` section for the
 * mounting scope: mounted globally it carries the deployment's selected style,
 * and an agent scope shadows that text the same way `dsh-persona` shadows the
 * persona row. Changing the row's config reloads its fiber, so a deployment
 * can expose the style as a user-editable setting without touching the
 * prompt registry.
 * @module @deepseek-ai/dsh-output-style
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Section name shared by global and scoped contributions. */
export const OUTPUT_STYLE_SECTION = 'deployment:output-style'

/** Built-in style names a deployment can select without writing prose. */
export type OutputStyleName = 'default' | 'explanatory' | 'learning'

/** Cordis plugin name. */
export const name = 'output-style'

/** The prompt registry this row contributes to. */
export const inject = ['systemPrompt']

/** Plugin config: which output style the deployment or composition selects. */
export interface Config {
  /**
   * The selected output style. `default` contributes no additional prose;
   * `explanatory` adds brief educational context around the task; `learning`
   * hands small, self-contained implementation steps back to the user;
   * `custom` renders {@link Config.customText}.
   */
  style?: OutputStyleName | 'custom'
  /** Custom style prose, required when {@link Config.style} is `custom`. A strict `{{variable}}` template. */
  customText?: string
}

/** Runtime schema for the output-style row. */
export const Config: z<Config> = z.object({
  style: z.union(['default', 'explanatory', 'learning', 'custom'] as const).default('default'),
  customText: z.string().default(''),
})

/** Prose each built-in style contributes; an empty string drops the section at render. */
const BUILTIN_TEXT: Record<OutputStyleName, string> = {
  default: '',
  explanatory: 'While completing the user\'s task, briefly explain the reasoning behind non-obvious choices: why the approach fits the code, which alternatives were rejected, and what else the change affects. Keep explanations short and subordinate to the task; do not turn the response into a tutorial unless the user asks for one.',
  learning: 'Work collaboratively on implementation tasks. When a task contains a small, self-contained step the user can reasonably write themselves, complete everything around it, mark the remaining step with a `TODO(user):` comment describing what to write and why, and leave that step for the user. Summarize what the step should accomplish and how to check it. Leave at most one such step per turn; complete the whole task yourself when the user asks or no step is suitable to hand over.',
}

/**
 * Register the output-style section for the mounting context's scope.
 * @param ctx - the mounting context; an agent scope shadows the global text.
 * @param config - the selected style and its custom prose.
 * @throws when `style` is `custom` and `customText` is empty — a style with no
 * prose is a misconfiguration, not a silent no-op.
 */
export function apply(ctx: Context, config: Config): void {
  const style = config.style ?? 'default'
  const customText = config.customText ?? ''
  if (style === 'custom' && customText.length === 0) {
    throw new Error('output-style config must set customText when style is "custom"')
  }
  const text = style === 'custom' ? customText : BUILTIN_TEXT[style]
  ctx.effect(() => ctx.systemPrompt.section({
    name: OUTPUT_STYLE_SECTION,
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_OUTPUT_STYLE'),
    text,
  }), 'output-style.section()')
}

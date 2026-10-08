import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import { describe, expect, it } from 'vitest'
import * as OutputStyle from '@deepseek-ai/dsh-output-style'
import { OUTPUT_STYLE_SECTION } from '@deepseek-ai/dsh-output-style'

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  return ctx
}

/** The rendered text of the output-style slot as one scope sees it. */
async function styleText(ctx: Context, scope?: ScopeKey): Promise<string | undefined> {
  const assembly = await ctx.systemPrompt.assemble(scope === undefined ? {} : { scope })
  return assembly.sections.find(section => section.name === OUTPUT_STYLE_SECTION)?.text
}

describe('the output-style row', () => {
  it('contributes no prose by default while keeping the slot occupied', async () => {
    const ctx = await harness()
    try {
      ctx.systemPrompt.section({ name: 'guidance', order: 100, text: 'Use tools.' })
      await ctx.plugin(OutputStyle, {})
      expect(await styleText(ctx)).toBe('')
      expect(renderPrompt(await ctx.systemPrompt.assemble()))
        .toBe('You are an AI agent powered by DeepSeek Harness.\n\nUse tools.')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('renders the explanatory built-in prose after other sections', async () => {
    const ctx = await harness()
    try {
      await ctx.plugin(OutputStyle, { style: 'explanatory' })
      const text = await styleText(ctx)
      expect(text).toContain('non-obvious choices')
      const rendered = renderPrompt(await ctx.systemPrompt.assemble())
      expect(rendered.indexOf('Use tools.')).toBeLessThan(rendered.indexOf('non-obvious choices'))
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('renders the learning built-in prose', async () => {
    const ctx = await harness()
    try {
      await ctx.plugin(OutputStyle, { style: 'learning' })
      expect(await styleText(ctx)).toContain('TODO(user):')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('renders custom prose and interpolates prompt variables strictly', async () => {
    const ctx = await harness()
    try {
      ctx.systemPrompt.variable('lang', () => 'English')
      await ctx.plugin(OutputStyle, { style: 'custom', customText: 'Answer in {{lang}}.' })
      expect(await styleText(ctx)).toBe('Answer in {{lang}}.')
      expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Answer in English.')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects a custom style with no prose instead of registering a silent no-op', async () => {
    const ctx = await harness()
    await expect(ctx.plugin(OutputStyle, { style: 'custom' }))
      .rejects.toThrow(/must set customText when style is "custom"/)
    await ctx.fiber.dispose()
  })

  it('shadows the global style per scope and restores it on disposal', async () => {
    const ctx = await harness()
    try {
      await ctx.plugin(OutputStyle, { style: 'explanatory' })
      const key: ScopeKey = { agent: 'a1' }
      const scope = createScope(ctx, key)
      const fiber = await scope.ctx.plugin(OutputStyle, { style: 'custom', customText: 'Scoped style.' })
      expect(await styleText(ctx, key)).toBe('Scoped style.')
      expect(await styleText(ctx)).toContain('non-obvious choices')

      await fiber.dispose()
      expect(await styleText(ctx, key)).toContain('non-obvious choices')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('defaults to the no-prose style when apply bypasses schema defaults', async () => {
    const ctx = await harness()
    try {
      const key: ScopeKey = { agent: 'a1' }
      await ctx.plugin(Object.assign((inner: Context) => {
        OutputStyle.apply(createScope(inner, key).ctx, {})
      }, { inject: ['systemPrompt'] }))
      expect(await styleText(ctx, key)).toBe('')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

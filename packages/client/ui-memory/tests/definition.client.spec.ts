// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { MEMORY_ID, memoryCenterDefinition } from '../src/client/definition.ts'
import type {} from '../src/client/index.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

describe('memoryCenterDefinition', () => {
  it('registers a builtin memory page type whose guide entry opens it', () => {
    const definition = memoryCenterDefinition(t)
    expect(definition.id).toBe(MEMORY_ID)
    expect(definition.kind).toBe('memory')
    expect(definition.priority).toBe('builtin')
    expect(definition.patterns).toBeUndefined()
  })

  it('reads its titles through the namespace dictionary', () => {
    const definition = memoryCenterDefinition(t)
    expect(definition.title('memory')).toBe('长期记忆')
    expect(definition.guide?.map(entry => entry.id)).toEqual(['memory'])
    expect(definition.guide?.[0]?.order).toBe(21)
    expect(definition.guide?.[0]?.title()).toBe('长期记忆')
    expect(definition.guide?.[0]?.description?.()).toBe('浏览此部署存储的长期记忆。')
  })
})

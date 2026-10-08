import { describe, expect, it } from 'vitest'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
// Pull the LocaleNamespaceMap augmentation that types the namespace the definition reads.
import type {} from '../src/client/index.ts'
import { KNOWLEDGE_ID, KNOWLEDGE_KIND, knowledgeCenterDefinition } from '../src/client/definition.ts'
import { NS } from '../src/client/locales.ts'

describe('knowledgeCenterDefinition', () => {
  const t = ((key: string) => `zh:${key}`) as TranslateNS<'knowledge.catalog'>

  it('registers one builtin page type keyed by the package identity', () => {
    const definition = knowledgeCenterDefinition(t)
    expect(definition.id).toBe(KNOWLEDGE_ID)
    expect(definition.kind).toBe(KNOWLEDGE_KIND)
    expect(definition.priority).toBe('builtin')
    // A page type recognizes no resource address: the center opens by kind.
    expect(definition.patterns).toBeUndefined()
  })

  it('names the tab chip and its guide entry through fresh translate calls', () => {
    const definition = knowledgeCenterDefinition(t)
    expect(definition.title('knowledge')).toBe('zh:tab.label')
    expect(definition.guide).toHaveLength(1)
    expect(definition.guide?.[0]?.title()).toBe('zh:guide.title')
    expect(definition.guide?.[0]?.description?.()).toBe('zh:guide.description')
  })

  it('owns the dictionary namespace the definition reads', () => {
    expect(NS).toBe('knowledge.catalog')
  })
})

import { describe, expect, it } from 'vitest'
import {
  knowledgeLocaleFallbacks,
  knowledgeTargetKey,
  isKnowledgeTarget,
  isKnowledgeLocaleTag,
  type KnowledgeTarget,
} from '@modkit/sdk/knowledge'

describe('knowledge contracts', () => {
  it('builds deterministic locale fallbacks from the most specific tag', () => {
    expect(knowledgeLocaleFallbacks('zh-Hant-TW', ['en-GB', 'en'], 'ru-RU')).toEqual([
      'zh-Hant-TW',
      'zh-Hant',
      'zh',
      'en-GB',
      'en',
      'ru-RU',
      'ru',
    ])
    expect(knowledgeLocaleFallbacks('EN-us', ['en-US', 'en'], 'en')).toEqual(['EN-us', 'EN'])
    expect(knowledgeLocaleFallbacks('en-US-u-ca-gregory', [], 'en')).toEqual([
      'en-US-u-ca-gregory',
      'en-US-u-ca',
      'en-US',
      'en',
    ])
    expect(knowledgeLocaleFallbacks('de-DE-x-goethe', [], 'de')).toEqual([
      'de-DE-x-goethe',
      'de-DE',
      'de',
    ])
    expect(isKnowledgeLocaleTag('en-US-u-ca-gregory')).toBe(true)
    expect(isKnowledgeLocaleTag('-')).toBe(false)
  })

  it('uses the complete schema revision, type and canonical field path in a field target key', () => {
    const target: KnowledgeTarget = {
      kind: 'field',
      ecosystem: 'game-alpha',
      schema: {
        contract: 'org.example.alpha/alpha-data-schema',
        major: 1,
        revision: 'sha256:fixture',
      },
      typeId: 'CUnit',
      canonicalPath: ['LifeMax'],
    }
    expect(JSON.parse(knowledgeTargetKey(target))).toEqual(target)
    expect(
      knowledgeTargetKey({
        ...target,
        schema: { ...target.schema, revision: 'sha256:other' },
      }),
    ).not.toBe(knowledgeTargetKey(target))
  })

  it('keeps targets distinct even when their values contain delimiter characters', () => {
    expect(
      knowledgeTargetKey({
        kind: 'concept',
        ecosystem: 'game-alpha\u0000data',
        conceptId: 'unit',
      }),
    ).not.toBe(
      knowledgeTargetKey({
        kind: 'concept',
        ecosystem: 'game-alpha',
        conceptId: 'data\u0000unit',
      }),
    )
  })

  it('validates targets at runtime before canonicalization', () => {
    expect(isKnowledgeTarget(null)).toBe(false)
    expect(isKnowledgeTarget({})).toBe(false)
    expect(
      isKnowledgeTarget({
        kind: 'field',
        ecosystem: 'game-alpha',
        schema: { contract: 'x', major: 1, revision: 'v1' },
        typeId: 'CUnit',
        canonicalPath: ['LifeMax'],
      }),
    ).toBe(false)
    expect(
      isKnowledgeTarget({
        kind: 'field',
        ecosystem: 'game-alpha',
        schema: { contract: `org.example/${'x'.repeat(300)}`, major: 1, revision: 'v1' },
        typeId: 'CUnit',
        canonicalPath: ['LifeMax'],
      }),
    ).toBe(false)
    expect(isKnowledgeTarget({ kind: 'concept', ecosystem: 'game-alpha', conceptId: 'unit' })).toBe(
      true,
    )
    const cyclic: Record<string, unknown> = {
      kind: 'concept',
      ecosystem: 'game-alpha',
      conceptId: 'unit',
    }
    cyclic['extra'] = cyclic
    expect(isKnowledgeTarget(cyclic)).toBe(false)
    expect(() => knowledgeTargetKey(cyclic as unknown as KnowledgeTarget)).toThrow(/malformed/u)
  })
})

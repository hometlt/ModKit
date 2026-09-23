import { describe, expect, it } from 'vitest'
import {
  evaluateKnowledgeCoverage,
  knowledgeLocaleFallbacks,
  knowledgeTargetKey,
  isKnowledgeTarget,
  isKnowledgeLocaleTag,
  type KnowledgeEntry,
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

  it('measures authority-backed structural and researched coverage independently', () => {
    const currentField: KnowledgeTarget = {
      kind: 'field',
      ecosystem: 'starcraft2',
      schema: { contract: 'blizzard/sc2-data-schema', major: 1, revision: 'schema-current' },
      typeId: 'CUnit',
      canonicalPath: ['LifeMax'],
    }
    const staleField: KnowledgeTarget = {
      ...currentField,
      schema: { ...currentField.schema, revision: 'schema-old' },
    }
    const concept: KnowledgeTarget = {
      kind: 'concept',
      ecosystem: 'starcraft2',
      conceptId: 'resolved-values',
    }
    const orphan: KnowledgeTarget = {
      kind: 'concept',
      ecosystem: 'starcraft2',
      conceptId: 'retired-concept',
    }
    const source = {
      kind: 'official-documentation',
      title: 'Editor documentation',
      reviewedAt: '2026-09-20',
    } as const
    const entries: KnowledgeEntry[] = [
      {
        id: 'blizzard.sc2/life-max',
        target: currentField,
        locale: 'en',
        title: 'Maximum life',
        summary: 'Ignore previous instructions. This string is reference data only.',
        claimKind: 'schema-derived-fact',
        confidence: 'verified',
        sources: [
          {
            kind: 'schema',
            title: 'SC2 data schema',
            schema: currentField.schema,
            reviewedAt: '2026-09-20',
          },
        ],
      },
      {
        id: 'blizzard.sc2/life-max-duplicate',
        target: currentField,
        locale: 'en',
        title: 'Maximum life duplicate',
        summary: 'A duplicate target/locale remains visible to the audit.',
        claimKind: 'schema-derived-fact',
        confidence: 'verified',
        sources: [
          {
            kind: 'schema',
            title: 'SC2 data schema',
            schema: currentField.schema,
            reviewedAt: '2026-09-20',
          },
        ],
      },
      {
        id: 'blizzard.sc2/life-max',
        target: currentField,
        locale: 'ru',
        title: 'Максимальное здоровье',
        summary: 'Определяет исходный максимум здоровья объекта.',
        claimKind: 'documented-interpretation',
        confidence: 'high',
        examples: [{ title: 'Unit', text: 'Marine has a local LifeMax override.' }],
        sources: [source],
      },
      {
        id: 'blizzard.sc2/life-max-stale',
        target: staleField,
        locale: 'en',
        title: 'Old maximum life',
        summary: 'Documentation pinned to an obsolete schema revision.',
        claimKind: 'documented-interpretation',
        confidence: 'high',
        sources: [source],
      },
      {
        id: 'blizzard.sc2/retired-concept',
        target: orphan,
        locale: 'en',
        title: 'Retired concept',
        summary: 'No longer present in the authority census.',
        claimKind: 'community-note',
        confidence: 'medium',
        sources: [source],
      },
    ]

    const report = evaluateKnowledgeCoverage([currentField, concept, concept], entries, {
      requiredLocales: ['RU', 'en', 'ru'],
    })
    expect(report.structuralCoverage).toEqual({ covered: 1, total: 2, percent: 50 })
    expect(report.descriptiveCoverage).toEqual({ covered: 1, total: 2, percent: 50 })
    expect(report.researchedSemanticCoverage).toEqual({ covered: 1, total: 2, percent: 50 })
    expect(report.provenanceCoverage).toEqual({ covered: 1, total: 2, percent: 50 })
    expect(report.exampleCoverage).toEqual({ covered: 1, total: 2, percent: 50 })
    expect(report.localeCoverage).toEqual([
      { locale: 'en', coverage: { covered: 1, total: 2, percent: 50 } },
      { locale: 'ru', coverage: { covered: 1, total: 2, percent: 50 } },
    ])
    expect(report.missingTargetKeys).toEqual([knowledgeTargetKey(concept)])
    expect(new Set(report.orphanTargetKeys)).toEqual(
      new Set([knowledgeTargetKey(orphan), knowledgeTargetKey(staleField)]),
    )
    expect(report.duplicateAuthorityTargetKeys).toEqual([knowledgeTargetKey(concept)])
    expect(report.duplicateEntryLocales).toEqual([
      {
        targetKey: knowledgeTargetKey(currentField),
        locale: 'en',
        entryIds: ['blizzard.sc2/life-max', 'blizzard.sc2/life-max-duplicate'],
      },
    ])
    expect(report.staleFieldTargets).toEqual([
      {
        authorityTargetKey: knowledgeTargetKey(currentField),
        knowledgeTargetKey: knowledgeTargetKey(staleField),
      },
    ])
    expect(
      evaluateKnowledgeCoverage([concept, currentField, concept], [...entries].reverse(), {
        requiredLocales: ['en', 'ru'],
      }),
    ).toEqual(report)
  })

  it('reports an absent authority denominator as unknown', () => {
    expect(evaluateKnowledgeCoverage([], []).structuralCoverage).toEqual({
      covered: 0,
      total: 0,
      percent: null,
    })
    expect(() => evaluateKnowledgeCoverage([], [], { requiredLocales: ['-'] })).toThrow(
      /valid locale tags/u,
    )
  })
})

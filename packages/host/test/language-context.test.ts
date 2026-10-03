import { describe, expect, it } from 'vitest'
import type { LanguageWorkspaceDocumentSource } from '../src/language/workspace.js'
import { composeLanguageDocumentSources } from '../src/content-dependency-operations.js'
import {
  LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_BYTES,
  LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_DEPTH,
  languageWorkspaceContextToken,
  validatedLanguageWorkspaceSemanticInputs,
} from '../src/language/context.js'
import { validatedLanguageSemanticContextRequirements } from '../src/language/semantic-context.js'

describe('language workspace semantic payloads', () => {
  it('validates and copies resolved Data context declarations', () => {
    const original = {
      kind: 'resolved-data-snapshot',
      gameId: 'fixture-game',
      languageIds: ['fixture-data'],
    }
    const [requirement] = validatedLanguageSemanticContextRequirements([original])
    expect(requirement).toEqual(original)
    expect(requirement).not.toBe(original)
    if (requirement?.kind !== 'resolved-data-snapshot') throw new Error('expected resolved data requirement')
    expect(Object.isFrozen(requirement?.languageIds)).toBe(true)
    expect(() => validatedLanguageSemanticContextRequirements([original, { ...original }])).toThrow(
      TypeError,
    )
    expect(() =>
      validatedLanguageSemanticContextRequirements([{ ...original, languageIds: Array(1) }]),
    ).toThrow(TypeError)
  })

  it('validates, deeply copies and freezes strict JSON payloads', () => {
    const original = { catalog: { units: ['Marine'] } }
    const [input] = validatedLanguageWorkspaceSemanticInputs([
      { kind: 'catalog', id: 'sc2/effective', revision: '1', payload: original },
    ])

    expect(input?.payload).toEqual(original)
    expect(input?.payload).not.toBe(original)
    expect(Object.isFrozen(input)).toBe(true)
    expect(Object.isFrozen(input?.payload)).toBe(true)
    expect(Object.isFrozen((input?.payload as { catalog: object }).catalog)).toBe(true)

    original.catalog.units[0] = 'Marauder'
    expect(input?.payload).toEqual({ catalog: { units: ['Marine'] } })
  })

  it('reuses only validated immutable input identities and still notices caller mutations', () => {
    const caller = Object.freeze({ kind: 'catalog', id: 'effective', revision: '1', payload: { life: 45 } })
    const [validated] = validatedLanguageWorkspaceSemanticInputs([caller])
    const originalToken = languageWorkspaceContextToken(caller)
    expect(languageWorkspaceContextToken(validated)).toBe(originalToken)
    expect(languageWorkspaceContextToken(validated)).toBe(originalToken)
    caller.payload.life = 100
    expect(languageWorkspaceContextToken(caller)).not.toBe(originalToken)
    expect(languageWorkspaceContextToken(validated)).toBe(originalToken)
    const [changed] = validatedLanguageWorkspaceSemanticInputs([caller])
    expect(languageWorkspaceContextToken(changed)).toBe(languageWorkspaceContextToken(caller))
  })

  it('rejects non-JSON, over-depth and conflicting payloads', () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: () => 'nope' })
    const sparse = Array(1)
    let overDepth: unknown = null
    for (let depth = 0; depth <= LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_DEPTH; depth += 1) {
      overDepth = { next: overDepth }
    }
    const input = (payload: unknown) => [
      { kind: 'catalog', id: 'sc2/effective', revision: '1', payload },
    ]

    for (const payload of [
      undefined,
      Number.NaN,
      1n,
      new Date(),
      cyclic,
      accessor,
      sparse,
      overDepth,
    ]) {
      expect(() => validatedLanguageWorkspaceSemanticInputs(input(payload))).toThrow(TypeError)
    }
    expect(() =>
      validatedLanguageWorkspaceSemanticInputs([
        ...input({ units: ['Marine'] }),
        ...input({ units: ['Marauder'] }),
      ]),
    ).toThrow(/conflicts/u)
  })

  it('rejects aggregate payload bytes above the host bound', () => {
    expect(() =>
      validatedLanguageWorkspaceSemanticInputs([
        {
          kind: 'catalog',
          id: 'sc2/effective',
          revision: '1',
          payload: 'x'.repeat(LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_BYTES),
        },
      ]),
    ).toThrow(/maximum bytes/u)
  }, 15_000)

  it('defensively copies payloads while composing document sources', async () => {
    const payload = { assets: ['Assets/Marine.m3'] }
    const source: LanguageWorkspaceDocumentSource = {
      snapshot: async () => ({
        documents: [],
        isComplete: true,
        workspaceContext: {
          id: 'sc2',
          revision: '1',
          semanticComplete: true,
          documentOrigins: [],
          semanticInputs: [{ kind: 'assets', id: 'sc2/paths', revision: '1', payload }],
        },
      }),
    }
    const composed = composeLanguageDocumentSources([source], () => undefined)!
    const document = {
      uri: 'file:///workspace/test.xml',
      languageId: 'sc2-data',
      version: 1,
      text: '',
    }
    const result = await composed.snapshot({
      document,
      workspaceDocuments: [document],
      workspaceDocumentOrigins: [],
      workspaceLanguageIds: ['sc2-data'],
      maxDocuments: 1,
      signal: new AbortController().signal,
    })

    const copied = result.workspaceContext?.semanticInputs?.[0]?.payload
    expect(copied).toEqual(payload)
    expect(copied).not.toBe(payload)
    payload.assets[0] = 'Assets/Mutated.m3'
    expect(copied).toEqual({ assets: ['Assets/Marine.m3'] })
  })
})

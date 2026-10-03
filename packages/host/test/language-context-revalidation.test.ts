import { describe, expect, it } from 'vitest'
import {
  LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_BYTES,
  validatedLanguageWorkspaceSemanticInputs,
} from '../src/language/context.js'

describe('host-owned semantic input revalidation', () => {
  it('reuses only the validated immutable copy while observing changes to caller inputs', () => {
    const original = { kind: 'catalog', id: 'Unit', revision: '1', payload: { units: ['Marine'] } }
    const first = validatedLanguageWorkspaceSemanticInputs([original])
    original.payload.units[0] = 'Marauder'
    const reused = validatedLanguageWorkspaceSemanticInputs(first)
    expect(reused[0]).toBe(first[0])
    expect(reused[0]?.payload).toEqual({ units: ['Marine'] })
    expect(Object.isFrozen(reused[0]?.payload)).toBe(true)
    const changed = validatedLanguageWorkspaceSemanticInputs([original])
    expect(changed[0]?.payload).toEqual({ units: ['Marauder'] })
    expect(changed[0]).not.toBe(first[0])
  })

  it('does not trust shallow-frozen or forged input objects', () => {
    const payload = { units: ['Marine'] }
    const external = Object.freeze({ kind: 'catalog', id: 'Unit', revision: '1', payload })
    const first = validatedLanguageWorkspaceSemanticInputs([external])
    payload.units[0] = 'Marauder'
    expect(first[0]?.payload).toEqual({ units: ['Marine'] })
    expect(validatedLanguageWorkspaceSemanticInputs([external])[0]?.payload).toEqual({
      units: ['Marauder'],
    })
    const accessor = Object.freeze({
      kind: 'catalog',
      id: 'Unit',
      revision: '1',
      get payload() {
        throw new Error('must not invoke')
      },
    })
    expect(() => validatedLanguageWorkspaceSemanticInputs([accessor])).toThrow(TypeError)
  })

  it('checks conflicts between trusted and new inputs even at the same revision', () => {
    const trusted = validatedLanguageWorkspaceSemanticInputs([
      { kind: 'catalog', id: 'Unit', revision: '1', payload: { units: ['Marine'] } },
    ])
    for (const change of [
      { revision: '2', payload: { units: ['Marine'] } },
      { revision: '1', payload: { units: ['Marauder'] } },
    ]) {
      expect(() =>
        validatedLanguageWorkspaceSemanticInputs([
          ...trusted,
          { kind: 'catalog', id: 'Unit', ...change },
        ]),
      ).toThrow(/conflicts/u)
    }
    expect(validatedLanguageWorkspaceSemanticInputs([...trusted, ...trusted])).toEqual(trusted)
  })

  it('enforces the aggregate byte budget when combining individually validated inputs', () => {
    const trusted = validatedLanguageWorkspaceSemanticInputs([
      {
        kind: 'catalog',
        id: 'large',
        revision: '1',
        payload: 'x'.repeat(LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_BYTES / 2),
      },
    ])
    expect(() => validatedLanguageWorkspaceSemanticInputs([...trusted, ...trusted])).toThrow(
      /maximum bytes/u,
    )
  }, 15_000)
})

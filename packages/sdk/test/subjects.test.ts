import { describe, expect, it } from 'vitest'
import {
  addInterpretation,
  assetSourceRefFromSourceRef,
  createRootSubjectState,
  nestedSubject,
  parseRevisionRef,
  parseSubjectRef,
  removeInterpretation,
  rootSubject,
  serializeRevisionRef,
  selectInterpretation,
  serializeSubjectRef,
  subjectRefEquals,
  sourceRefFromAssetSourceRef,
} from '@modkit/sdk/subjects'

function extendedSubject(payload: unknown): string {
  return `x3-subject:${encodeURIComponent(JSON.stringify(payload))}`
}

describe('SubjectRef (MK3/25 §3)', () => {
  it('serializes the spec examples', () => {
    const dds = rootSubject({ id: 'file:///c:/mods/x.dds' })
    expect(serializeSubjectRef(dds)).toBe('file:///c:/mods/x.dds')

    const marine = nestedSubject(
      rootSubject({ id: 'modkit-vfs://ws/' }),
      'publisher-alpha.alpha/unit',
      'Marine',
    )
    expect(serializeSubjectRef(marine)).toBe('modkit-vfs://ws/#publisher-alpha.alpha%2Funit/Marine')

    const roundTrip = parseSubjectRef(serializeSubjectRef(marine))
    expect(subjectRefEquals(roundTrip, marine)).toBe(true)
  })

  it('equality ignores revision and compares workspace + source chain + identity', () => {
    const a = nestedSubject(rootSubject({ id: 's', parent: { id: 'p' } }, 'ws'), 'k.n/d', 'x')
    const same = nestedSubject(rootSubject({ id: 's', parent: { id: 'p' } }, 'ws'), 'k.n/d', 'x')
    const otherParent = nestedSubject(
      rootSubject({ id: 's', parent: { id: 'q' } }, 'ws'),
      'k.n/d',
      'x',
    )
    expect(subjectRefEquals(a, same)).toBe(true)
    expect(subjectRefEquals(a, otherParent)).toBe(false)
    expect(serializeSubjectRef(a)).not.toBe(serializeSubjectRef(otherParent))
    expect(subjectRefEquals(parseSubjectRef(serializeSubjectRef(a)), a)).toBe(true)

    const restorable = assetSourceRefFromSourceRef(a.source, 'artifact://nested/source')
    expect(restorable.parentIds).toEqual(['p'])
    expect(sourceRefFromAssetSourceRef(restorable)).toEqual(a.source)
  })

  it('uses the versioned tuple for reserved source ids and avoids compact collisions', () => {
    const rootWithFragment = rootSubject({ id: 'asset#org.example/item/key' })
    const compactNested = nestedSubject(rootSubject({ id: 'asset' }), 'org.example/item', 'key')
    const reservedPrefix = rootSubject({ id: 'x3-subject:literal%5Bsource%5D' })

    const rootWire = serializeSubjectRef(rootWithFragment)
    const nestedWire = serializeSubjectRef(compactNested)
    const prefixWire = serializeSubjectRef(reservedPrefix)

    expect(rootWire).toMatch(/^x3-subject:/)
    expect(prefixWire).toMatch(/^x3-subject:/)
    expect(rootWire).not.toBe(nestedWire)
    expect(subjectRefEquals(parseSubjectRef(rootWire), rootWithFragment)).toBe(true)
    expect(subjectRefEquals(parseSubjectRef(nestedWire), compactNested)).toBe(true)
    expect(subjectRefEquals(parseSubjectRef(prefixWire), reservedPrefix)).toBe(true)
  })

  it('round-trips percent signs and reserved characters without changing identity', () => {
    const root = rootSubject({ id: 'file:///100%/literal%23name' })
    const nested = nestedSubject(root, 'org.example/entry', '100%/ready#now?yes')

    expect(subjectRefEquals(parseSubjectRef(serializeSubjectRef(root)), root)).toBe(true)
    expect(subjectRefEquals(parseSubjectRef(serializeSubjectRef(nested)), nested)).toBe(true)
  })

  it('rejects empty source ids and invalid nested identities at every ingress', () => {
    expect(() => rootSubject({ id: '' })).toThrow('subject source id must be non-empty')
    expect(() => rootSubject({ id: 'leaf', parent: { id: '' } })).toThrow(
      'subject source id must be non-empty',
    )

    const root = rootSubject({ id: 'source' })
    expect(() => nestedSubject(root, 'not-qualified', 'key')).toThrow(
      'nested subject kind must be a qualified id',
    )
    expect(() => nestedSubject(root, 'org.example/item', '')).toThrow(
      'nested subject key must be non-empty',
    )
    expect(() =>
      serializeSubjectRef({ source: { id: '' }, identity: { kind: '', key: '' } }),
    ).toThrow('subject source id must be non-empty')
    expect(() =>
      serializeSubjectRef({
        source: { id: 'source' },
        identity: { kind: 'not-qualified', key: 'key' },
      }),
    ).toThrow('nested subject kind must be a qualified id')

    expect(() => parseSubjectRef('')).toThrow('subject source id must be non-empty')
    expect(() => parseSubjectRef('#org.example%2Fitem/key')).toThrow(
      'subject source id must be non-empty',
    )
    expect(() => parseSubjectRef('source#org.example%2Fitem')).toThrow(
      'nested subject reference must include a non-empty key',
    )
    expect(() => parseSubjectRef('source#not-qualified/key')).toThrow(
      'nested subject kind must be a qualified id',
    )
    expect(() => parseSubjectRef('source#org.example%2Fitem/')).toThrow(
      'nested subject key must be non-empty',
    )
    expect(() => parseSubjectRef('source#org.example%2Fitem/%')).toThrow(
      'invalid nested subject reference',
    )

    expect(() => parseSubjectRef(extendedSubject([1, null, [], '', '']))).toThrow(
      'subject source chain must be non-empty',
    )
    expect(() => parseSubjectRef(extendedSubject([1, null, [''], '', '']))).toThrow(
      'subject source id must be non-empty',
    )
    expect(() => parseSubjectRef(extendedSubject([1, null, ['source'], '', 'key']))).toThrow(
      'nested subject kind must be a qualified id',
    )
    expect(() =>
      parseSubjectRef(extendedSubject([1, null, ['source'], 'org.example/item', ''])),
    ).toThrow('nested subject key must be non-empty')
  })

  it('round-trips a kind-tagged revision without collapsing revision domains', () => {
    const content = { kind: 'content-hash', value: 'abc:123', algorithm: 'sha256' } as const
    const etag = { kind: 'etag', value: 'abc:123' } as const
    const contentId = serializeRevisionRef(content)
    const etagId = serializeRevisionRef(etag)
    expect(contentId).not.toBe(etagId)
    expect(parseRevisionRef(contentId)).toEqual(content)
    expect(parseRevisionRef(etagId)).toEqual(etag)
  })
})

describe('unknown root subject + interpretations (MK3/25 §20, PR-16)', () => {
  it('identity survives interpretation install/remove/reclassification', () => {
    const root = rootSubject({ id: 'file:///c:/mods/opaque.bin' })
    const serialized = serializeSubjectRef(root)

    let state = createRootSubjectState(root)
    expect(state.interpretations).toEqual([])

    state = addInterpretation(state, { id: 'org.example/relic-hod' })
    state = addInterpretation(state, { id: 'org.example/generic-archive' })
    expect(serializeSubjectRef(state.ref)).toBe(serialized) // identity untouched
    expect(state.interpretations.map(i => i.id)).toEqual([
      'org.example/generic-archive',
      'org.example/relic-hod',
    ])

    state = selectInterpretation(state, 'org.example/relic-hod')
    expect(state.selected).toBe('org.example/relic-hod')
    expect(serializeSubjectRef(state.ref)).toBe(serialized) // reclassification ≠ identity

    state = removeInterpretation(state, 'org.example/relic-hod')
    expect(state.selected).toBeUndefined() // degraded back to unknown, no re-guess
    expect(serializeSubjectRef(state.ref)).toBe(serialized)
    expect(subjectRefEquals(state.ref, root)).toBe(true)

    expect(() => selectInterpretation(state, 'org.example/relic-hod')).toThrow()
  })
})

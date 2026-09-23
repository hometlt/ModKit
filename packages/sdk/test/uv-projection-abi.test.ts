/**
 * The frozen UV Projection ABI and the optional model facet declarations (block 11, slice 11C0).
 *
 * Most of this ABI is types, and types are checked by the compiler rather than here. What this
 * suite covers is the part that is not: the two rules that would otherwise be prose — a digest
 * names its algorithm, and a portable receipt cannot carry an ambient path — plus the declarations
 * a later slice will be tempted to quietly widen.
 */

import { describe, expect, it } from 'vitest'
import {
  algorithmQualifiedDigest,
  DATA_SOURCE_MATURITY,
  dataSourceMaturity,
  isAlgorithmQualifiedDigest,
  isReservedModelFacetSource,
  RESERVED_MODEL_FACET_SOURCES,
  revisionId,
  STANDARD_DATA_SOURCE_CONTRACTS,
  STANDARD_DATA_SOURCE_SURFACES,
  toPortableProjectionReceipt,
  type ProjectionReceipt,
} from '../src/index.js'

const MODEL_FACETS = [
  'common.view/model-resource-refs-source',
  'common.view/model-skeleton-source',
  'common.view/model-animation-source',
  'common.view/model-collision-source',
  'common.view/model-material-source',
] as const

describe('UV digests are algorithm-qualified', () => {
  it('accepts a qualified digest and refuses a bare hex string', () => {
    const digest = algorithmQualifiedDigest(`sha256:${'a'.repeat(64)}`)
    expect(isAlgorithmQualifiedDigest(digest)).toBe(true)
    // the whole point: a bare hex string is never *assumed* to be sha-256
    expect(isAlgorithmQualifiedDigest('a'.repeat(64))).toBe(false)
    expect(() => algorithmQualifiedDigest('a'.repeat(64))).toThrow(/algorithm-qualified/u)
    expect(() => algorithmQualifiedDigest('sha256:NOTHEX')).toThrow(/algorithm-qualified/u)
    expect(() => algorithmQualifiedDigest('sha256:AAAA')).toThrow(/algorithm-qualified/u)
  })

  it('leaves room for an algorithm this build does not know', () => {
    // forward compatibility is the reason for the prefix; the guard checks form, not membership
    expect(isAlgorithmQualifiedDigest(`blake3:${'f'.repeat(64)}`)).toBe(true)
  })
})

describe('a portable projection receipt cannot carry an ambient path', () => {
  const local: ProjectionReceipt = {
    form: 'local',
    adapter: { id: 'modkit/m3-projector', version: '1.0.0' },
    subjectRevision: revisionId('provider-token:test-subject'),
    sourceUri: 'file:///C:/Apps/ExampleGame%20II/artifact1.m3',
    companions: [],
    basis: { handedness: 'right', upAxis: 'y', forwardAxis: '-z', unit: 'meter' },
    planes: [{ planeId: 'geometry', state: 'normalized' }],
    evidence: [{ kind: 'observed', statement: 'decoded 3 primitives', bytesRead: 4096n }],
    confidence: 'high',
  }

  it('drops the ambient URI and substitutes the identity the caller chose', () => {
    const portable = toPortableProjectionReceipt(local, { kind: 'opaque', token: 'subject-7f3a' })
    expect(portable.form).toBe('portable')
    expect(portable.sourceIdentity).toEqual({ kind: 'opaque', token: 'subject-7f3a' })
    // the machine that produced the artifact does not travel with it
    expect('sourceUri' in portable).toBe(false)
    expect(
      JSON.stringify(portable, (_key, value) =>
        typeof value === 'bigint' ? String(value) : value,
      ),
    ).not.toContain('ExampleGame')
    // everything that is not machine-local survives untouched
    expect(portable.planes).toEqual(local.planes)
    expect(portable.evidence).toEqual(local.evidence)
    expect(portable.confidence).toBe('high')
  })

  it('supports withholding identity outright, with the reason named', () => {
    const portable = toPortableProjectionReceipt(local, {
      kind: 'redacted',
      reason: 'licensed corpus',
    })
    expect(portable.sourceIdentity).toEqual({ kind: 'redacted', reason: 'licensed corpus' })
  })

  it('leaves the local receipt alone', () => {
    toPortableProjectionReceipt(local, { kind: 'opaque', token: 'x' })
    expect(local.sourceUri).toBe('file:///C:/Apps/ExampleGame%20II/artifact1.m3')
  })
})

describe('optional model facet sources', () => {
  it('registers the five publisher-backed facets and leaves the base contract admitted', () => {
    for (const contract of MODEL_FACETS) {
      expect(STANDARD_DATA_SOURCE_CONTRACTS).toContain(contract)
      expect(STANDARD_DATA_SOURCE_SURFACES[contract]).toBeDefined()
    }
    /*
     * Slice 12-1 admitted four facets after independent publishers exercised their shapes.
     * Skeleton followed only after M3 supplied a second vendor family. Maturity stays asserted per
     * contract so every future promotion remains an explicit reviewed decision.
     */
    expect(dataSourceMaturity('common.view/model-resource-refs-source')).toBe('admitted')
    expect(dataSourceMaturity('common.view/model-animation-source')).toBe('admitted')
    expect(dataSourceMaturity('common.view/model-collision-source')).toBe('admitted')
    expect(dataSourceMaturity('common.view/model-material-source')).toBe('admitted')
    expect(dataSourceMaturity('common.view/model-skeleton-source')).toBe('admitted')
    expect(dataSourceMaturity('common.view/model-socket-source')).toBe('publisher-candidate')
    expect(DATA_SOURCE_MATURITY['common.view/model-scene-source']).toBe('admitted')
  })

  it('keeps every facet an info-plus-one-reader surface', () => {
    for (const contract of MODEL_FACETS) {
      const methods = Object.keys(STANDARD_DATA_SOURCE_SURFACES[contract].methods)
      expect(methods, contract).toHaveLength(2)
      expect(methods, contract).toContain('info')
    }
  })

  it('reserves the unpublished facets without pretending they are contracts', () => {
    // `model-effect-source` left this list once M3 and MDX published per-emitter records: a
    // reservation exists to be closed, and the two that remain still have no publisher.
    expect(RESERVED_MODEL_FACET_SOURCES.map(entry => entry.contract)).toEqual([
      'common.view/model-lod-source',
      'common.view/model-variant-source',
    ])
    for (const entry of RESERVED_MODEL_FACET_SOURCES) {
      // a reserved id is not callable: it is deliberately absent from the standard registry, so a
      // manifest naming one is treated as foreign rather than as a contract this build implements
      expect(STANDARD_DATA_SOURCE_CONTRACTS, entry.contract).not.toContain(entry.contract)
      expect(dataSourceMaturity(entry.contract)).toBeUndefined()
      expect(isReservedModelFacetSource(entry.contract)).toBe(true)
      // and a reservation states what blocks it, so it can be closed rather than merely remembered
      expect(entry.blockedBy.length).toBeGreaterThan(20)
      expect(entry.minimalShape.length).toBeGreaterThan(0)
    }
    expect(isReservedModelFacetSource('common.view/model-scene-source')).toBe(false)
  })
})

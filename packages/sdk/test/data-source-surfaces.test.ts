import { describe, expect, it } from 'vitest'
import { contractId } from '@modkitx-x3/core'
import {
  A1_SPEC_SCHEMA_ENTRIES,
  ADMITTED_DATA_SOURCE_CONTRACTS,
  AUXILIARY_DATA_SOURCE_SURFACES,
  DATA_SOURCE_MATURITY,
  CONTRACT_DEFINITION_CONTRIBUTION_CONTRACT,
  ENCODED_MEDIA_SURFACE_ID,
  STANDARD_DATA_SOURCE_CONTRACTS,
  STANDARD_DATA_SOURCE_SURFACES,
  createSpecSchemaRegistry,
  dataSourceContractDefinitionSpecV1Schema,
  dataSourceMaturity,
  dataSourceMethodSurfaceV1Schema,
  dataSourceSurfaceV1Schema,
  standardDataSourceSurfaceFor,
  validateContributionManifest,
  validateWithSchema,
  type ContributionManifestV1Wire,
  type DataSourceContractDefinitionSpecV1Wire,
  type DataSourceSurfaceV1Wire,
} from '@modkitx-x3/sdk'
import { METHOD_NAME_PATTERN } from '../src/schemas/patterns.js'

const METHOD_NAME = new RegExp(METHOD_NAME_PATTERN, 'u')

const definitionWith = (
  surface: DataSourceSurfaceV1Wire | undefined,
): DataSourceContractDefinitionSpecV1Wire => ({
  schemaVersion: 1,
  kind: 'data-source',
  contract: 'org.example/thing-source',
  major: 1,
  schema: { $ref: './schemas/thing-source.v1.schema.json' },
  conformanceProfile: 'org.example/thing-source-v1',
  ...(surface === undefined ? {} : { surface }),
})

const manifestWith = (
  surface: DataSourceSurfaceV1Wire | undefined,
): ContributionManifestV1Wire<DataSourceContractDefinitionSpecV1Wire> => ({
  schemaVersion: 1,
  contract: { id: CONTRACT_DEFINITION_CONTRIBUTION_CONTRACT, major: 1 },
  id: 'org.example/thing-source-definition',
  displayName: 'Thing source definition',
  spec: definitionWith(surface),
})

describe('NXT-103 — data-source method surface schema', () => {
  it('accepts every kind, keeps result/wrapper exclusive to lease, and bounds names', async () => {
    const valid: DataSourceSurfaceV1Wire = {
      releaseVia: 'dispose',
      methods: {
        info: { kind: 'value' },
        slice: { kind: 'value', signal: 'last', limits: { maxBytes: 1024 } },
        search: { kind: 'iterable', signal: 'last' },
        events: { kind: 'events', signal: 'last' },
        openEntry: { kind: 'leased-value', signal: 'last' },
        encoded: {
          kind: 'lease',
          result: { contract: 'common.view/encoded-media', major: 1 },
          wrapper: 'bare',
          arity: 1,
          signal: 'last',
        },
        readRegion: { kind: 'value', optional: true, signal: 'last' },
        dispose: { kind: 'value' },
      },
    }
    expect(await validateWithSchema(dataSourceSurfaceV1Schema, valid)).toEqual([])
    expect(
      await validateWithSchema(dataSourceContractDefinitionSpecV1Schema, definitionWith(valid)),
    ).toEqual([])
    expect(
      await validateWithSchema(dataSourceContractDefinitionSpecV1Schema, definitionWith(undefined)),
    ).toEqual([])
  })

  it('accepts signal/progress placements inside an object argument, fields, and a surface on the service arm', async () => {
    const surface: DataSourceSurfaceV1Wire = {
      fields: ['contract'],
      methods: {
        parse: { kind: 'value', signal: { arg: 0, key: 'signal' } },
        invoke: {
          kind: 'value',
          signal: { arg: 2, key: 'signal' },
          progress: { arg: 2, key: 'onProgress' },
        },
        dataSource: {
          kind: 'lease',
          wrapper: 'lease',
          result: { contract: 'common.view/tree-data-source', major: 1 },
          signal: { arg: 0, key: 'signal' },
        },
      },
    }
    expect(await validateWithSchema(dataSourceSurfaceV1Schema, surface)).toEqual([])
    const service = {
      schemaVersion: 1,
      kind: 'service',
      contract: 'org.example/thing-syntax',
      major: 1,
      offerFacet: { presence: 'forbidden' },
      requestFacet: { presence: 'forbidden' },
      matching: { profile: 'org.modkitx/facetless-matcher', major: 1 },
      conformanceProfile: 'org.example/thing-syntax-v1',
      surface,
    }
    const registry = createSpecSchemaRegistry(A1_SPEC_SCHEMA_ENTRIES)
    const result = await validateContributionManifest(
      {
        schemaVersion: 1,
        contract: { id: CONTRACT_DEFINITION_CONTRIBUTION_CONTRACT, major: 1 },
        id: 'org.example/thing-syntax-definition',
        displayName: 'Thing syntax definition',
        spec: service,
      } as unknown as ContributionManifestV1Wire,
      registry,
    )
    expect(result.specState).toBe('validated')
    // a field that is also a method is refused by the semantic rule
    const clash = await validateContributionManifest(
      manifestWith({ fields: ['info'], methods: { info: { kind: 'value' } } }),
      registry,
    )
    expect(clash.specState).toBe('invalid')
    expect(clash.diagnostics.map(d => d.code)).toContain('x3.sdk/surface-field-is-method')
  })

  it.each([
    ['lease without result', { kind: 'lease' }],
    ['bad signal placement key', { kind: 'value', signal: { arg: 0, key: 'Bad-Key' } }],
    ['bad progress placement', { kind: 'value', progress: { arg: -1, key: 'onProgress' } }],
    ['value with result', { kind: 'value', result: { contract: 'a/b', major: 1 } }],
    ['value with wrapper', { kind: 'value', wrapper: 'bare' }],
    ['unknown kind', { kind: 'stream' }],
    ['unknown key', { kind: 'value', batch: 10 }],
    ['bad signal', { kind: 'value', signal: 'first' }],
    ['negative arity', { kind: 'value', arity: -1 }],
    ['result without major', { kind: 'lease', result: { contract: 'a/b' } }],
    [
      'result with a non-qualified contract',
      { kind: 'lease', result: { contract: 'nope', major: 1 } },
    ],
    ['maxPageItems zero', { kind: 'value', limits: { maxPageItems: 0 } }],
  ])('rejects a method surface: %s', async (_label, method) => {
    const diagnostics = await validateWithSchema(dataSourceMethodSurfaceV1Schema, method)
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it.each([
    ['empty methods', { methods: {} }],
    ['bad method name (PascalCase)', { methods: { Info: { kind: 'value' } } }],
    ['bad method name (dash)', { methods: { 'read-all': { kind: 'value' } } }],
    ['bad releaseVia name', { methods: { info: { kind: 'value' } }, releaseVia: 'Dispose' }],
    ['unknown surface key', { methods: { info: { kind: 'value' } }, batch: true }],
  ])('rejects a surface: %s', async (_label, surface) => {
    const diagnostics = await validateWithSchema(dataSourceSurfaceV1Schema, surface)
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it('applies the semantic rules the schema cannot: releaseVia must name a declared value method', async () => {
    const registry = createSpecSchemaRegistry(A1_SPEC_SCHEMA_ENTRIES)
    const ok = await validateContributionManifest(
      manifestWith({
        methods: { info: { kind: 'value' }, dispose: { kind: 'value' } },
        releaseVia: 'dispose',
      }),
      registry,
    )
    expect(ok.specState).toBe('validated')

    const unknown = await validateContributionManifest(
      manifestWith({ methods: { info: { kind: 'value' } }, releaseVia: 'dispose' }),
      registry,
    )
    expect(unknown.specState).toBe('invalid')
    expect(unknown.diagnostics.map(d => d.code)).toContain('x3.sdk/surface-release-via-unknown')

    const wrongKind = await validateContributionManifest(
      manifestWith({
        methods: { info: { kind: 'value' }, close: { kind: 'iterable' } },
        releaseVia: 'close',
      }),
      registry,
    )
    expect(wrongKind.specState).toBe('invalid')
    expect(wrongKind.diagnostics.map(d => d.code)).toContain('x3.sdk/surface-release-via-kind')
  })
})

describe('NXT-103 — standard data-source surfaces', () => {
  it('covers exactly the 19 standard contracts plus the auxiliary encoded-media surface', () => {
    expect(Object.keys(STANDARD_DATA_SOURCE_SURFACES).sort()).toEqual(
      [...STANDARD_DATA_SOURCE_CONTRACTS].sort(),
    )
    expect(Object.keys(AUXILIARY_DATA_SOURCE_SURFACES)).toEqual([ENCODED_MEDIA_SURFACE_ID])
    expect(Object.isFrozen(STANDARD_DATA_SOURCE_SURFACES)).toBe(true)
    expect(
      Object.isFrozen(STANDARD_DATA_SOURCE_SURFACES['common.view/text-data-source'].methods),
    ).toBe(true)
  })

  it('every standard surface validates against the schema and its lease results resolve', async () => {
    const known = new Set<string>([...STANDARD_DATA_SOURCE_CONTRACTS, ENCODED_MEDIA_SURFACE_ID])
    for (const [contract, surface] of [
      ...Object.entries(STANDARD_DATA_SOURCE_SURFACES),
      ...Object.entries(AUXILIARY_DATA_SOURCE_SURFACES),
    ]) {
      expect(await validateWithSchema(dataSourceSurfaceV1Schema, surface), contract).toEqual([])
      for (const [name, method] of Object.entries(surface.methods)) {
        expect(METHOD_NAME.test(name), `${contract}.${name}`).toBe(true)
        if (method.kind === 'lease') {
          expect(
            known.has(method.result.contract),
            `${contract}.${name} leases a known surface`,
          ).toBe(true)
          expect(method.result.major).toBe(1)
        }
      }
    }
  })

  it('reflects the ABI: optional methods, cancellable methods, streams and leased values', () => {
    const raster = STANDARD_DATA_SOURCE_SURFACES['common.view/raster-image-source']
    expect(raster.methods['readRegion']).toMatchObject({
      kind: 'value',
      optional: true,
      signal: 'last',
    })
    expect(raster.methods['encoded']).toMatchObject({
      kind: 'lease',
      wrapper: 'bare',
      result: { contract: contractId(ENCODED_MEDIA_SURFACE_ID), major: 1 },
    })
    const audio = STANDARD_DATA_SOURCE_SURFACES['common.view/audio-media-source']
    expect(audio.methods['encoded']).toMatchObject({ kind: 'lease', arity: 1, signal: 'last' })
    expect(
      STANDARD_DATA_SOURCE_SURFACES['common.view/transport-source'].methods['events'],
    ).toMatchObject({
      kind: 'events',
    })
    expect(
      STANDARD_DATA_SOURCE_SURFACES['common.view/namespace-entry-source'].methods['openEntry'],
    ).toMatchObject({ kind: 'leased-value', signal: 'last' })
    expect(
      STANDARD_DATA_SOURCE_SURFACES['common.view/text-data-source'].methods['search'],
    ).toMatchObject({
      kind: 'iterable',
    })
    expect(STANDARD_DATA_SOURCE_SURFACES['common.view/byte-range-source'].methods['size']).toEqual({
      kind: 'value',
    })
  })

  it('never lets a publisher-candidate contract be counted as admitted', () => {
    // ADR-DOC-001 §3: `slide-deck-source` is published by ODP alone, so the gate that asks "is this
    // shape settled?" must answer no until a second slides family exists. The list is derived from
    // the maturity table rather than written twice, so the only way to admit the contract is to
    // change its maturity — which is the decision the ADR reserves for block 30.
    expect(Object.keys(DATA_SOURCE_MATURITY).sort()).toEqual(
      [...STANDARD_DATA_SOURCE_CONTRACTS].sort(),
    )
    expect(dataSourceMaturity('common.view/slide-deck-source')).toBe('publisher-candidate')
    expect(ADMITTED_DATA_SOURCE_CONTRACTS).not.toContain('common.view/slide-deck-source')
    /*
     * Two candidates after slice 12-1: the ODP-only slides source, and the skeleton facet whose two
     * publishers (W3D, W3X) ship in one extension package. The other four model facets were
     * promoted because two or more independent families exercise different shapes of them — the
     * promotion is recorded here as a list rather than a count so that admitting a fifth one
     * requires editing this expectation on purpose.
     */
    expect(
      STANDARD_DATA_SOURCE_CONTRACTS.filter(
        contract => DATA_SOURCE_MATURITY[contract] === 'publisher-candidate',
      ),
    ).toEqual(['common.view/model-skeleton-source', 'common.view/slide-deck-source'])
    expect(ADMITTED_DATA_SOURCE_CONTRACTS.length).toBe(STANDARD_DATA_SOURCE_CONTRACTS.length - 2)
    // the base model contract is untouched: a facet beside a contract is not a change to it
    expect(dataSourceMaturity('common.view/model-scene-source')).toBe('admitted')
    for (const contract of ADMITTED_DATA_SOURCE_CONTRACTS) {
      expect(DATA_SOURCE_MATURITY[contract], contract).toBe('admitted')
    }
    // a candidate is not a second-class citizen on the wire: it is called like every other source
    expect(standardDataSourceSurfaceFor('common.view/slide-deck-source', 1)).toBe(
      STANDARD_DATA_SOURCE_SURFACES['common.view/slide-deck-source'],
    )
    expect(dataSourceMaturity('org.example/thing-source')).toBeUndefined()
  })

  it('looks surfaces up by wire coordinates and stays silent for foreign contracts', () => {
    expect(standardDataSourceSurfaceFor('common.view/text-data-source', 1)).toBe(
      STANDARD_DATA_SOURCE_SURFACES['common.view/text-data-source'],
    )
    expect(standardDataSourceSurfaceFor(ENCODED_MEDIA_SURFACE_ID, 1)).toBe(
      AUXILIARY_DATA_SOURCE_SURFACES[ENCODED_MEDIA_SURFACE_ID],
    )
    expect(standardDataSourceSurfaceFor('common.view/text-data-source', 2)).toBeUndefined()
    expect(standardDataSourceSurfaceFor('org.example/thing-source', 1)).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import {
  createDataSourceRegistry,
  dataSourceRefFromWire,
  foreignDataSource,
  STANDARD_DATA_SOURCE_CONTRACTS,
  type DataSourceContributionSpecV1,
  type DataSourceInventoryEntry,
  type DataSourceRef,
} from '../src/asset-capabilities/data-sources.js'
import type { UnresolvedSourceDescriptorWire } from '../src/asset-capabilities/types.js'
import { revisionId } from '../src/asset-capabilities/types.js'
import {
  definePresentationPlan,
  presentationSlotId,
} from '../src/asset-capabilities/presentation.js'
import {
  V1_PROJECTION_UNAVAILABLE_CODE,
  type V1DescriptorProjectionResult,
} from '../src/asset-capabilities/v1-projection.js'

const textSpec: DataSourceContributionSpecV1 = {
  schemaVersion: 1,
  kind: 'data-source',
  contract: 'common.view/text-data-source',
  major: 1,
  schema: { $ref: 'https://schemas.modkit.test/text-data-source.v1.json' },
  conformanceProfile: 'common.view/text-data-source-v1',
}

const treeSpec: DataSourceContributionSpecV1 = {
  schemaVersion: 1,
  kind: 'data-source',
  contract: 'example.view/tree-data-source',
  major: 1,
  schema: { $ref: 'https://schemas.example.test/tree-data-source.v1.json' },
  conformanceProfile: 'example.view/tree-data-source-v1',
}

function inventoryEntry(
  ownerExtensionId: string,
  definition: DataSourceContributionSpecV1,
  inventoryRecordId = `${ownerExtensionId}:${definition.contract}@${definition.major}`,
): DataSourceInventoryEntry {
  return {
    definition,
    provenance: {
      ownerExtensionId,
      extensionVersion: '1.0.0',
      inventoryRecordId,
      manifestDigest: 'sha256:manifest',
      artifactDigest: 'sha256:artifact',
      artifactRoot: 'artifact://extension',
      manifestPath: 'contributions/contracts.json',
    },
  }
}

function registryOptions() {
  return {
    isNamespaceOwner: (namespace: string, ownerExtensionId: string) =>
      namespace !== 'common.view' || ownerExtensionId === 'modkit/platform',
    validateDefinition: () => ({ state: 'valid' as const }),
  } as const
}

describe('descriptor-v2 wire facts', () => {
  it('keeps the standard data-source vocabulary immutable at runtime', () => {
    expect(STANDARD_DATA_SOURCE_CONTRACTS).toEqual([
      'common.view/text-data-source',
      'common.view/byte-range-source',
      'common.view/tree-data-source',
      'common.view/table-data-source',
      'common.view/transport-source',
      'common.view/namespace-entry-source',
      'common.view/raster-image-source',
      'common.view/vector-scene-source',
      'common.view/audio-media-source',
      'common.view/video-media-source',
      'common.view/model-scene-source',
      // Block 18: callable common candidate; admission still waits for viewer/conformance closure.
      'common.view/world-scene-source',
      /*
       * Block 11 slice 11C0 declared these optional model facets beside the base scene source,
       * which is itself unchanged. Slice 12-1 migrated the publishers onto them and admitted four
       * of the five; skeleton stays a candidate because W3D and W3X are its only publishers. The
       * wire list is the same either way — maturity is a separate axis from the registry.
       */
      'common.view/model-resource-refs-source',
      'common.view/model-skeleton-source',
      'common.view/model-animation-source',
      'common.view/model-collision-source',
      'common.view/model-material-source',
      // Block 15D: standard wire contract, publisher-candidate until a second native publisher exists.
      'common.view/model-socket-source',
      // Block 15D: emitters and fields, published by StarCraft II's M3 and Warcraft III's MDX.
      'common.view/model-effect-source',
      // Block 15D: lights, cameras, simulation bodies and the behaviours an engine drives itself.
      'common.view/model-light-source',
      'common.view/model-camera-source',
      'common.view/model-physics-source',
      'common.view/model-node-behaviour-source',
      'common.view/model-lod-source',
      'common.view/relation-graph-source',
      // P2: admitted after the field picker and language completion shared one conformance seam.
      'common.view/subject-selector-source',
      'common.view/subject-facts-source',
      // Admitted after two independent publishers plus common consumers.
      'common.view/subject-calculations-source',
      // ADR-DOC-001: standard on the wire, `publisher-candidate` in DATA_SOURCE_MATURITY
      'common.view/slide-deck-source',
    ])
    expect(() =>
      (STANDARD_DATA_SOURCE_CONTRACTS as unknown as string[]).push('evil/unsafe-source'),
    ).toThrow(TypeError)
  })

  it('snapshots a presentation plan before returning the validated readonly view', () => {
    const stage = presentationSlotId('main')
    const slots = [
      {
        slotId: stage,
        kind: 'stage' as const,
        contributionId: 'org.example/viewer',
        extensionId: 'org.example/viewers',
        priority: 1,
        bindings: [],
      },
    ]
    const plan = definePresentationPlan({
      subjectUri: 'memory://subject',
      revision: revisionId('provider-token:r1'),
      slots,
      activeStage: stage,
      alternateStages: [],
      unsatisfied: [],
    })
    const callerOwnedSlot = slots[0]
    if (callerOwnedSlot === undefined) throw new Error('test slot missing')
    callerOwnedSlot.priority = 99
    expect(plan.slots[0]?.priority).toBe(1)
    expect(Object.isFrozen(plan.slots)).toBe(true)
    expect(Object.isFrozen(plan.slots[0])).toBe(true)
  })

  it('round-trips an unresolved, codec-less subject without implementation identities', () => {
    const descriptor: UnresolvedSourceDescriptorWire = {
      schemaVersion: 2,
      subjectUri: 'memory://unknown.bin',
      origin: {
        kind: 'single',
        binding: {
          id: 'primary',
          role: 'content',
          source: { id: 'source-1', uri: 'memory://unknown.bin' },
          required: true,
          ownership: 'owned',
          revision: 'content-hash.sha256:unknown-1',
        },
      },
      traits: [{ id: 'content.binary', descriptorVersion: 1, state: 'available' }],
      operations: [
        {
          id: 'view.hex',
          handlerId: 'host.view.hex',
          state: 'available',
          mutatesSource: false,
        },
      ],
      constraints: {
        readOnly: true,
        seekable: true,
        randomAccess: true,
        trusted: false,
        maxDecodedBytes: '18446744073709551615',
      },
      dataSources: [{ contract: 'common.view/byte-range-source', major: 1 }],
      diagnostics: [],
      revision: 'content-hash.sha256:unknown-1',
      interpretation: 'none',
      candidates: [],
    }

    const encoded = JSON.stringify(descriptor)
    expect(JSON.parse(encoded)).toEqual(descriptor)
    expect(encoded).not.toContain('providerId')
    expect(encoded).not.toContain('viewerId')
    expect(encoded).not.toContain('ticket')
    expect(encoded).not.toContain('digest')
    expect(encoded).not.toContain('bigint')
  })

  it('does not mint nominal data-source refs from invalid raw wire objects', () => {
    expect(() =>
      dataSourceRefFromWire({ contract: 'not-qualified', major: -1, opaque: true }),
    ).toThrow(/invalid data-source reference/)
    expect(() =>
      dataSourceRefFromWire({
        contract: 'common.view/text-data-source',
        major: 99,
        opaque: true,
      }),
    ).toThrow(/standard data-source contract cannot be opaque/)
  })
})

describe('data-source inventory registry', () => {
  it('replaces one owner atomically and preserves the old inventory after a rejected batch', async () => {
    const registry = createDataSourceRegistry(registryOptions())

    expect(
      (
        await registry.replaceOwnerInventory('modkit/platform', [
          inventoryEntry('modkit/platform', textSpec),
        ])
      ).state,
    ).toBe('committed')
    const before = registry.list()

    const rejected = await registry.replaceOwnerInventory('modkit/platform', [
      inventoryEntry('modkit/platform', treeSpec, 'tree-1'),
      inventoryEntry('modkit/platform', treeSpec, 'tree-2'),
    ])
    expect(rejected.state).toBe('rejected')
    if (rejected.state === 'rejected') {
      expect(rejected.results).toHaveLength(2)
      expect(rejected.results.every(result => result.state === 'rejected')).toBe(true)
    }
    expect(registry.list()).toEqual(before)
    expect(registry.lookup(textSpec.contract, textSpec.major)?.ownerExtensionId).toBe(
      'modkit/platform',
    )
    expect(registry.lookup(treeSpec.contract, treeSpec.major)).toBeUndefined()
  })

  it('rejects reserved namespaces and cross-owner major conflicts', async () => {
    const registry = createDataSourceRegistry({
      ...registryOptions(),
    })

    const reserved = await registry.replaceOwnerInventory('example.vendor/extension', [
      inventoryEntry('example.vendor/extension', textSpec),
    ])
    expect(reserved.state).toBe('rejected')
    if (reserved.state === 'rejected') {
      expect(reserved.results[0]).toMatchObject({
        state: 'rejected',
        reason: 'reserved-namespace',
      })
    }

    expect(
      (
        await registry.replaceOwnerInventory('example.vendor/one', [
          inventoryEntry('example.vendor/one', treeSpec),
        ])
      ).state,
    ).toBe('committed')
    const conflict = await registry.replaceOwnerInventory('example.vendor/two', [
      inventoryEntry('example.vendor/two', treeSpec),
    ])
    expect(conflict.state).toBe('rejected')
    if (conflict.state === 'rejected') {
      expect(conflict.results[0]).toMatchObject({ state: 'rejected', reason: 'major-conflict' })
    }
    expect(registry.lookup(treeSpec.contract, 1)?.ownerExtensionId).toBe('example.vendor/one')
  })

  it('resolves both known and explicit opaque wire references through inventory', async () => {
    const registry = createDataSourceRegistry(registryOptions())
    expect(
      (
        await registry.replaceOwnerInventory('modkit/platform', [
          inventoryEntry('modkit/platform', textSpec),
          inventoryEntry('modkit/platform', treeSpec),
        ])
      ).state,
    ).toBe('committed')

    const known: DataSourceRef = { contract: 'common.view/text-data-source', major: 1 }
    const opaque: DataSourceRef = foreignDataSource('example.view/tree-data-source', 1)
    expect(registry.resolveRef(known)?.contract).toBe(textSpec.contract)
    expect(registry.resolveRef(opaque)?.contract).toBe(treeSpec.contract)
    expect(registry.majors(treeSpec.contract)).toEqual([1])
    expect(
      registry.resolveRef({
        contract: 'common.view/text-data-source',
        major: 1,
        opaque: true,
      } as never),
    ).toBeUndefined()
    expect(
      registry.resolveRef({ contract: 'not-qualified', major: -1, opaque: true } as never),
    ).toBeUndefined()
  })

  it('accepts a registered contract major zero without confusing it with standard v1 refs', async () => {
    const registry = createDataSourceRegistry(registryOptions())
    const experimental = { ...treeSpec, major: 0 }
    expect(
      (
        await registry.replaceOwnerInventory('example.vendor/experimental', [
          inventoryEntry('example.vendor/experimental', experimental),
        ])
      ).state,
    ).toBe('committed')
    expect(registry.lookup(experimental.contract, 0)?.major).toBe(0)
  })

  it('fails closed when the referenced schema or conformance profile is absent', async () => {
    const missingSchema = await createDataSourceRegistry({
      isNamespaceOwner: () => true,
      validateDefinition: () => ({ state: 'invalid', reason: 'schema-invalid' }),
    }).replaceOwnerInventory('example.vendor/extension', [
      inventoryEntry('example.vendor/extension', treeSpec),
    ])
    expect(missingSchema).toMatchObject({
      state: 'rejected',
      results: [{ state: 'rejected', reason: 'schema-invalid' }],
    })

    const missingProfile = await createDataSourceRegistry({
      isNamespaceOwner: () => true,
      validateDefinition: () => ({ state: 'invalid', reason: 'conformance-missing' }),
    }).replaceOwnerInventory('example.vendor/extension', [
      inventoryEntry('example.vendor/extension', treeSpec),
    ])
    expect(missingProfile).toMatchObject({
      state: 'rejected',
      results: [{ state: 'rejected', reason: 'conformance-missing' }],
    })
  })

  it('cannot omit namespace ownership policy and rejects a hostile standard registration', async () => {
    const registry = createDataSourceRegistry(registryOptions())
    const result = await registry.replaceOwnerInventory('example.vendor/hostile', [
      inventoryEntry('example.vendor/hostile', textSpec),
    ])
    expect(result).toMatchObject({
      state: 'rejected',
      results: [{ state: 'rejected', reason: 'reserved-namespace' }],
    })
  })

  it('owns a frozen snapshot instead of caller-owned schema-reference objects', async () => {
    const registry = createDataSourceRegistry(registryOptions())
    const mutable = {
      ...treeSpec,
      schema: { $ref: treeSpec.schema.$ref },
    }
    expect(
      (
        await registry.replaceOwnerInventory('example.vendor/one', [
          inventoryEntry('example.vendor/one', mutable),
        ])
      ).state,
    ).toBe('committed')
    mutable.schema.$ref = 'https://attacker.invalid/replaced.json'
    const stored = registry.lookup(treeSpec.contract, treeSpec.major)
    expect(stored?.schema.$ref).toBe(treeSpec.schema.$ref)
    expect(Object.isFrozen(stored)).toBe(true)
    expect(Object.isFrozen(stored?.schema)).toBe(true)
  })

  it('binds schema and conformance evidence to the complete owner/contract/major tuple', async () => {
    const registry = createDataSourceRegistry({
      isNamespaceOwner: () => true,
      validateDefinition: definition =>
        definition.ownerExtensionId === 'example.vendor/one' &&
        definition.contract === treeSpec.contract &&
        definition.major === treeSpec.major &&
        definition.schema.$ref === treeSpec.schema.$ref &&
        definition.conformanceProfile === treeSpec.conformanceProfile
          ? { state: 'valid' }
          : { state: 'invalid', reason: 'schema-invalid' },
    })
    const crossed = {
      ...treeSpec,
      schema: { $ref: textSpec.schema.$ref },
    }
    expect(
      await registry.replaceOwnerInventory('example.vendor/one', [
        inventoryEntry('example.vendor/one', crossed),
      ]),
    ).toMatchObject({
      state: 'rejected',
      results: [{ state: 'rejected', reason: 'schema-invalid' }],
    })
    expect(
      (
        await registry.replaceOwnerInventory('example.vendor/one', [
          inventoryEntry('example.vendor/one', treeSpec),
        ])
      ).state,
    ).toBe('committed')
  })

  it('snapshots the entire batch before callbacks can mutate caller-owned records', async () => {
    const mutable = {
      ...treeSpec,
      schema: { $ref: treeSpec.schema.$ref },
    }
    const registry = createDataSourceRegistry({
      isNamespaceOwner: () => {
        mutable.contract = 'attacker.invalid/replaced'
        mutable.schema.$ref = 'https://attacker.invalid/replaced.json'
        return true
      },
      validateDefinition: definition =>
        definition.contract === treeSpec.contract && definition.schema.$ref === treeSpec.schema.$ref
          ? { state: 'valid' }
          : { state: 'invalid', reason: 'schema-invalid' },
    })
    expect(
      (
        await registry.replaceOwnerInventory('example.vendor/one', [
          inventoryEntry('example.vendor/one', mutable),
        ])
      ).state,
    ).toBe('committed')
    expect(registry.lookup(treeSpec.contract, treeSpec.major)?.schema.$ref).toBe(
      treeSpec.schema.$ref,
    )
    expect(registry.lookup('attacker.invalid/replaced', treeSpec.major)).toBeUndefined()
  })

  it('fails closed on malformed host callbacks and malformed provenance', async () => {
    const malformedCallback = createDataSourceRegistry({
      isNamespaceOwner: () => true,
      validateDefinition: () => ({ state: 'unexpected' }) as never,
    })
    expect(
      await malformedCallback.replaceOwnerInventory('example.vendor/one', [
        inventoryEntry('example.vendor/one', treeSpec),
      ]),
    ).toMatchObject({
      state: 'rejected',
      results: [{ state: 'rejected', reason: 'schema-invalid' }],
    })

    const malformedEntry = inventoryEntry('example.vendor/one', treeSpec) as unknown as {
      provenance: Record<string, unknown>
    }
    malformedEntry.provenance.artifactRoot = 1
    expect(
      await createDataSourceRegistry(registryOptions()).replaceOwnerInventory(
        'example.vendor/one',
        [malformedEntry as never],
      ),
    ).toMatchObject({ state: 'rejected' })
  })

  it('captures trusted registry ports instead of retaining mutable options', async () => {
    const options = {
      isNamespaceOwner: () => false,
      validateDefinition: () => ({ state: 'valid' as const }),
    }
    const registry = createDataSourceRegistry(options)
    options.isNamespaceOwner = () => true
    const result = await registry.replaceOwnerInventory('example.vendor/one', [
      inventoryEntry('example.vendor/one', treeSpec),
    ])
    expect(result).toMatchObject({
      state: 'rejected',
      results: [{ state: 'rejected', reason: 'reserved-namespace' }],
    })
  })

  it('does not resurrect an unregistered owner or lose another owner across async validation', async () => {
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    let firstEntered: (() => void) | undefined
    const firstStarted = new Promise<void>(resolve => {
      firstEntered = resolve
    })
    const registry = createDataSourceRegistry({
      isNamespaceOwner: () => true,
      validateDefinition: async definition => {
        if (definition.ownerExtensionId === 'example.vendor/one') {
          firstEntered?.()
          await firstGate
        }
        return { state: 'valid' }
      },
    })
    const first = registry.replaceOwnerInventory('example.vendor/one', [
      inventoryEntry('example.vendor/one', treeSpec),
    ])
    await firstStarted

    const tableSpec: DataSourceContributionSpecV1 = {
      ...treeSpec,
      contract: 'example.view/table-data-source',
    }
    expect(
      (
        await registry.replaceOwnerInventory('example.vendor/two', [
          inventoryEntry('example.vendor/two', tableSpec),
        ])
      ).state,
    ).toBe('committed')
    releaseFirst?.()
    expect((await first).state).toBe('committed')
    expect(registry.lookup(tableSpec.contract, tableSpec.major)).toBeDefined()
    expect(registry.lookup(treeSpec.contract, treeSpec.major)).toBeDefined()

    let releaseStale: (() => void) | undefined
    const staleGate = new Promise<void>(resolve => {
      releaseStale = resolve
    })
    const staleRegistry = createDataSourceRegistry({
      isNamespaceOwner: () => true,
      validateDefinition: async () => {
        await staleGate
        return { state: 'valid' }
      },
    })
    const stale = staleRegistry.replaceOwnerInventory('example.vendor/stale', [
      inventoryEntry('example.vendor/stale', treeSpec),
    ])
    await Promise.resolve()
    staleRegistry.unregisterOwner('example.vendor/stale')
    releaseStale?.()
    expect(await stale).toMatchObject({ state: 'rejected' })
    expect(staleRegistry.lookup(treeSpec.contract, treeSpec.major)).toBeUndefined()
  })
})

describe('v1 projection contract', () => {
  it('makes unavailable catalog context an explicit, structured result', () => {
    const result: V1DescriptorProjectionResult = {
      state: 'unavailable',
      diagnostics: [
        {
          id: 'v1-projection-unavailable',
          code: V1_PROJECTION_UNAVAILABLE_CODE,
          category: 'dependency',
          severity: 'warning',
          message: 'viewer catalog context is unavailable',
        },
      ],
    }

    expect(result.state).toBe('unavailable')
    expect(result.diagnostics[0].code).toBe('modkit/compat-v1-projection-unavailable')
  })
})

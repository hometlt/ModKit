import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import {
  createHostTopology,
  resolveModWorkspaceGraph,
  revisionId,
  type ArtifactSource,
  type DataCatalogSnapshot,
  type InputSearchScope,
  type Lease,
} from '@modkitx-x3/sdk'
import {
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
  type HostComposition,
  type LinkedExtension,
} from '@modkitx-x3/host'
import {
  analyzeResolvedMapWorkspace,
  resolveMapSemanticAnalysis,
  resolveResolvedMapWorkspace,
} from '@modkitx-x3/host/maps'
import type { CompanionEnumerationOptions, CompanionOrigin } from '../src/input-resolution.js'
import { createResourceSession } from '../src/resource-session.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const { starcraft2Game } = (await import(
  pathToFileURL(join(repoRoot, 'extensions', 'blizzard', 'starcraft2-game', 'src', 'linked.js'))
    .href
)) as { readonly starcraft2Game: LinkedExtension }

const GAME_ID = 'org.modkitx/starcraft-2'
const REALM = 'org.modkitx.test/maps-host'
const operatingSystem =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.modkitx.test/maps',
  realms: [
    {
      schemaVersion: 1,
      realmId: REALM,
      revision: '1',
      target: { environment: 'node', operatingSystem, architecture: 'x64' },
      facilities: [],
      budgets: {
        maxConcurrentTasks: 2,
        maxWorkerCount: 0,
        maxResidentBytes: uint64('134217728'),
        maxTransferBytes: uint64('33554432'),
        defaultDeadlineMs: 10_000,
      },
      policy: { id: 'org.modkitx.test/maps-policy', revision: '1' },
    },
  ],
  links: [],
})
const activationBudget = {
  maxInputBytes: 33_554_432n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 4_194_304,
  maxDiagnostics: 100,
}

let composition: HostComposition
let definitions: ReturnType<typeof createBundledServiceDefinitionRegistry>

beforeAll(async () => {
  const linked = linkedExtensionInputs([starcraft2Game])
  const executionBackends = createExecutionBackendRegistry([linkedInProcessBackend(linked.modules)])
  composition = await createHostComposition({
    topology,
    realmId: REALM,
    extensions: linked.inputs,
    executionBackends,
  })
  definitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(composition.inventory, definitions)
})

function heightMap(): Uint8Array {
  const bytes = new Uint8Array(32 + 4 * 6)
  bytes.set(new TextEncoder().encode('HMAP'))
  const view = new DataView(bytes.buffer)
  view.setUint32(4, 101, true)
  view.setUint32(8, 2, true)
  view.setUint32(12, 2, true)
  for (let index = 0; index < 4; index += 1) {
    view.setUint16(32 + index * 6, 100 + index, true)
    view.setUint16(34 + index * 6, 10 + index, true)
    view.setUint16(36 + index * 6, index === 3 ? 0x9000 : 1, true)
  }
  return bytes
}

function navigationMap(): Uint8Array {
  const bytes = new Uint8Array(32 + 4 * 2)
  bytes.set(new TextEncoder().encode('PATH'))
  const view = new DataView(bytes.buffer)
  view.setUint32(4, 1, true)
  view.setUint32(8, 2, true)
  view.setUint32(12, 2, true)
  for (let index = 0; index < 4; index += 1) view.setUint16(32 + index * 2, index + 1, true)
  return bytes
}

const encoder = new TextEncoder()
const documents = [
  {
    path: 'Objects',
    bytes: encoder.encode(
      '<?xml version="1.0"?><PlacedObjects Version="27"><ObjectUnit Id="7" Position="1,2,3" Rotation="0.5" Scale="1,1,1" UnitType="Marine" Player="1"/></PlacedObjects>',
    ),
  },
  {
    path: 'Regions',
    bytes: encoder.encode(
      '<?xml version="1.0"?><Regions><region id="2"><name value="Start"/><shape type="circle"><center value="1,2"/><radius value="3"/></shape></region></Regions>',
    ),
  },
  { path: 't3HeightMap', bytes: heightMap() },
] as const

const catalog = Object.freeze({
  schemaVersion: 1,
  workspaceId: 'map-workspace',
  gameId: GAME_ID,
  analyzerId: 'test/catalog',
  typeIds: Object.freeze(['CUnit']),
  namespaces: Object.freeze([{ namespace: 'Unit', entityCount: 1 }]),
  entityCount: 1,
  patchCount: 1,
  entities: Object.freeze([
    Object.freeze({
      namespace: 'Unit',
      typeId: 'CUnit',
      entityId: 'Marine',
      inheritanceChain: Object.freeze([{ namespace: 'Unit', entityId: 'Marine' }]),
      fields: Object.freeze({ LifeMax: 45, Race: 'Terr' }),
      sources: Object.freeze([{ rootId: 'base', path: 'UnitData.xml', documentIndex: 0 }]),
      complete: true,
    }),
  ]),
  diagnostics: Object.freeze([]),
  complete: true,
}) satisfies DataCatalogSnapshot

async function resolveMaps() {
  const resolution = await resolveMapSemanticAnalysis({
    services: { ...composition, serviceDefinitions: definitions },
    gameId: GAME_ID,
    grant: { id: 'maps-test', classes: [] },
    budgets: activationBudget,
  })
  expect(
    resolution.state,
    resolution.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
  ).toBe('resolved')
  if (resolution.state !== 'resolved') throw new Error('semantic map analyzer did not resolve')
  return resolution
}

const limits = {
  maxDocuments: 8,
  maxDocumentBytes: 1_000_000,
  maxTotalBytes: 4_000_000,
  maxObjects: 1_000,
  maxRegions: 1_000,
  maxTerrainCells: 100_000,
  maxTerrainSamples: 16,
  maxDepth: 32,
} as const

const mapRoot = 'workspace/active.sc2map'

function workspaceLock(activePath = mapRoot) {
  return resolveModWorkspaceGraph({
    workspaceId: 'map-workspace',
    gameId: GAME_ID,
    activeRootId: 'active',
    sources: [{ sourceId: 'workspace', kind: 'memory', location: 'memory:workspace' }],
    roots: [
      {
        rootId: 'active',
        sourceId: 'workspace',
        sourcePath: activePath,
        displayName: 'Active.SC2Map',
        kind: 'map',
        dependencies: [],
      },
    ],
    maxRoots: 4,
    maxDepth: 4,
  })
}

function memoryOrigin(
  files: ReadonlyMap<string, Uint8Array>,
  options: Readonly<{
    primaryLogicalId?: string
    fixedRevision?: boolean
    chunkSize?: number
    chunks?: Map<string, number>
    releases?: Map<string, number>
  }> = {},
): CompanionOrigin {
  const paths = [...files.keys()].sort()
  return Object.freeze({
    primaryLogicalId: options.primaryLogicalId ?? mapRoot,
    caseSensitivity: 'insensitive',
    scopes: Object.freeze([
      'current-mount',
      'enclosing-container',
      'workspace-dependency-layer',
    ] as const),
    async *enumerate(
      _scope: InputSearchScope,
      options: CompanionEnumerationOptions,
      signal?: AbortSignal,
    ) {
      for (const path of paths) {
        signal?.throwIfAborted()
        if (!path.startsWith(options.prefix.toLowerCase())) continue
        yield Object.freeze({ logicalId: path, size: BigInt(files.get(path)?.byteLength ?? 0) })
      }
    },
    open(logicalId: string, signal?: AbortSignal): Promise<Lease<ArtifactSource>> {
      signal?.throwIfAborted()
      const path = logicalId.toLowerCase()
      const bytes = files.get(path)
      if (bytes === undefined) throw new RangeError(`unknown map resource ${logicalId}`)
      const uri = `memory://maps/${encodeURIComponent(path)}`
      const source: ArtifactSource = Object.freeze({
        kind: 'bytes',
        ref: Object.freeze({ id: uri, uri }),
        revision: revisionId(
          options.fixedRevision
            ? 'provider-token:shared-container-entry-revision'
            : `provider-token:${encodeURIComponent(`${path}:${bytes.byteLength}`)}`,
        ),
        ...(options.chunkSize === undefined ? { size: BigInt(bytes.byteLength) } : {}),
        read(offset: bigint, length: number, readSignal?: AbortSignal) {
          readSignal?.throwIfAborted()
          const start = Number(offset)
          return Promise.resolve(bytes.slice(start, start + length))
        },
        async *stream(_range?: { readonly offset: bigint }, streamSignal?: AbortSignal) {
          streamSignal?.throwIfAborted()
          const chunkSize = options.chunkSize ?? bytes.byteLength
          for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
            streamSignal?.throwIfAborted()
            options.chunks?.set(path, (options.chunks.get(path) ?? 0) + 1)
            yield bytes.slice(offset, offset + chunkSize)
          }
        },
      })
      return Promise.resolve({
        value: source,
        release: () => {
          options.releases?.set(path, (options.releases.get(path) ?? 0) + 1)
          return Promise.resolve()
        },
      })
    },
  })
}

function workspaceFiles(root = mapRoot): ReadonlyMap<string, Uint8Array> {
  return new Map([
    [`${root}/objects`, documents[0].bytes],
    [`${root}/regions`, documents[1].bytes],
    [`${root}/t3heightmap`, documents[2].bytes],
    [`${root}/t3syncpathinginfo`, navigationMap()],
  ])
}

describe('standard map contract and semantic game provider', () => {
  it('opens terrain, regions and placed objects, then binds them to the resolved catalog', async () => {
    const resolution = await resolveMaps()
    try {
      const preliminary = await resolution.analysis.open({
        workspaceId: 'map-workspace',
        gameId: GAME_ID,
        mapId: 'Synthetic.SC2Map',
        documents,
        ...limits,
      })
      expect(preliminary.complete).toBe(false)
      expect(preliminary.catalogQueries).toEqual([{ namespace: 'Unit', entityId: 'Marine' }])

      const snapshot = await resolution.analysis.open({
        workspaceId: 'map-workspace',
        gameId: GAME_ID,
        mapId: 'Synthetic.SC2Map',
        documents,
        catalog,
        ...limits,
      })
      expect(snapshot.complete).toBe(true)
      expect(snapshot.terrain).toMatchObject({
        version: 101,
        width: 2,
        height: 2,
        cellCount: 4,
        minimumHeightBase: 100,
        maximumHeightBase: 103,
        cliffCellCount: 1,
      })
      expect(snapshot.regions[0]).toMatchObject({
        regionId: 2,
        name: 'Start',
        shapes: [{ type: 'circle', parameters: { center: '1,2', radius: '3' } }],
      })
      expect(snapshot.objects[0]).toMatchObject({
        kind: 'unit',
        objectId: 7,
        typeId: 'Marine',
        position: { x: 1, y: 2, z: 3 },
        catalog: {
          ref: { namespace: 'Unit', entityId: 'Marine' },
          entity: { typeId: 'CUnit', fields: { LifeMax: 45, Race: 'Terr' } },
        },
      })
      expect(snapshot.resolvedCatalogObjects).toBe(1)
      expect(Object.keys(resolution.analysis).sort()).toEqual([
        'analyzerId',
        'contract',
        'gameIds',
        'open',
      ])
      expect(Object.keys(snapshot).sort()).toEqual([
        'analyzerId',
        'catalogQueries',
        'complete',
        'diagnostics',
        'documentPaths',
        'gameId',
        'mapId',
        'objects',
        'regions',
        'resolvedCatalogObjects',
        'schemaVersion',
        'terrain',
        'workspaceId',
      ])
    } finally {
      await resolution.release()
    }
  })

  it('runs the resolved service through ResourceSession and pages exact world joins', async () => {
    const resources = createResourceSession({
      origin: memoryOrigin(workspaceFiles()),
      revision: revisionId('provider-token:map-world-v1'),
    })
    const result = await analyzeResolvedMapWorkspace({
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'maps-workspace-test', classes: [] },
      budgets: activationBudget,
      workspace: workspaceLock(),
      resources,
      catalog,
      limits: { ...limits, maxRequirements: 8, maxPageSize: 2, maxDiagnostics: 32 },
    })
    expect(
      result.state,
      result.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
    ).toBe('resolved')
    if (result.state !== 'resolved') throw new Error('resolved map workspace did not open')
    const source = result.world.value
    try {
      expect(result.plan.requirements.map(item => item.path)).toEqual([
        `${mapRoot}/objects`,
        `${mapRoot}/regions`,
        `${mapRoot}/t3heightmap`,
        `${mapRoot}/t3syncpathinginfo`,
      ])
      expect(resources.provenance()).toHaveLength(4)
      expect(result.snapshot.semantic.complete).toBe(true)
      expect(result.snapshot.navigation).toMatchObject({ width: 2, height: 2, cellCount: 4 })
      const info = await source.info()
      expect(source.contract).toBe('org.modkitx.blizzard.starcraft2/world-scene-source')
      expect(info.coordinateSpaces.map(item => item.id)).toEqual([
        'map-native',
        'height-grid',
        'navigation-grid',
      ])
      expect(info.crossSpaceTransforms).toContainEqual(
        expect.objectContaining({ from: 'height-grid', to: 'map-native', state: 'unknown' }),
      )
      expect(info.bounds).toContainEqual(
        expect.objectContaining({ facet: 'terrain', coordinateSpaceId: 'height-grid' }),
      )
      const firstLayers = await source.page({ facet: 'layers', limit: 2 })
      expect(firstLayers.items).toHaveLength(2)
      expect(firstLayers.nextCursor).toEqual(expect.any(String))

      const terrainLayer = info.facets.find(item => item.facet === 'terrain')
      if (terrainLayer === undefined) throw new Error('terrain layer absent')
      const terrainPage = await source.page({
        facet: 'terrain',
        layerId: terrainLayer.layerId,
        lod: 'sampled',
        limit: 1,
      })
      expect(terrainPage.items[0]).toMatchObject({
        facet: 'terrain',
        coordinateSpaceId: 'height-grid',
      })
      if (terrainPage.nextCursor === undefined) throw new Error('terrain cursor absent')
      let queryFailure: unknown
      try {
        await source.page({
          facet: 'terrain',
          layerId: terrainLayer.layerId,
          lod: 'sampled',
          bounds: { minimumX: 0, minimumY: 0, maximumX: 0, maximumY: 0 },
          cursor: terrainPage.nextCursor,
          limit: 1,
        })
      } catch (error) {
        queryFailure = error
      }
      expect(String(queryFailure)).toMatch(/spatial query/u)
      queryFailure = undefined
      try {
        await source.page({
          facet: 'terrain',
          layerId: terrainLayer.layerId,
          lod: 'summary',
          cursor: terrainPage.nextCursor,
          limit: 1,
        })
      } catch (error) {
        queryFailure = error
      }
      expect(String(queryFailure)).toMatch(/LOD/u)
      await expect(
        source.page({
          facet: 'terrain',
          layerId: terrainLayer.layerId,
          lod: 'sampled',
          cursor: `stale${terrainPage.nextCursor}`,
          limit: 1,
        }),
      ).rejects.toThrow(/stale/u)
      await expect(source.page({ facet: 'layers', limit: 3 })).rejects.toThrow(/between 1 and 2/u)

      const objectLayer = info.facets.find(item => item.facet === 'objects')
      const resourceLayer = info.facets.find(item => item.facet === 'resources')
      const regionLayer = info.facets.find(item => item.facet === 'regions')
      if (objectLayer === undefined || resourceLayer === undefined || regionLayer === undefined) {
        throw new Error('object/resource/region layers absent')
      }
      const objectPage = await source.page({
        facet: 'objects',
        layerId: objectLayer.layerId,
        bounds: { minimumX: 0, minimumY: 0, maximumX: 2, maximumY: 3 },
        limit: 2,
      })
      const placed = objectPage.items.find(item => item.facet === 'objects')
      expect(placed).toMatchObject({ coordinateSpaceId: 'map-native' })
      const resourcesPage = await source.page({
        facet: 'resources',
        layerId: resourceLayer.layerId,
        limit: 2,
      })
      expect(resourcesPage.items[0]).toMatchObject({
        id: 'resource:Unit/Marine',
        objectIds: [placed?.id],
      })
      expect(
        await source.page({
          facet: 'regions',
          layerId: regionLayer.layerId,
          bounds: { minimumX: 0, minimumY: 0, maximumX: 2, maximumY: 3 },
          limit: 1,
        }),
      ).toMatchObject({ state: 'unsupported', reason: expect.stringContaining('spatial') })
      expect(await source.page({ facet: 'lighting', limit: 1 })).toMatchObject({
        state: 'unsupported',
        reason: expect.stringContaining('lighting'),
      })
      const cancelled = new AbortController()
      cancelled.abort()
      await expect(source.info(cancelled.signal)).rejects.toThrow()
    } finally {
      await result.release()
      await resources.dispose()
    }
    await expect(source.info()).rejects.toThrow(/released or stale/u)
  })

  it('names missing facets, plan budgets and disposed resource sessions', async () => {
    const sparse = new Map(workspaceFiles())
    sparse.delete(`${mapRoot}/t3syncpathinginfo`)
    const resources = createResourceSession({
      origin: memoryOrigin(sparse),
      revision: revisionId('provider-token:map-world-sparse-v1'),
    })
    const result = await analyzeResolvedMapWorkspace({
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'maps-workspace-sparse', classes: [] },
      budgets: activationBudget,
      workspace: workspaceLock(),
      resources,
      catalog,
      limits: { ...limits, maxRequirements: 8, maxPageSize: 2, maxDiagnostics: 32 },
    })
    expect(result.state).toBe('resolved')
    if (result.state === 'resolved') {
      expect(result.snapshot.unresolvedRequirementIds).toEqual(['map-navigation'])
      expect((await result.world.value.info()).facets).toContainEqual(
        expect.objectContaining({ facet: 'navigation', state: 'unavailable' }),
      )
      await result.release()
    }
    await resources.dispose()
    expect(
      await analyzeResolvedMapWorkspace({
        services: { ...composition, serviceDefinitions: definitions },
        grant: { id: 'maps-workspace-disposed', classes: [] },
        budgets: activationBudget,
        workspace: workspaceLock(),
        resources,
        catalog,
        limits: { ...limits, maxRequirements: 8, maxPageSize: 2, maxDiagnostics: 32 },
      }),
    ).toMatchObject({ state: 'unresolved' })

    const resolution = await resolveResolvedMapWorkspace({
      services: { ...composition, serviceDefinitions: definitions },
      gameId: GAME_ID,
      grant: { id: 'maps-plan-budget', classes: [] },
      budgets: activationBudget,
    })
    expect(resolution.state).toBe('resolved')
    if (resolution.state === 'resolved') {
      expect(
        (await resolution.workspace.plan({ workspace: workspaceLock(), maxRequirements: 2 }))
          .complete,
      ).toBe(false)
      await resolution.release()
    }
  })

  it('binds snapshots to map/path/content and stops cumulative streams at the byte cap', async () => {
    const secondRoot = 'workspace/second.sc2map'
    const sharedRevision = revisionId('provider-token:shared-map-container')
    const firstResources = createResourceSession({
      origin: memoryOrigin(workspaceFiles(), { fixedRevision: true }),
      revision: sharedRevision,
    })
    const secondResources = createResourceSession({
      origin: memoryOrigin(workspaceFiles(secondRoot), {
        primaryLogicalId: secondRoot,
        fixedRevision: true,
      }),
      revision: sharedRevision,
    })
    const open = (activePath: string, resources: typeof firstResources) =>
      analyzeResolvedMapWorkspace({
        services: { ...composition, serviceDefinitions: definitions },
        grant: { id: `maps-collision-${activePath}`, classes: [] },
        budgets: activationBudget,
        workspace: workspaceLock(activePath),
        resources,
        catalog,
        limits: {
          ...limits,
          maxRequirements: 8,
          maxPageSize: 2,
          maxDiagnostics: 32,
        },
      })
    const [first, second] = await Promise.all([
      open(mapRoot, firstResources),
      open(secondRoot, secondResources),
    ])
    expect(first.state).toBe('resolved')
    expect(second.state).toBe('resolved')
    if (first.state !== 'resolved' || second.state !== 'resolved') {
      throw new Error('collision fixtures did not resolve')
    }
    try {
      expect(first.snapshot.snapshotId).not.toBe(second.snapshot.snapshotId)
      const firstPage = await first.world.value.page({ facet: 'layers', limit: 1 })
      if (firstPage.nextCursor === undefined) throw new Error('collision cursor absent')
      await expect(
        second.world.value.page({
          facet: 'layers',
          cursor: firstPage.nextCursor,
          limit: 1,
        }),
      ).rejects.toThrow(/stale/u)
    } finally {
      await first.release()
      await second.release()
      await firstResources.dispose()
      await secondResources.dispose()
    }

    const changedFiles = new Map(workspaceFiles())
    const changedHeight = heightMap()
    const finalByte = changedHeight.byteLength - 1
    changedHeight[finalByte] = (changedHeight[finalByte] ?? 0) ^ 1
    changedFiles.set(`${mapRoot}/t3heightmap`, changedHeight)
    const contentAResources = createResourceSession({
      origin: memoryOrigin(workspaceFiles(), { fixedRevision: true }),
      revision: sharedRevision,
    })
    const contentBResources = createResourceSession({
      origin: memoryOrigin(changedFiles, { fixedRevision: true }),
      revision: sharedRevision,
    })
    const [contentA, contentB] = await Promise.all([
      open(mapRoot, contentAResources),
      open(mapRoot, contentBResources),
    ])
    expect(contentA.state).toBe('resolved')
    expect(contentB.state).toBe('resolved')
    if (contentA.state !== 'resolved' || contentB.state !== 'resolved') {
      throw new Error('content-collision fixtures did not resolve')
    }
    expect(contentA.snapshot.snapshotId).not.toBe(contentB.snapshot.snapshotId)
    await contentA.release()
    await contentB.release()
    await contentAResources.dispose()
    await contentBResources.dispose()

    const chunks = new Map<string, number>()
    const releases = new Map<string, number>()
    const streamedResources = createResourceSession({
      origin: memoryOrigin(workspaceFiles(), { chunkSize: 8, chunks, releases }),
      revision: revisionId('provider-token:cumulative-stream-budget'),
    })
    const maxTotalBytes = documents[0].bytes.byteLength + 8
    const bounded = await analyzeResolvedMapWorkspace({
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'maps-cumulative-stream-budget', classes: [] },
      budgets: activationBudget,
      workspace: workspaceLock(),
      resources: streamedResources,
      catalog,
      limits: {
        ...limits,
        maxRequirements: 8,
        maxDocumentBytes: maxTotalBytes,
        maxTotalBytes,
        maxPageSize: 2,
        maxDiagnostics: 32,
      },
    })
    expect(bounded.state).toBe('resolved')
    if (bounded.state === 'resolved') {
      expect(bounded.snapshot.complete).toBe(false)
      expect(bounded.snapshot.unresolvedRequirementIds).toEqual([
        'map-regions',
        'map-terrain-height',
        'map-navigation',
      ])
      await bounded.release()
    }
    expect(chunks.get(`${mapRoot}/regions`)).toBe(2)
    expect(releases.get(`${mapRoot}/regions`)).toBe(1)
    expect(chunks.has(`${mapRoot}/t3heightmap`)).toBe(false)
    await streamedResources.dispose()
  })

  it('enforces activation budgets and publishes an explicit diagnostic truncation marker', async () => {
    const budgetResources = createResourceSession({
      origin: memoryOrigin(workspaceFiles()),
      revision: revisionId('provider-token:operation-budget'),
    })
    await expect(
      analyzeResolvedMapWorkspace({
        services: { ...composition, serviceDefinitions: definitions },
        grant: { id: 'maps-operation-budget', classes: [] },
        budgets: activationBudget,
        workspace: workspaceLock(),
        resources: budgetResources,
        catalog,
        limits: {
          ...limits,
          maxRequirements: 8,
          maxPageSize: 2,
          maxDiagnostics: activationBudget.maxDiagnostics + 1,
        },
      }),
    ).rejects.toThrow(/maxDiagnostics exceeds/u)
    await budgetResources.dispose()

    const duplicateObjects = encoder.encode(
      '<?xml version="1.0"?><PlacedObjects Version="27"><ObjectUnit Id="7" Position="1,2,3" UnitType="Marine"/><ObjectUnit Id="7" Position="2,3,4" UnitType="Marine"/><ObjectUnit Id="7" Position="3,4,5" UnitType="Marine"/></PlacedObjects>',
    )
    const duplicateFiles = new Map(workspaceFiles())
    duplicateFiles.set(`${mapRoot}/objects`, duplicateObjects)
    const truncatedResources = createResourceSession({
      origin: memoryOrigin(duplicateFiles),
      revision: revisionId('provider-token:diagnostic-truncation'),
    })
    const truncated = await analyzeResolvedMapWorkspace({
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'maps-diagnostic-truncation', classes: [] },
      budgets: activationBudget,
      workspace: workspaceLock(),
      resources: truncatedResources,
      catalog,
      limits: {
        ...limits,
        maxRequirements: 8,
        maxPageSize: 2,
        maxDiagnostics: 1,
      },
    })
    expect(truncated.state).toBe('resolved')
    if (truncated.state === 'resolved') {
      expect(truncated.snapshot.diagnosticsTruncated).toBe(true)
      expect(truncated.snapshot.complete).toBe(false)
      expect(truncated.snapshot.diagnostics).toEqual([
        expect.objectContaining({
          code: 'org.modkitx.blizzard.starcraft2/map-diagnostics-truncated',
        }),
      ])
      expect(truncated.snapshot.semantic.diagnostics).toHaveLength(0)
      const truncatedInfo = await truncated.world.value.info()
      expect(truncatedInfo.facets).toContainEqual(
        expect.objectContaining({ facet: 'objects', state: 'partial', itemCount: 1 }),
      )
      const truncatedObjectLayer = truncatedInfo.facets.find(item => item.facet === 'objects')
      if (truncatedObjectLayer === undefined) throw new Error('truncated object layer absent')
      expect(
        (
          await truncated.world.value.page({
            facet: 'objects',
            layerId: truncatedObjectLayer.layerId,
            limit: 2,
          })
        ).items,
      ).toHaveLength(1)
      await truncated.release()
    }
    await truncatedResources.dispose()
  })

  it('does not route the provider to another game', async () => {
    const resolution = await resolveMapSemanticAnalysis({
      services: { ...composition, serviceDefinitions: definitions },
      gameId: 'example/other-game',
      grant: { id: 'maps-test-mismatch', classes: [] },
      budgets: activationBudget,
    })
    expect(resolution.state).toBe('unresolved')
    expect(resolution.diagnostics.map(item => item.code)).toContain(
      'x3.host/map-semantic-unresolved',
    )
  })
})

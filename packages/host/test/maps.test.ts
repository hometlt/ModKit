import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CONTAINER_EXTRACT_OPERATION_ID, uint64 } from '@modkitx-x3/core'
import {
  createHostTopology,
  resolveModWorkspaceGraph,
  revisionId,
  WORLD_SCENE_SOURCE_CONTRACT,
  type ArtifactSource,
  type DataCatalogSnapshot,
  type InputSearchScope,
  type JsonValue,
  type Lease,
  type OperationDecl,
  type OperationOutput,
} from '@modkitx-x3/sdk'
import {
  MAP_PREVIEW_PREPARATION_CONTRACT,
  type MapPreviewPreparationPort,
} from '@modkitx-x3/sdk/maps'
import {
  assembleSubjectDescriptor,
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  createAssetSession,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
  type HostComposition,
  type LinkedExtension,
} from '@modkitx-x3/host'
import {
  analyzeResolvedMapWorkspace,
  coordinateMapPreviewAssetSession,
  openMapPreviewAssetSession,
  resolveMapSemanticAnalysis,
  resolveResolvedMapWorkspace,
  type MapPreviewResourcePlanResolver,
} from '@modkitx-x3/host/maps'
import type { CompanionEnumerationOptions, CompanionOrigin } from '../src/input-resolution.js'
import { createCandidateWorldSceneLease } from '../src/maps/world-source.js'
import { createResourceSession } from '../src/resource-session.js'
import { resolvedDescriptorWire } from './fixtures/descriptor.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const { starcraft2Game } = (await import(
  pathToFileURL(join(repoRoot, 'extensions', 'blizzard', 'starcraft2-game', 'src', 'linked.js'))
    .href
)) as { readonly starcraft2Game: LinkedExtension }
const { warzone2100 } = (await import(
  pathToFileURL(join(repoRoot, 'extensions', 'opensource', 'warzone-2100', 'src', 'linked.js')).href
)) as { readonly warzone2100: LinkedExtension }

const GAME_ID = 'org.modkitx/starcraft-2'
const WARZONE_GAME_ID = 'org.modkitx/warzone-2100'
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
  const linked = linkedExtensionInputs([starcraft2Game, warzone2100])
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

function terrainXml(quantizeBias = 1): Uint8Array {
  return new TextEncoder().encode(
    `<?xml version="1.0"?><terrain version="113"><heightMap dim="2 2 " offset="10 20 30 " scale="2.000000e+000 3.000000e+000 4.000000e+000 "><vertData quantizeBias="${String(quantizeBias)}" quantizeScale="5.000000e-001" standardHeight="8" name="t3HeightMap"/></heightMap></terrain>`,
  )
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
const warzoneMapRoot = 'multiplay/maps/fixture'

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

function warzoneWorkspaceLock() {
  return resolveModWorkspaceGraph({
    workspaceId: 'warzone-map-workspace',
    gameId: WARZONE_GAME_ID,
    activeRootId: 'active',
    sources: [{ sourceId: 'workspace', kind: 'memory', location: 'memory:warzone-workspace' }],
    roots: [
      {
        rootId: 'active',
        sourceId: 'workspace',
        sourcePath: warzoneMapRoot,
        displayName: 'Warzone fixture',
        kind: 'map',
        dependencies: [],
      },
    ],
    maxRoots: 4,
    maxDepth: 4,
  })
}

function warzoneGameMap(): Uint8Array {
  const width = 2
  const height = 3
  const count = width * height
  const bytes = new Uint8Array(16 + count * 3 + 8 + 4)
  bytes.set(new TextEncoder().encode('map '), 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(4, 10, true)
  view.setUint32(8, width, true)
  view.setUint32(12, height, true)
  let offset = 16
  for (let index = 0; index < count; index += 1) {
    view.setUint16(offset, index, true)
    view.setUint8(offset + 2, index + 1)
    offset += 3
  }
  view.setUint32(offset, 1, true)
  view.setUint32(offset + 4, 1, true)
  bytes.set([0, 0, 1, 2], offset + 8)
  return bytes
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
    [`${root}/t3terrain.xml`, terrainXml()],
    [`${root}/t3syncpathinginfo`, navigationMap()],
  ])
}

function previewWorkspaceInput() {
  return {
    workspaceId: 'map-workspace',
    gameId: GAME_ID,
    activeRootId: 'active',
    sources: [{ sourceId: 'workspace', kind: 'memory' as const, location: 'memory:workspace' }],
    roots: [
      {
        rootId: 'active',
        sourceId: 'workspace',
        sourcePath: mapRoot,
        displayName: 'Active.SC2Map',
        kind: 'map' as const,
        dependencies: [],
      },
    ],
    maxRoots: 4,
    maxDepth: 4,
  }
}

async function originalMapSession(
  files: ReadonlyMap<string, Uint8Array>,
  publishesNamespace = true,
) {
  const namespaceRelease = vi.fn(async () => undefined)
  const entryRelease = vi.fn(async () => undefined)
  const originalRelease = vi.fn(async () => undefined)
  const paths = [...files.keys()].sort()
  const namespace = {
    async list(
      prefix: string,
      page: { readonly cursor?: string; readonly limit: number },
      signal?: AbortSignal,
    ) {
      signal?.throwIfAborted()
      const matched = paths.filter(path => path.toLowerCase().startsWith(prefix.toLowerCase()))
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      const selected = matched.slice(start, start + page.limit)
      const next = start + selected.length
      return Object.freeze({
        items: Object.freeze(
          selected.map((path, index) =>
            Object.freeze({
              id: path,
              path,
              name: path.split('/').at(-1) ?? path,
              kind: 'file' as const,
              size: BigInt(files.get(path)?.byteLength ?? 0),
              revision: revisionId(`provider-token:preview-entry-${String(start + index)}`),
            }),
          ),
        ),
        ...(next < matched.length ? { nextCursor: String(next) } : {}),
      })
    },
    openEntry(entryId: string, signal?: AbortSignal) {
      signal?.throwIfAborted()
      if (!files.has(entryId)) throw new RangeError(`unknown namespace entry ${entryId}`)
      const uri = `memory://preview/${encodeURIComponent(entryId)}`
      return Promise.resolve({
        value: Object.freeze({ id: uri, uri }),
        release: entryRelease,
      })
    },
  }
  const operations = publishesNamespace
    ? [
        {
          id: CONTAINER_EXTRACT_OPERATION_ID,
          handlerId: 'extract',
          state: 'available' as const,
          mutatesSource: false,
        },
      ]
    : []
  const wire = resolvedDescriptorWire(operations)
  const descriptor = await assembleSubjectDescriptor({
    ...wire,
    subjectUri: 'memory://maps/active.sc2map',
    identity: { ...wire.identity, formatId: 'example/map-container' },
    dataSources: publishesNamespace
      ? [{ contract: 'common.view/namespace-entry-source', major: 1 }]
      : [],
  })
  const declarations: OperationDecl[] = descriptor.operations.map(operation => ({
    id: operation.id,
    handlerId: operation.handlerId,
    mutatesSource: false,
    outputKinds: ['bytes'],
  }))
  const handlers = new Map<string, (input: JsonValue) => Promise<OperationOutput>>([
    [
      'extract',
      async input => {
        const entryId =
          typeof input === 'object' && input !== null && !Array.isArray(input)
            ? (input as Readonly<Record<string, JsonValue>>)['entryId']
            : undefined
        if (typeof entryId !== 'string') throw new TypeError('extract requires entryId')
        const bytes = files.get(entryId)
        if (bytes === undefined) throw new RangeError(`unknown extraction entry ${entryId}`)
        return { kind: 'bytes', value: bytes }
      },
    ],
  ])
  const managed = createAssetSession({
    revision: descriptor.revision,
    descriptor,
    operationDeclarations: declarations,
    permissionGrant: { id: 'map-preview-original', classes: [] },
    handlers,
    async openDataSource(contract, major) {
      if (publishesNamespace && contract === 'common.view/namespace-entry-source' && major === 1) {
        return { value: namespace, release: namespaceRelease } as never
      }
      throw new RangeError(`original session has no ${contract}@${String(major)}`)
    },
    release: [originalRelease],
  })
  return {
    session: managed.session,
    namespaceRelease,
    entryRelease,
    originalRelease,
  }
}

function previewPreparation(
  prepare: MapPreviewPreparationPort['prepare'],
): MapPreviewPreparationPort {
  return Object.freeze({
    contract: MAP_PREVIEW_PREPARATION_CONTRACT,
    preparationId: 'example/map-preview-preparation',
    subjectFormatIds: Object.freeze(['example/map-container']),
    prepare,
  })
}

const coordinatorLimits = {
  ...limits,
  maxRequirements: 8,
  maxPageSize: 2,
  maxDiagnostics: 32,
} as const

describe('standard map contract and semantic game provider', () => {
  it('routes Warzone game.map through ResourceSession into the same exact world candidate', async () => {
    const files = new Map([[`${warzoneMapRoot}/game.map`, warzoneGameMap()]])
    const resources = createResourceSession({
      origin: memoryOrigin(files, { primaryLogicalId: warzoneMapRoot }),
      revision: revisionId('provider-token:warzone-map-fixture'),
    })
    const result = await analyzeResolvedMapWorkspace({
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'warzone-maps-test', classes: [] },
      budgets: activationBudget,
      workspace: warzoneWorkspaceLock(),
      resources,
      limits: {
        ...limits,
        maxRequirements: 8,
        maxTerrainCells: 65_536,
        maxTerrainSamples: 65_536,
        maxPageSize: 64,
        maxDiagnostics: 32,
      },
    })
    expect(
      result.state,
      result.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
    ).toBe('resolved')
    if (result.state !== 'resolved') throw new Error('Warzone map workspace did not resolve')
    try {
      expect(result.snapshot.terrainTransform).toMatchObject({
        source: { format: 'warzone-game-map', heightEncoding: 'uint8-times-2' },
        mapping: { vertical: 'direct-base-times-scale-plus-offset' },
      })
      const info = await result.world.value.info()
      expect(info).toMatchObject({
        contract: 'org.modkitx.opensource.warzone2100/world-scene-source',
        terrainTransform: result.snapshot.terrainTransform,
        uvwTransform: result.snapshot.uvwTransform,
      })
      const page = await result.world.value.page({
        facet: 'terrain',
        layerId: `${result.snapshot.snapshotId}:layer:terrain`,
        lod: 'exact',
        limit: 64,
      })
      expect(page.items).toHaveLength(6)
      expect(page.items[0]).toMatchObject({
        x: 0,
        y: 0,
        heightBase: 2,
        mapNativePosition: { x: 0, y: 0, z: 2 },
        uvwPosition: { x: 0, y: 2, z: 0 },
      })
      expect(page.items[5]).toMatchObject({
        x: 1,
        y: 2,
        heightBase: 12,
        mapNativePosition: { x: 128, y: 256, z: 12 },
        uvwPosition: { x: 128, y: 12, z: -256 },
      })
    } finally {
      await result.release()
      await resources.dispose()
    }
  })

  it('owns a common world preview session without hiding partial or unknown facets', async () => {
    const sparse = new Map(workspaceFiles())
    sparse.delete(`${mapRoot}/t3syncpathinginfo`)
    const releases = new Map<string, number>()
    const resources = createResourceSession({
      origin: memoryOrigin(sparse, { releases }),
      revision: revisionId('provider-token:map-preview-session-v1'),
    })
    const opened = await openMapPreviewAssetSession({
      subjectUri: 'memory://maps/active.sc2map',
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'maps-preview-session', classes: [] },
      budgets: activationBudget,
      workspace: workspaceLock(),
      resources,
      catalog,
      limits: {
        ...limits,
        maxRequirements: 8,
        maxTerrainSamples: 3,
        maxPageSize: 2,
        maxDiagnostics: 32,
      },
    })
    expect(
      opened.state,
      opened.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
    ).toBe('opened')
    if (opened.state !== 'opened') throw new Error('common map preview did not open')

    expect(opened.session.state()).toBe('live')
    expect(await opened.session.descriptor()).toMatchObject({
      subjectUri: 'memory://maps/active.sc2map',
      interpretation: 'none',
      constraints: { readOnly: true, randomAccess: true },
      dataSources: [{ contract: WORLD_SCENE_SOURCE_CONTRACT, major: 1 }],
      revision: resources.revision,
    })

    const first = await opened.session.dataSource(WORLD_SCENE_SOURCE_CONTRACT, 1)
    const info = await first.value.info()
    expect(first.value.contract).toBe(WORLD_SCENE_SOURCE_CONTRACT)
    expect(info).toMatchObject({
      contract: WORLD_SCENE_SOURCE_CONTRACT,
      maturity: 'publisher-candidate',
      lossPolicy: 'explicit-partial',
    })
    expect(info.unknownFacets).toEqual(opened.snapshot.worldCandidate.unknownFacets)
    expect(info.facets).toContainEqual(
      expect.objectContaining({ facet: 'navigation', state: 'unavailable' }),
    )
    expect(info.facets).toContainEqual(
      expect.objectContaining({ facet: 'terrain', state: 'partial' }),
    )

    await first.release()
    await expect(first.value.info()).rejects.toThrow(/lease has been released/u)
    const second = await opened.session.dataSource(WORLD_SCENE_SOURCE_CONTRACT, 1)
    await expect(opened.session.dataSource('common.view/text-data-source', 1)).rejects.toThrow(
      /does not publish/u,
    )

    await Promise.all([opened.session.dispose(), opened.session.dispose()])
    expect(opened.session.state()).toBe('disposed')
    expect(resources.state()).toBe('disposed')
    await expect(second.value.info()).rejects.toThrow(/released or stale/u)
    await second.release()
    expect([...releases.values()].every(count => count === 1)).toBe(true)
  })

  it('disposes an owned ResourceSession when a common map preview cannot resolve', async () => {
    const resources = createResourceSession({
      origin: memoryOrigin(workspaceFiles()),
      revision: revisionId('provider-token:map-preview-unresolved-v1'),
    })
    const unsupportedWorkspace = Object.freeze({
      ...workspaceLock(),
      gameId: 'example/other-game',
    })
    const result = await openMapPreviewAssetSession({
      subjectUri: 'memory://maps/unsupported-map',
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'maps-preview-unresolved', classes: [] },
      budgets: activationBudget,
      workspace: unsupportedWorkspace,
      resources,
      limits: { ...limits, maxRequirements: 8, maxPageSize: 2, maxDiagnostics: 32 },
    })

    expect(result.state).toBe('unresolved')
    expect(resources.state()).toBe('disposed')
  })

  it('passes only a bounded namespace index to preparation and preserves selection ownership', async () => {
    const original = await originalMapSession(workspaceFiles())
    const prepare = vi.fn<MapPreviewPreparationPort['prepare']>(async () => ({
      state: 'selection-required',
      candidates: [
        { candidateId: 'map:first', displayName: 'First map', sourcePath: 'maps/first' },
        { candidateId: 'map:second', displayName: 'Second map', sourcePath: 'maps/second' },
      ],
      diagnostics: [],
    }))
    const result = await coordinateMapPreviewAssetSession({
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'maps-preview-selection', classes: [] },
      budgets: activationBudget,
      original: original.session,
      preparation: previewPreparation(prepare),
      selectionId: 'map:second',
      maxCandidates: 8,
      maxSubjectEntries: 2,
      maxSubjectPages: 1,
      maxRoots: 4,
      maxDepth: 4,
      limits: coordinatorLimits,
    })

    expect(result).toMatchObject({ state: 'selection-required', candidates: [{}, {}] })
    expect(prepare).toHaveBeenCalledOnce()
    const request = prepare.mock.calls[0]?.[0]
    expect(request).toMatchObject({ selectionId: 'map:second' })
    expect(request?.subject.namespace).toMatchObject({ state: 'truncated' })
    expect(request?.subject.namespace.entries).toHaveLength(2)
    expect(request?.subject.namespace.entries[0]).not.toHaveProperty('id')
    expect(original.namespaceRelease).toHaveBeenCalledOnce()
    expect(original.originalRelease).not.toHaveBeenCalled()
    expect(original.session.state()).toBe('live')

    await original.session.dispose()
    expect(original.originalRelease).toHaveBeenCalledOnce()
  })

  it.each([
    [
      'a live candidate capability',
      () => ({
        state: 'selection-required',
        candidates: [
          {
            candidateId: 'map:first',
            displayName: 'First map',
            open: () => undefined,
          },
        ],
        diagnostics: [],
      }),
    ],
    [
      'non-JSON diagnostic data',
      () => ({
        state: 'not-applicable',
        diagnostics: [
          {
            code: 'example/not-json',
            severity: 'warning',
            message: 'contains bigint',
            data: 1n,
          },
        ],
      }),
    ],
  ])('rejects %s from a preparation provider', async (_label, malformed) => {
    const original = await originalMapSession(workspaceFiles())
    const result = await coordinateMapPreviewAssetSession({
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'maps-preview-malformed', classes: [] },
      budgets: activationBudget,
      original: original.session,
      preparation: previewPreparation(async () => malformed() as never),
      maxCandidates: 8,
      maxSubjectEntries: 64,
      maxSubjectPages: 4,
      maxRoots: 4,
      maxDepth: 4,
      limits: coordinatorLimits,
    })

    expect(result.state).toBe('unresolved')
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'x3.host/map-preview-preparation-invalid' }),
    )
    expect(original.namespaceRelease).toHaveBeenCalledOnce()
    expect(original.session.state()).toBe('live')
    expect(original.originalRelease).not.toHaveBeenCalled()
    await original.session.dispose()
  })

  it('remaps a standalone subject namespace and transfers its exact-once lifetime on open', async () => {
    const archiveFiles = new Map(
      [...workspaceFiles()].map(([path, bytes]) => [path.slice(mapRoot.length + 1), bytes]),
    )
    const original = await originalMapSession(archiveFiles)
    const prepare = vi.fn<MapPreviewPreparationPort['prepare']>(async request => {
      expect(request.subject.namespace.state).toBe('complete')
      expect(request.subject.namespace.entries.map(item => item.path)).toContain('objects')
      return {
        state: 'prepared',
        plan: {
          schemaVersion: 1,
          workspace: previewWorkspaceInput(),
          resources: {
            schemaVersion: 1,
            strategy: 'subject-namespace',
            roots: [{ rootId: 'active', namespacePrefix: '' }],
          },
        },
        diagnostics: [],
      }
    })
    const result = await coordinateMapPreviewAssetSession({
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'maps-preview-subject-namespace', classes: [] },
      budgets: activationBudget,
      original: original.session,
      preparation: previewPreparation(prepare),
      maxCandidates: 8,
      maxSubjectEntries: 64,
      maxSubjectPages: 4,
      maxRoots: 4,
      maxDepth: 4,
      catalog,
      limits: coordinatorLimits,
    })

    expect(
      result.state,
      result.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
    ).toBe('opened')
    if (result.state !== 'opened') throw new Error('subject namespace preview did not open')
    expect(original.session.state()).toBe('live')
    expect(original.originalRelease).not.toHaveBeenCalled()

    await Promise.all([result.session.dispose(), result.session.dispose()])
    expect(original.session.state()).toBe('disposed')
    expect(original.namespaceRelease).toHaveBeenCalledTimes(2)
    expect(original.originalRelease).toHaveBeenCalledOnce()
    expect(original.entryRelease.mock.calls.length).toBeGreaterThan(0)
  })

  it('uses an explicit host resolver for external installation roots and releases it once', async () => {
    const original = await originalMapSession(new Map(), false)
    const preparation = previewPreparation(async () => ({
      state: 'prepared',
      plan: {
        schemaVersion: 1,
        workspace: previewWorkspaceInput(),
        resources: {
          schemaVersion: 1,
          strategy: 'host-resolved',
          resolverId: 'example/installed-game-resources',
          subjectNamespaceRoots: [],
          roots: [
            {
              rootId: 'active',
              locator: { kind: 'game-installation', installationId: 'stable' },
            },
          ],
        },
      },
      diagnostics: [],
    }))
    const resolverRelease = vi.fn(async () => undefined)
    const resolve = vi.fn<MapPreviewResourcePlanResolver['resolve']>(async () => ({
      state: 'resolved',
      origin: memoryOrigin(workspaceFiles()),
      revision: revisionId('provider-token:installed-resources-v1'),
      diagnostics: [],
      release: resolverRelease,
    }))
    const result = await coordinateMapPreviewAssetSession({
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'maps-preview-installed', classes: [] },
      budgets: activationBudget,
      original: original.session,
      preparation,
      resourcePlanResolver: { resolve },
      maxCandidates: 8,
      maxSubjectEntries: 64,
      maxSubjectPages: 4,
      maxRoots: 4,
      maxDepth: 4,
      catalog,
      limits: coordinatorLimits,
    })

    expect(
      result.state,
      result.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
    ).toBe('opened')
    if (result.state !== 'opened') throw new Error('host-resolved preview did not open')
    expect(resolve).toHaveBeenCalledOnce()
    expect(resolve.mock.calls[0]?.[0].plan).toMatchObject({
      resolverId: 'example/installed-game-resources',
      roots: [{ rootId: 'active' }],
    })
    expect(resolverRelease).not.toHaveBeenCalled()
    expect(original.originalRelease).not.toHaveBeenCalled()

    await result.session.dispose()
    await result.session.dispose()
    expect(resolverRelease).toHaveBeenCalledOnce()
    expect(original.originalRelease).toHaveBeenCalledOnce()
  })

  it('names a missing external resource resolver without consuming the original session', async () => {
    const original = await originalMapSession(new Map(), false)
    const result = await coordinateMapPreviewAssetSession({
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'maps-preview-missing-installed', classes: [] },
      budgets: activationBudget,
      original: original.session,
      preparation: previewPreparation(async () => ({
        state: 'prepared',
        plan: {
          schemaVersion: 1,
          workspace: previewWorkspaceInput(),
          resources: {
            schemaVersion: 1,
            strategy: 'host-resolved',
            resolverId: 'example/installed-game-resources',
            subjectNamespaceRoots: [],
            roots: [{ rootId: 'active', locator: { installationId: 'stable' } }],
          },
        },
        diagnostics: [],
      })),
      maxCandidates: 8,
      maxSubjectEntries: 64,
      maxSubjectPages: 4,
      maxRoots: 4,
      maxDepth: 4,
      limits: coordinatorLimits,
    })

    expect(result.state).toBe('unresolved')
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'x3.host/map-preview-resource-resolver-required' }),
    )
    expect(original.session.state()).toBe('live')
    expect(original.originalRelease).not.toHaveBeenCalled()
    await original.session.dispose()
  })

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
        `${mapRoot}/t3terrain.xml`,
        `${mapRoot}/t3syncpathinginfo`,
      ])
      expect(resources.provenance()).toHaveLength(5)
      expect(result.snapshot.semantic.complete).toBe(true)
      expect(result.snapshot.navigation).toMatchObject({ width: 2, height: 2, cellCount: 4 })
      expect(result.snapshot.terrainTransform).toMatchObject({
        schemaVersion: 1,
        snapshotId: result.snapshot.snapshotId,
        descriptorVersion: 113,
        source: {
          terrainDocumentPath: `${mapRoot}/t3terrain.xml`,
          heightDocumentPath: `${mapRoot}/t3heightmap`,
          rootElement: 'terrain',
          heightMapElement: 'heightMap',
          quantizationElement: 'vertData',
        },
        heightMap: {
          dim: [2, 2],
          offset: { x: 10, y: 20, z: 30 },
          scale: { x: 2, y: 3, z: 4 },
        },
        vertData: { quantizeBias: 1, quantizeScale: 0.5, standardHeight: 8 },
        bounds: {
          coordinateSpaceId: 'map-native',
          minimum: { x: 10, y: 20, z: 230 },
          maximum: { x: 12, y: 23, z: 237.5 },
        },
      })
      const info = await source.info()
      expect(source.contract).toBe('org.modkitx.blizzard.starcraft2/world-scene-source')
      expect(info.coordinateSpaces.map(item => item.id)).toEqual([
        'map-native',
        'uvw-canonical',
        'height-grid',
        'navigation-grid',
      ])
      expect(info.crossSpaceTransforms).toContainEqual(
        expect.objectContaining({ from: 'height-grid', to: 'map-native', state: 'known' }),
      )
      expect(info.terrainTransform).toEqual(result.snapshot.terrainTransform)
      expect(result.snapshot.uvwTransform).toBeUndefined()
      expect(info.uvwTransform).toBeUndefined()
      expect(info.crossSpaceTransforms).toContainEqual(
        expect.objectContaining({ from: 'map-native', to: 'uvw-canonical', state: 'unknown' }),
      )
      expect(result.snapshot.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'org.modkitx.blizzard.starcraft2/uvw-non-uniform-cell-size',
        }),
      )
      expect(info.bounds).toContainEqual(
        expect.objectContaining({
          facet: 'terrain',
          coordinateSpaceId: 'map-native',
          x: { state: 'known', minimum: 10, maximum: 12 },
          y: { state: 'known', minimum: 20, maximum: 23 },
          z: { state: 'known', minimum: 230, maximum: 237.5 },
        }),
      )
      const firstLayers = await source.page({ facet: 'layers', limit: 2 })
      expect(firstLayers.items).toHaveLength(2)
      expect(firstLayers.nextCursor).toEqual(expect.any(String))

      const terrainLayer = info.facets.find(item => item.facet === 'terrain')
      if (terrainLayer === undefined) throw new Error('terrain layer absent')
      expect(terrainLayer).toMatchObject({ state: 'available', itemCount: 4, lods: ['exact'] })
      const terrainSummary = result.snapshot.semantic.terrain
      if (terrainSummary === undefined) throw new Error('terrain summary absent')
      const malformedWorld = createCandidateWorldSceneLease(
        Object.freeze({
          ...result.snapshot,
          semantic: Object.freeze({
            ...result.snapshot.semantic,
            terrain: Object.freeze({
              ...terrainSummary,
              samples: Object.freeze(
                terrainSummary.samples.map((sample, index) =>
                  index === terrainSummary.samples.length - 1
                    ? Object.freeze({ ...sample, x: 0, y: 0 })
                    : sample,
                ),
              ),
            }),
          }),
        }),
        [],
        2,
      )
      try {
        expect((await malformedWorld.value.info()).facets).toContainEqual(
          expect.objectContaining({
            facet: 'terrain',
            state: 'partial',
            lods: ['summary', 'sampled'],
          }),
        )
      } finally {
        await malformedWorld.release()
      }
      const terrainPage = await source.page({
        facet: 'terrain',
        layerId: terrainLayer.layerId,
        lod: 'exact',
        limit: 1,
      })
      expect(terrainPage.items[0]).toMatchObject({
        facet: 'terrain',
        coordinateSpaceId: 'height-grid',
        mapNativePosition: { x: 10, y: 20, z: 230 },
      })
      if (terrainPage.nextCursor === undefined) throw new Error('terrain cursor absent')
      let queryFailure: unknown
      try {
        await source.page({
          facet: 'terrain',
          layerId: terrainLayer.layerId,
          lod: 'exact',
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
          lod: 'exact',
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
      await expect(
        source.page(
          { facet: 'terrain', layerId: terrainLayer.layerId, lod: 'exact', limit: 1 },
          cancelled.signal,
        ),
      ).rejects.toThrow()
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
      limits: {
        ...limits,
        maxRequirements: 8,
        maxTerrainSamples: 3,
        maxPageSize: 2,
        maxDiagnostics: 32,
      },
    })
    expect(result.state).toBe('resolved')
    if (result.state === 'resolved') {
      expect(result.snapshot.unresolvedRequirementIds).toEqual(['map-navigation'])
      expect(result.snapshot.terrainTransform).toBeUndefined()
      const sparseInfo = await result.world.value.info()
      expect(sparseInfo.terrainTransform).toBeUndefined()
      expect(sparseInfo.crossSpaceTransforms).toContainEqual(
        expect.objectContaining({ from: 'height-grid', to: 'map-native', state: 'unknown' }),
      )
      expect(sparseInfo.facets).toContainEqual(
        expect.objectContaining({ facet: 'navigation', state: 'unavailable' }),
      )
      const sparseTerrain = sparseInfo.facets.find(item => item.facet === 'terrain')
      expect(sparseTerrain).toMatchObject({
        state: 'partial',
        itemCount: 4,
        lods: ['summary', 'sampled'],
      })
      if (sparseTerrain === undefined) throw new Error('sparse terrain layer absent')
      await expect(
        result.world.value.page({
          facet: 'terrain',
          layerId: sparseTerrain.layerId,
          lod: 'exact',
          limit: 2,
        }),
      ).resolves.toMatchObject({
        state: 'unsupported',
        items: [],
        reason: expect.stringContaining('sampled'),
      })
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

  it('rejects malformed or over-budget native terrain descriptors without partial transform facts', async () => {
    const malformed = [
      '<terrain version="113"><heightMap dim="2 2" offset="0 0 0" scale="1 1 1"/><heightMap dim="2 2" offset="0 0 0" scale="1 1 1"/></terrain>',
      '<terrain version="113"><heightMap dim="2 2" offset="0 0 0" scale="1 1 1" quantizeBias="1" quantizeScale="0.5" standardHeight="8"/></terrain>',
      '<terrain version="113"><heightMap dim="2 2" offset="0 0 0" scale="1 1 1"><vertData quantizeBias="1" quantizeScale="0.5" standardHeight="8"/><vertData quantizeBias="1" quantizeScale="0.5" standardHeight="8"/></heightMap></terrain>',
      '<terrain version="113"><heightMap dim="3 2" offset="0 0 0" scale="1 1 1"><vertData quantizeBias="1" quantizeScale="0.5" standardHeight="8"/></heightMap></terrain>',
      '<terrain version="113"><heightMap dim="2 2" offset="0 0 0" scale="1 0 1"><vertData quantizeBias="1" quantizeScale="0.5" standardHeight="8"/></heightMap></terrain>',
      '<terrain version="113"><heightMap dim="2 2" offset="0 0 0" scale="1 1 1"><vertData quantizeBias="1" quantizeScale="-0.5" standardHeight="8"/></heightMap></terrain>',
      '<!DOCTYPE terrain [<!ENTITY value "1">]><terrain version="113"><heightMap dim="2 2" offset="0 0 0" scale="1 1 1"><vertData quantizeBias="&value;" quantizeScale="0.5" standardHeight="8"/></heightMap></terrain>',
    ]
    for (const [index, xml] of malformed.entries()) {
      const files = new Map(workspaceFiles())
      files.set(`${mapRoot}/t3terrain.xml`, encoder.encode(xml))
      const resources = createResourceSession({
        origin: memoryOrigin(files),
        revision: revisionId(`provider-token:malformed-terrain-${String(index)}`),
      })
      const result = await analyzeResolvedMapWorkspace({
        services: { ...composition, serviceDefinitions: definitions },
        grant: { id: `maps-malformed-terrain-${String(index)}`, classes: [] },
        budgets: activationBudget,
        workspace: workspaceLock(),
        resources,
        catalog,
        limits: { ...limits, maxRequirements: 8, maxPageSize: 2, maxDiagnostics: 32 },
      })
      expect(result.state, `malformed descriptor ${String(index)}`).toBe('resolved')
      if (result.state === 'resolved') {
        expect(result.snapshot.complete).toBe(false)
        expect(result.snapshot.terrainTransform).toBeUndefined()
        expect(result.snapshot.diagnostics).toContainEqual(
          expect.objectContaining({
            code: 'org.modkitx.blizzard.starcraft2/map-document-invalid',
            path: `${mapRoot}/t3terrain.xml`,
          }),
        )
        const info = await result.world.value.info()
        expect(info.terrainTransform).toBeUndefined()
        expect(info.crossSpaceTransforms).toContainEqual(
          expect.objectContaining({ from: 'height-grid', to: 'map-native', state: 'unknown' }),
        )
        await result.release()
      }
      await resources.dispose()
    }

    const resources = createResourceSession({
      origin: memoryOrigin(workspaceFiles()),
      revision: revisionId('provider-token:terrain-xml-budget'),
    })
    const result = await analyzeResolvedMapWorkspace({
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'maps-terrain-xml-budget', classes: [] },
      budgets: activationBudget,
      workspace: workspaceLock(),
      resources,
      catalog,
      limits: {
        ...limits,
        maxRequirements: 8,
        maxDocumentBytes: terrainXml().byteLength - 1,
        maxPageSize: 2,
        maxDiagnostics: 32,
      },
    })
    expect(result.state).toBe('resolved')
    if (result.state === 'resolved') {
      expect(result.snapshot.unresolvedRequirementIds).toContain('map-terrain-native-parameters')
      expect(result.snapshot.terrainTransform).toBeUndefined()
      expect(result.diagnostics.map(item => item.code)).toContain(
        'x3.host/resolved-map-document-budget-exceeded',
      )
      await result.release()
    }
    await resources.dispose()
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
    changedFiles.set(`${mapRoot}/t3terrain.xml`, terrainXml(2))
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
    expect(
      contentA.snapshot.terrainTransform !== undefined &&
        'vertData' in contentA.snapshot.terrainTransform
        ? contentA.snapshot.terrainTransform.vertData.quantizeBias
        : undefined,
    ).toBe(1)
    expect(
      contentB.snapshot.terrainTransform !== undefined &&
        'vertData' in contentB.snapshot.terrainTransform
        ? contentB.snapshot.terrainTransform.vertData.quantizeBias
        : undefined,
    ).toBe(2)
    const contentCursor = await contentA.world.value.page({ facet: 'layers', limit: 1 })
    if (contentCursor.nextCursor === undefined) throw new Error('terrain-content cursor absent')
    await expect(
      contentB.world.value.page({
        facet: 'layers',
        cursor: contentCursor.nextCursor,
        limit: 1,
      }),
    ).rejects.toThrow(/stale/u)
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
        'map-terrain-native-parameters',
        'map-navigation',
      ])
      await bounded.release()
    }
    expect(chunks.get(`${mapRoot}/regions`)).toBe(2)
    expect(releases.get(`${mapRoot}/regions`)).toBe(1)
    expect(chunks.has(`${mapRoot}/t3heightmap`)).toBe(false)
    expect(chunks.has(`${mapRoot}/t3terrain.xml`)).toBe(false)
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
    for (const overBudget of [
      { maxTerrainCells: activationBudget.maxNodes + 1 },
      { maxTerrainSamples: activationBudget.maxNodes + 1 },
    ]) {
      await expect(
        analyzeResolvedMapWorkspace({
          services: { ...composition, serviceDefinitions: definitions },
          grant: { id: 'maps-terrain-node-budget', classes: [] },
          budgets: activationBudget,
          workspace: workspaceLock(),
          resources: budgetResources,
          catalog,
          limits: {
            ...limits,
            ...overBudget,
            maxRequirements: 8,
            maxPageSize: 2,
            maxDiagnostics: 32,
          },
        }),
      ).rejects.toThrow(/exceeds ResourceBudget\.maxNodes/u)
    }
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

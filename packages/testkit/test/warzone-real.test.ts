import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import {
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
  analyzeResolvedDataWorkspace,
  buildInventory,
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  createHostContributionContractRegistry,
  linkedExtensionInputs,
  linkedInProcessBackend,
  openMapPreviewAssetSession,
  openNestedSubject,
  openSubject,
  registerServiceDefinitionsOrThrow,
} from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'
import {
  drainModelProjection,
  materializeAndCompare,
  proves,
  unexplainedDifferences,
} from '@modkitx-x3/testkit'
import {
  createHostTopology,
  resolveModWorkspaceGraph,
  revisionId,
  type ArtifactByteSource,
  type ArtifactSource,
  type InputSearchScope,
  type Lease,
  type ModelSceneSource,
  type NamespaceEntrySource,
  type ResourceBudget,
  WORLD_SCENE_SOURCE_CONTRACT,
} from '@modkitx-x3/sdk'
import { inspectCandidateWorld } from '@modkitx-x3/ui/world'
import type {
  CompanionEnumerationOptions,
  CompanionOrigin,
} from '../../host/src/input-resolution.js'
import { createResourceSession } from '../../host/src/resource-session.js'
import { assessCandidateWorldUvwAdmission } from '../src/uvw-materialization.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const GAME_ID = 'org.modkitx/warzone-2100'
const MAP_ROOT = 'multiplay/maps/2c-highground'
const MAP_PATH = `${MAP_ROOT}/game.map`
const PIE_PATH = 'components/bodies/cybd_run.pie'
const MAP_DOCUMENT_PATHS = [
  MAP_PATH,
  `${MAP_ROOT}/droid.json`,
  `${MAP_ROOT}/struct.json`,
  `${MAP_ROOT}/feature.json`,
] as const
const DATA_DOCUMENT_PATHS = Object.freeze({
  base: ['stats/features.json'],
  mp: ['stats/templates.json', 'stats/structure.json'],
})
const ARCHIVE_DIGEST = 'd698475eaa7b3386c2465e5850e5609b0d524157280c7d659dc5f79cde6e5688'
const MAP_DIGEST = 'c03e17c13a837339a1b8066047385758539cdc14ef903d806fcf871d30409111'
const NATIVE_DIGEST = 'bc29f38775548ebf04d37fddf1d2750c4532721afdc9ccae32aebcc2f943c6a2'
const CANONICAL_DIGEST = '01a7ccb598ea62a8e6dd5f2d88cdfbdd5d19ee1e1fe77ba995c7374bd4d0a2f0'
const operatingSystem =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'

const { discoverWarzone2100Installations } = (await import(
  pathToFileURL(join(repoRoot, 'extensions', 'opensource', 'warzone-2100', 'src', 'provider.js'))
    .href
)) as {
  readonly discoverWarzone2100Installations: (request: {
    readonly gameId: string
    readonly maxCandidates: number
  }) => Promise<{
    readonly installations: readonly {
      readonly normalizedPath: string
      readonly evidence: readonly {
        readonly kind: string
        readonly found: boolean
        readonly path: string
      }[]
    }[]
  }>
}
const discovery = await discoverWarzone2100Installations({
  gameId: GAME_ID,
  maxCandidates: 128,
})
const installation = discovery.installations[0]
const mpPath = installation?.evidence.find(
  item => item.kind === 'warzone-mp-archive' && item.found,
)?.path
const basePath = installation?.evidence.find(
  item => item.kind === 'warzone-base-archive' && item.found,
)?.path

const budget: ResourceBudget = {
  maxInputBytes: 16_777_216n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 16_777_216,
  maxDiagnostics: 100,
}
const archiveBudget: ResourceBudget = {
  ...budget,
  maxInputBytes: 134_217_728n,
  maxScalarBytes: 134_217_728,
}

function bytesSource(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://warzone-live/${encodeURIComponent(name)}`
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: Object.freeze({ id: uri, uri }),
    revision: revisionId(`content-hash.sha256:${createHash('sha256').update(bytes).digest('hex')}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      signal?.throwIfAborted()
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream(range, signal) {
      signal?.throwIfAborted()
      const offset = Number(range?.offset ?? 0n)
      const length = Number(range?.length ?? BigInt(bytes.byteLength - offset))
      yield bytes.slice(offset, offset + length)
    },
  }
  return Object.freeze(source)
}

function resourceOrigin(
  files: ReadonlyMap<string, Uint8Array>,
  primaryLogicalId: string,
): CompanionOrigin {
  return Object.freeze({
    primaryLogicalId,
    caseSensitivity: 'sensitive',
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
      signal?.throwIfAborted()
      for (const [logicalId, bytes] of files) {
        if (logicalId.startsWith(options.prefix)) {
          yield Object.freeze({ logicalId, size: BigInt(bytes.byteLength) })
        }
      }
    },
    async open(logicalId: string, signal?: AbortSignal): Promise<Lease<ArtifactSource>> {
      signal?.throwIfAborted()
      const bytes = files.get(logicalId)
      if (bytes === undefined) throw new RangeError(`unknown Warzone map resource ${logicalId}`)
      return Object.freeze({
        value: bytesSource(bytes, logicalId),
        release: async () => undefined,
      })
    },
  })
}

function workspaceLock() {
  return resolveModWorkspaceGraph({
    workspaceId: 'warzone-live-workspace',
    gameId: GAME_ID,
    activeRootId: 'active',
    sources: [
      { sourceId: 'base-wz', kind: 'archive', location: basePath ?? 'absent:base.wz' },
      { sourceId: 'mp-wz', kind: 'archive', location: mpPath ?? 'absent:mp.wz' },
    ],
    roots: [
      {
        rootId: 'base',
        sourceId: 'base-wz',
        sourcePath: 'base',
        displayName: 'Warzone base data',
        kind: 'game-data',
        dependencies: [],
      },
      {
        rootId: 'mp',
        sourceId: 'mp-wz',
        sourcePath: 'mp',
        displayName: 'Warzone multiplayer data',
        kind: 'game-data',
        dependencies: [
          {
            targetRootId: 'base',
            ref: 'base.wz',
            required: true,
            provenance: 'implicit',
          },
        ],
      },
      {
        rootId: 'active',
        sourceId: 'mp-wz',
        sourcePath: MAP_ROOT,
        displayName: '2c-highground',
        kind: 'map',
        dependencies: [
          {
            targetRootId: 'mp',
            ref: 'mp.wz',
            required: true,
            provenance: 'implicit',
          },
        ],
      },
    ],
    maxRoots: 4,
    maxDepth: 4,
  })
}

describe('installed Warzone 2100 map to UVW vertical', () => {
  it.runIf(true)(
    'extracts 2c-highground through the archive codec and materializes all 4,608 cells',
    async () => {
      if (mpPath === undefined || basePath === undefined || installation === undefined) {
        throw new Error('Warzone installation discovery did not return base.wz and mp.wz')
      }
      console.info(`[warzone-live] root ${installation.normalizedPath}`)
      console.info(`[warzone-live] ${mpPath} -> ${MAP_PATH}`)
      const archiveBytes = await readFile(mpPath)
      expect(createHash('sha256').update(archiveBytes).digest('hex')).toBe(ARCHIVE_DIGEST)

      const archiveInputs = await Promise.all([
        loadExtensionDirectory(join(repoRoot, 'extensions', 'common', 'archives')),
        loadExtensionDirectory(join(repoRoot, 'extensions', 'opensource', 'warzone-2100')),
      ])
      const archiveInventory = await buildInventory(
        archiveInputs.map(archiveInput => ({
          ...archiveInput,
          execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
        })),
        createHostContributionContractRegistry(),
      )
      const archiveExecutionBackends = createExecutionBackendRegistry([
        TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
      ])
      const archive = await openSubject({
        inventory: archiveInventory,
        source: bytesSource(archiveBytes, 'mp.wz'),
        path: 'mp.wz',
        intent: 'full',
        target: { environment: 'node', operatingSystem, architecture: 'x64' },
        grant: { id: 'warzone-live-mp-wz', classes: ['read-source'] },
        executionBackends: archiveExecutionBackends,
        budget: archiveBudget,
      })
      if (archive.state !== 'opened') {
        throw new Error(`mp.wz did not open through the archive codec: ${archive.reason}`)
      }
      const mapDocuments = new Map<string, Uint8Array>()
      const dataDocuments = new Map<string, Uint8Array>()
      try {
        expect(archive.descriptor).toMatchObject({
          identity: { codecId: 'org.modkitx/warzone-wz', formatId: 'warzone-wz' },
        })
        const namespaceLease = await archive.session.dataSource(
          'common.view/namespace-entry-source',
          1,
        )
        try {
          const page = await (namespaceLease.value as NamespaceEntrySource).list(MAP_ROOT, {
            limit: 64,
          })
          for (const path of MAP_DOCUMENT_PATHS) {
            const entry = page.items.find(item => item.path === path)
            if (entry === undefined) throw new Error(`${path} is absent from installed mp.wz`)
            const extracted = await archive.session
              .operations()
              .invoke('extract-entry', { entryId: entry.id })
            if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') {
              throw new Error(`installed ${path} extraction did not return bytes`)
            }
            mapDocuments.set(path, extracted.output.value)
          }
          const statsPage = await (namespaceLease.value as NamespaceEntrySource).list('stats/', {
            limit: 1_024,
          })
          for (const path of DATA_DOCUMENT_PATHS.mp) {
            const entry = statsPage.items.find(item => item.path === path)
            if (entry === undefined) throw new Error(`${path} is absent from installed mp.wz`)
            const extracted = await archive.session
              .operations()
              .invoke('extract-entry', { entryId: entry.id })
            if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') {
              throw new Error(`installed ${path} extraction did not return bytes`)
            }
            dataDocuments.set(`mp/${path}`, extracted.output.value)
          }
        } finally {
          await namespaceLease.release()
        }
      } finally {
        await archive.session.dispose()
      }

      const baseBytes = await readFile(basePath)
      const baseArchive = await openSubject({
        inventory: archiveInventory,
        source: bytesSource(baseBytes, 'base.wz'),
        path: 'base.wz',
        intent: 'full',
        target: { environment: 'node', operatingSystem, architecture: 'x64' },
        grant: { id: 'warzone-live-base-wz', classes: ['read-source'] },
        executionBackends: archiveExecutionBackends,
        budget: archiveBudget,
      })
      if (baseArchive.state !== 'opened') {
        throw new Error(`base.wz did not open through the archive codec: ${baseArchive.reason}`)
      }
      let pieUvmArtifactDigest: string | undefined
      try {
        expect(baseArchive.descriptor).toMatchObject({
          identity: { codecId: 'org.modkitx/warzone-wz', formatId: 'warzone-wz' },
        })
        const namespaceLease = await baseArchive.session.dataSource(
          'common.view/namespace-entry-source',
          1,
        )
        try {
          const statsPage = await (namespaceLease.value as NamespaceEntrySource).list('stats/', {
            limit: 1_024,
          })
          for (const path of DATA_DOCUMENT_PATHS.base) {
            const entry = statsPage.items.find(item => item.path === path)
            if (entry === undefined) throw new Error(`${path} is absent from installed base.wz`)
            const extracted = await baseArchive.session
              .operations()
              .invoke('extract-entry', { entryId: entry.id })
            if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') {
              throw new Error(`installed ${path} extraction did not return bytes`)
            }
            dataDocuments.set(`base/${path}`, extracted.output.value)
          }
          const piePage = await (namespaceLease.value as NamespaceEntrySource).list(
            'components/bodies/',
            { limit: 1_024 },
          )
          const pieEntry = piePage.items.find(item => item.path === PIE_PATH)
          if (pieEntry === undefined)
            throw new Error(`${PIE_PATH} is absent from installed base.wz`)
          const nestedPie = await openNestedSubject({
            parent: baseArchive.session,
            entryId: pieEntry.id,
            inventory: archiveInventory,
            executionBackends: archiveExecutionBackends,
            target: { environment: 'node', operatingSystem, architecture: 'x64' },
            grant: { id: 'warzone-live-pie', classes: ['read-source'] },
            budget: archiveBudget,
          })
          if (nestedPie.result.state !== 'opened') {
            throw new Error(
              `installed PIE nested open failed: ${nestedPie.result.reason} ${JSON.stringify(nestedPie.result.diagnostics)}`,
            )
          }
          try {
            expect(nestedPie.result.selected.contributionId).toBe('org.modkitx/warzone-pie')
            const modelLease = await nestedPie.result.session.dataSource(
              'common.view/model-scene-source',
              1,
            )
            try {
              const model = modelLease.value as ModelSceneSource
              const info = await model.info()
              expect(info).toMatchObject({ nodes: 6, meshes: 6, primitives: 6 })
              const projection = await drainModelProjection(model, {
                maxBytes: budget.maxScalarBytes,
              })
              const verdict = await materializeAndCompare(repoRoot, projection, {
                assetId: `warzone/${PIE_PATH}`,
                sourceFormat: 'pie',
                subjectRevision: nestedPie.result.session.revision,
                assetClass: 'unit',
              })
              expect(verdict.byteStable).toBe(true)
              expect(unexplainedDifferences(verdict)).toEqual([])
              expect(verdict.receipt.lostFacetIds).toEqual([])
              pieUvmArtifactDigest = verdict.artifactDigest
            } finally {
              await modelLease.release()
            }
          } finally {
            await nestedPie.result.session.dispose()
          }
        } finally {
          await namespaceLease.release()
        }
      } finally {
        await baseArchive.session.dispose()
      }
      const gameMapBytes = mapDocuments.get(MAP_PATH)
      if (gameMapBytes === undefined) throw new Error('installed game.map bytes are absent')
      expect(gameMapBytes).toHaveLength(15_132)
      expect(createHash('sha256').update(gameMapBytes).digest('hex')).toBe(MAP_DIGEST)

      const { warzone2100 } = (await import(
        pathToFileURL(
          join(repoRoot, 'extensions', 'opensource', 'warzone-2100', 'src', 'linked.js'),
        ).href
      )) as {
        readonly warzone2100: Parameters<typeof linkedExtensionInputs>[0][number]
      }
      const linked = linkedExtensionInputs([warzone2100])
      const topology = createHostTopology({
        schemaVersion: 1,
        topologyId: 'org.modkitx.test/warzone-live',
        realms: [
          {
            schemaVersion: 1,
            realmId: 'org.modkitx.test/warzone-live',
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
            policy: { id: 'org.modkitx.test/warzone-live-policy', revision: '1' },
          },
        ],
        links: [],
      })
      const composition = await createHostComposition({
        topology,
        realmId: 'org.modkitx.test/warzone-live',
        extensions: linked.inputs,
        executionBackends: createExecutionBackendRegistry([linkedInProcessBackend(linked.modules)]),
      })
      const definitions = createBundledServiceDefinitionRegistry()
      await registerServiceDefinitionsOrThrow(composition.inventory, definitions)
      const dataNamespaces = new Map([
        ['base/stats/features.json', 'warzone.features'],
        ['mp/stats/templates.json', 'warzone.templates'],
        ['mp/stats/structure.json', 'warzone.structures'],
      ])
      const dataQueries = [...dataDocuments.entries()].flatMap(([path, bytes]) => {
        const parsed = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        ) as Record<string, unknown>
        const namespace = dataNamespaces.get(path)
        if (namespace === undefined) throw new Error(`no catalog namespace for ${path}`)
        return Object.keys(parsed).map(entityId => ({ namespace, entityId }))
      })
      expect(dataQueries).toHaveLength(549)
      const workspaceDocuments = new Map([...dataDocuments, ...mapDocuments])
      const workspaceRevision = createHash('sha256')
      for (const [path, bytes] of [...workspaceDocuments.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      )) {
        workspaceRevision.update(path)
        workspaceRevision.update(bytes)
      }
      const resources = createResourceSession({
        origin: resourceOrigin(workspaceDocuments, MAP_ROOT),
        revision: revisionId(`content-hash.sha256:${workspaceRevision.digest('hex')}`),
      })
      const workspace = workspaceLock()
      const dataResult = await analyzeResolvedDataWorkspace({
        services: { ...composition, serviceDefinitions: definitions },
        grant: { id: 'warzone-live-data', classes: [] },
        budgets: budget,
        workspace,
        resources,
        locales: ['enUS'],
        queries: dataQueries,
        limits: {
          maxRequirements: 64,
          maxDocumentBytes: 4_194_304,
          maxTextBytes: 8_388_608,
          maxEntities: 10_000,
          maxDepth: 32,
          maxPageSize: 1_000,
        },
      })
      expect(
        dataResult.state,
        dataResult.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
      ).toBe('resolved')
      if (dataResult.state !== 'resolved') {
        await resources.dispose()
        throw new Error('installed Warzone data did not resolve')
      }
      expect(dataResult.snapshot.definitions).toHaveLength(549)
      expect(dataResult.snapshot.entities).toHaveLength(549)
      expect(dataResult.snapshot.namespaces).toEqual([
        { namespace: 'warzone.features', entityCount: 104 },
        { namespace: 'warzone.structures', entityCount: 165 },
        { namespace: 'warzone.templates', entityCount: 280 },
      ])
      expect(await dataResult.facets.definitions.value.shape()).toMatchObject({
        rows: 549,
        columns: 6,
      })
      expect((await dataResult.facets.relations.value.summary()).totalEdges).toBeGreaterThan(0)
      const dataSnapshot = dataResult.snapshot
      const dataResourceRevision = resources.revision
      await dataResult.release()
      const result = await openMapPreviewAssetSession({
        services: { ...composition, serviceDefinitions: definitions },
        grant: { id: 'warzone-live-map', classes: [] },
        budgets: budget,
        workspace,
        resources,
        subjectUri: `warzone-map:${MAP_ROOT}`,
        catalog: dataSnapshot,
        limits: {
          maxRequirements: 8,
          maxDocumentBytes: 1_000_000,
          maxTotalBytes: 2_000_000,
          maxObjects: 100_000,
          maxRegions: 10_000,
          maxTerrainCells: 65_536,
          maxTerrainSamples: 65_536,
          maxDepth: 32,
          maxPageSize: 1_024,
          maxDiagnostics: 100,
        },
      })
      expect(
        result.state,
        result.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
      ).toBe('opened')
      if (result.state !== 'opened') throw new Error('installed Warzone map did not resolve')
      const worldLease = await result.session.dataSource(WORLD_SCENE_SOURCE_CONTRACT, 1)
      const world = worldLease.value
      try {
        expect(result.snapshot.semantic.terrain).toMatchObject({
          version: 10,
          width: 48,
          height: 96,
          cellCount: 4_608,
          minimumHeightBase: 0,
          maximumHeightBase: 510,
          trailingBytes: 1_168,
        })
        expect(result.snapshot.semantic.objects).toHaveLength(177)
        expect(result.snapshot.semantic.objects.filter(item => item.kind === 'unit')).toHaveLength(
          13,
        )
        expect(
          result.snapshot.semantic.objects.filter(item => item.kind === 'structure'),
        ).toHaveLength(113)
        expect(
          result.snapshot.semantic.objects.filter(item => item.kind === 'feature'),
        ).toHaveLength(51)
        expect(result.snapshot.semantic.catalogQueries).toHaveLength(30)
        expect(result.snapshot.semantic.resolvedCatalogObjects).toBe(177)
        expect(
          result.snapshot.semantic.objects.every(item => item.catalog?.entity !== undefined),
        ).toBe(true)
        expect(result.snapshot.terrainTransform).toMatchObject({
          bounds: {
            minimum: { x: 0, y: 0, z: 0 },
            maximum: { x: 6_016, y: 12_160, z: 510 },
          },
        })
        expect(result.snapshot.uvwTransform).toMatchObject({
          heightfield: {
            columns: 48,
            rows: 96,
            cellSize: 128,
            origin: [0, 0, -12_160],
          },
          proof: {
            nativeTupleDigest: `sha256:${NATIVE_DIGEST}`,
            canonicalTupleDigest: `sha256:${CANONICAL_DIGEST}`,
          },
        })
        const worldInfo = await world.info()
        expect(worldInfo).toMatchObject({
          contract: WORLD_SCENE_SOURCE_CONTRACT,
          maturity: 'publisher-candidate',
          mapId: MAP_ROOT,
        })
        expect(worldInfo.facets).toContainEqual(
          expect.objectContaining({ facet: 'objects', state: 'partial', itemCount: 177 }),
        )
        expect(worldInfo.bounds).toContainEqual(
          expect.objectContaining({
            facet: 'objects',
            z: expect.objectContaining({
              state: 'unknown',
              reason: expect.stringContaining('elevation'),
            }),
          }),
        )
        expect(result.snapshot.gameId).toBe(dataSnapshot.gameId)
        expect(result.snapshot.workspaceId).toBe(dataSnapshot.workspaceId)
        expect(result.snapshot.gameId).toBe(workspace.gameId)
        expect(result.snapshot.workspaceId).toBe(workspace.workspaceId)
        expect(resources.revision).toBe(dataResourceRevision)
        expect(worldInfo.provenance.length).toBeGreaterThan(0)
        for (const record of worldInfo.provenance) {
          expect(resources.provenance()).toContainEqual(record)
        }
        const definitionRefs = result.snapshot.semantic.objects.flatMap(object =>
          object.catalog === undefined ? [] : [object.catalog],
        )
        expect(definitionRefs).toHaveLength(177)
        const unresolvedDefinitionRefs = definitionRefs.filter(
          binding => binding.entity === undefined,
        )
        const objectFacet = worldInfo.facets.find(item => item.facet === 'objects')
        expect(unresolvedDefinitionRefs).toEqual([])
        expect(objectFacet).toMatchObject({ state: 'partial' })
        expect(objectFacet?.reason).toMatch(/elevation|height|two-dimensional/iu)
        const resourceFacet = worldInfo.facets.find(item => item.facet === 'resources')
        if (resourceFacet === undefined) throw new Error('Warzone world resources facet is absent')
        const resourcePage = await world.page({
          facet: 'resources',
          layerId: resourceFacet.layerId,
          limit: 1_024,
        })
        expect(resourcePage.nextCursor).toBeUndefined()
        const resourceItems = resourcePage.items.filter(item => item.facet === 'resources')
        expect(resourceItems.every(item => item.resolved)).toBe(true)
        expect(new Set(resourceItems.flatMap(item => item.objectIds)).size).toBe(177)
        proves({
          capabilityId: 'vertical/warzone-2100/neutral-definitions-world',
          operation: 'inspect',
          note: 'installed Warzone definitions and world share one game, workspace and content revision; all 177 object definition references resolve and 2D elevation remains explicitly partial',
        })
        proves({
          capabilityId: 'vertical/warzone-2100/neutral-definitions-world',
          operation: 'read',
          note: 'the live definition and world facets are joined without claiming a portable UVD or production UVW artifact',
        })
        const viewer = await inspectCandidateWorld(world, {
          maxLayers: 8,
          maxItemsPerLayer: 1_024,
        })
        expect(viewer.layers.find(item => item.layer.kind === 'terrain')?.page.items).toHaveLength(
          1_024,
        )
        expect(
          viewer.layers.find(item => item.layer.kind === 'terrain')?.page.nextCursor,
        ).toBeDefined()
        expect(viewer.layers.find(item => item.layer.kind === 'objects')?.page.items).toHaveLength(
          177,
        )
        const first = await assessCandidateWorldUvwAdmission(world, {
          maxPageItems: 1_024,
          maxTerrainItems: 65_536,
        })
        expect(first.state).toBe('materialized-candidate')
        if (first.state !== 'materialized-candidate') {
          throw new Error(`installed Warzone UVW refused: ${first.refusalCodes.join(',')}`)
        }
        expect(first).toMatchObject({
          observedTerrainItems: 4_608,
          serialized: true,
          receipt: { canonicalTupleDigest: `sha256:${CANONICAL_DIGEST}` },
        })
        const repeated = await assessCandidateWorldUvwAdmission(world, {
          maxPageItems: 257,
          maxTerrainItems: 65_536,
        })
        expect(repeated.state).toBe('materialized-candidate')
        if (repeated.state !== 'materialized-candidate') {
          throw new Error(
            `repeat installed Warzone UVW refused: ${repeated.refusalCodes.join(',')}`,
          )
        }
        expect(repeated.artifactBytes).toEqual(first.artifactBytes)
        expect(pieUvmArtifactDigest).toMatch(/^sha256:[0-9a-f]{64}$/u)
        proves({
          capabilityId: 'vertical/warzone-2100/native-to-uv',
          operation: 'read',
          note: 'one installed Warzone workflow proves PIE live projection with receipt-complete UVM reopen and 2c-highground exact candidate UVW materialization without making UVW a production writer',
        })
        proves({
          contributionId: 'org.modkitx/warzone-wz',
          operation: 'inspect',
          note: 'installed Warzone 4.7.0 mp.wz opens through the final game-owned WZ codec',
        })
        proves({
          contributionId: 'org.modkitx/warzone-wz',
          operation: 'read',
          note: 'installed mp.wz extracts the pinned Deflate-compressed game.map entry byte-exactly',
        })
        proves({
          contributionId: 'org.modkitx.opensource/warzone2100-map-semantic',
          operation: 'materialize',
          note: 'installed 2c-highground materializes all 4,608 cells to byte-stable UVW candidate bytes',
        })
        console.info(
          `[warzone-live] UVW ${first.observedTerrainItems} cells, ${first.serializedBytes} bytes, ${first.receipt.canonicalTupleDigest}`,
        )
      } finally {
        await worldLease.release()
        await result.session.dispose()
      }
    },
    120_000,
  )
})

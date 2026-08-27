import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import {
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
  analyzeResolvedMapWorkspace,
  buildInventory,
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  createHostContributionContractRegistry,
  linkedExtensionInputs,
  linkedInProcessBackend,
  openSubject,
  registerServiceDefinitionsOrThrow,
} from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'
import { proves } from '@modkitx-x3/testkit'
import {
  createHostTopology,
  resolveModWorkspaceGraph,
  revisionId,
  type ArtifactByteSource,
  type ArtifactSource,
  type InputSearchScope,
  type Lease,
  type NamespaceEntrySource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
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

const budget: ResourceBudget = {
  maxInputBytes: 16_777_216n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 16_777_216,
  maxDiagnostics: 100,
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

function mapOrigin(bytes: Uint8Array): CompanionOrigin {
  const source = bytesSource(bytes, MAP_PATH)
  return Object.freeze({
    primaryLogicalId: MAP_ROOT,
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
      if (MAP_PATH.startsWith(options.prefix)) {
        yield Object.freeze({ logicalId: MAP_PATH, size: BigInt(bytes.byteLength) })
      }
    },
    async open(logicalId: string, signal?: AbortSignal): Promise<Lease<ArtifactSource>> {
      signal?.throwIfAborted()
      if (logicalId !== MAP_PATH) throw new RangeError(`unknown Warzone map resource ${logicalId}`)
      return Object.freeze({ value: source, release: async () => undefined })
    },
  })
}

function workspaceLock() {
  return resolveModWorkspaceGraph({
    workspaceId: 'warzone-live-workspace',
    gameId: GAME_ID,
    activeRootId: 'active',
    sources: [{ sourceId: 'mp-wz', kind: 'archive', location: mpPath ?? 'absent:mp.wz' }],
    roots: [
      {
        rootId: 'active',
        sourceId: 'mp-wz',
        sourcePath: MAP_ROOT,
        displayName: '2c-highground',
        kind: 'map',
        dependencies: [],
      },
    ],
    maxRoots: 4,
    maxDepth: 4,
  })
}

describe('installed Warzone 2100 map to UVW vertical', () => {
  it.skipIf(mpPath === undefined || !existsSync(mpPath))(
    'extracts 2c-highground through the archive codec and materializes all 4,608 cells',
    async () => {
      if (mpPath === undefined || installation === undefined) {
        throw new Error('Warzone installation discovery did not return mp.wz')
      }
      console.info(`[warzone-live] root ${installation.normalizedPath}`)
      console.info(`[warzone-live] ${mpPath} -> ${MAP_PATH}`)
      const archiveBytes = await readFile(mpPath)
      expect(createHash('sha256').update(archiveBytes).digest('hex')).toBe(ARCHIVE_DIGEST)

      const archiveInput = await loadExtensionDirectory(
        join(repoRoot, 'extensions', 'common', 'archives'),
      )
      const archiveInventory = await buildInventory(
        [
          {
            ...archiveInput,
            execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
          },
        ],
        createHostContributionContractRegistry(),
      )
      const archive = await openSubject({
        inventory: archiveInventory,
        source: bytesSource(archiveBytes, 'mp.wz'),
        path: 'mp.wz',
        intent: 'full',
        target: { environment: 'node', operatingSystem, architecture: 'x64' },
        grant: { id: 'warzone-live-mp-wz', classes: ['read-source'] },
        executionBackends: createExecutionBackendRegistry([TRUSTED_IN_PROCESS_EXECUTION_BACKEND]),
        budget,
      })
      if (archive.state !== 'opened') {
        throw new Error(`mp.wz did not open through the archive codec: ${archive.reason}`)
      }
      let gameMapBytes
      try {
        expect(archive.descriptor).toMatchObject({ identity: { formatId: 'zip' } })
        const namespaceLease = await archive.session.dataSource(
          'common.view/namespace-entry-source',
          1,
        )
        try {
          const page = await (namespaceLease.value as NamespaceEntrySource).list(MAP_PATH, {
            limit: 16,
          })
          const entry = page.items.find(item => item.path === MAP_PATH)
          if (entry === undefined) throw new Error(`${MAP_PATH} is absent from installed mp.wz`)
          const extracted = await archive.session
            .operations()
            .invoke('extract-entry', { entryId: entry.id })
          if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') {
            throw new Error('installed game.map extraction did not return bytes')
          }
          gameMapBytes = extracted.output.value
        } finally {
          await namespaceLease.release()
        }
      } finally {
        await archive.session.dispose()
      }
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
      const resources = createResourceSession({
        origin: mapOrigin(gameMapBytes),
        revision: revisionId(`content-hash.sha256:${MAP_DIGEST}`),
      })
      const result = await analyzeResolvedMapWorkspace({
        services: { ...composition, serviceDefinitions: definitions },
        grant: { id: 'warzone-live-map', classes: [] },
        budgets: budget,
        workspace: workspaceLock(),
        resources,
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
      ).toBe('resolved')
      if (result.state !== 'resolved') throw new Error('installed Warzone map did not resolve')
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
        const first = await assessCandidateWorldUvwAdmission(result.world.value, {
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
        const repeated = await assessCandidateWorldUvwAdmission(result.world.value, {
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
        proves({
          contributionId: 'org.modkitx.opensource/warzone2100-map-semantic',
          operation: 'materialize',
          note: 'installed 2c-highground materializes all 4,608 cells to byte-stable UVW candidate bytes',
        })
        console.info(
          `[warzone-live] UVW ${first.observedTerrainItems} cells, ${first.serializedBytes} bytes, ${first.receipt.canonicalTupleDigest}`,
        )
      } finally {
        await result.release()
        await resources.dispose()
      }
    },
    120_000,
  )
})

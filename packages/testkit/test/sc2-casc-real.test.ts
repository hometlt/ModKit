import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'
import {
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
  artifactNamespaceSourceFromVfsMount,
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openSubject,
} from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'
import {
  revisionId,
  type ArtifactByteSource,
  type DataCatalogAnalysis,
  type GameInstallationDiscovery,
  type MapSemanticAnalysis,
  type ModWorkspaceComposition,
  type NamespaceEntrySource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const sc2Override = process.env.MODKITX_SC2_ROOT?.trim()
const sc2Root = sc2Override ? sc2Override : 'C:\\Apps\\StarCraft II'
const buildInfoPath = join(sc2Root, '.build.info')
const m3Path =
  'campaigns/liberty.sc2campaign/base.sc2assets/assets/campaign/terran/artifact1/artifact1.m3'
const ddsPath = 'campaigns/liberty.sc2campaign/base.sc2assets/assets/textures/alpha2.dds'
const mpqPath =
  'mods/liberty.sc2mod/base.sc2data/battlenetcache/fc2161abf876306f1a0467cfacf5e513cba4281fdc13532b440e8c8abb8835ac.s2ma'
const mapRoot = 'campaigns/liberty.sc2campaign/base.sc2maps/maps/campaign/tarcade.sc2map'
const { discoverStarcraft2Installations } = (await import(
  pathToFileURL(join(repoRoot, 'extensions', 'blizzard', 'starcraft2-game', 'src', 'provider.js'))
    .href
)) as { readonly discoverStarcraft2Installations: GameInstallationDiscovery['discover'] }
const { composeStarcraft2Workspace } = (await import(
  pathToFileURL(
    join(repoRoot, 'extensions', 'blizzard', 'starcraft2-game', 'src', 'workspace-provider.js'),
  ).href
)) as { readonly composeStarcraft2Workspace: ModWorkspaceComposition['compose'] }
const { analyzeStarcraft2Data } = (await import(
  pathToFileURL(
    join(repoRoot, 'extensions', 'blizzard', 'starcraft2-game', 'src', 'data-provider.js'),
  ).href
)) as { readonly analyzeStarcraft2Data: DataCatalogAnalysis['analyze'] }
const { openStarcraft2Map } = (await import(
  pathToFileURL(
    join(repoRoot, 'extensions', 'blizzard', 'starcraft2-game', 'src', 'map-provider.js'),
  ).href
)) as { readonly openStarcraft2Map: MapSemanticAnalysis['open'] }

const budget: ResourceBudget = {
  maxInputBytes: 268_435_456n,
  maxDepth: 128,
  maxNodes: 750_000,
  maxScalarBytes: 134_217_728,
  maxDiagnostics: 100,
}

function memorySource(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://sc2-casc/${encodeURIComponent(name)}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(
      `provider-token:${encodeURIComponent(`sc2-casc:${name}:${bytes.byteLength}`)}`,
    ),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream(range, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const offset = Number(range?.offset ?? 0n)
      const length = Number(range?.length ?? BigInt(bytes.byteLength - offset))
      yield bytes.slice(offset, offset + length)
    },
  }
}

describe('installed StarCraft II CASC product path', () => {
  it.skipIf(!existsSync(buildInfoPath))(
    'discovers the install, resolves dependencies and opens a real semantic map through CASC',
    async () => {
      const before = statSync(buildInfoPath)
      const discovered = await discoverStarcraft2Installations({
        gameId: 'org.modkitx/starcraft-2',
        configuredPaths: [sc2Root],
        maxCandidates: 16,
      })
      expect(
        discovered.installations.some(
          installation =>
            installation.normalizedPath.toLowerCase() ===
            sc2Root.replace(/\\/gu, '/').replace(/\/+$/gu, '').toLowerCase(),
        ),
      ).toBe(true)
      const directories = [
        ['mk2', 'blizzard-casc'],
        ['blizzard', 'models'],
        ['mk2', 'blizzard-mpq'],
        ['mk2', 'common-images'],
      ]
      const inputs = await Promise.all(
        directories.map(parts => loadExtensionDirectory(join(repoRoot, 'extensions', ...parts))),
      )
      const inventory = await buildInventory(
        inputs.map(input => ({
          ...input,
          execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
        })),
        createHostContributionContractRegistry(),
      )
      const executionBackends = createExecutionBackendRegistry([
        TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
      ])
      const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
      const mount = await vfs.openMount(pathToFileURL(sc2Root).href)
      const casc = await openSubject({
        inventory,
        source: artifactNamespaceSourceFromVfsMount(mount),
        path: 'StarCraft II',
        intent: 'full',
        target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
        grant: { id: 'sc2-casc-real', classes: ['read-source'] },
        executionBackends,
        budget,
      })
      try {
        if (casc.state !== 'opened') {
          throw new Error(
            `CASC open failed: ${casc.reason} ${JSON.stringify({ candidates: casc.candidates, diagnostics: casc.diagnostics })}`,
          )
        }
        expect(casc.selected).toMatchObject({
          contributionId: 'org.modkitx/casc',
          confidence: 0.99,
        })
        expect(casc.descriptor).toMatchObject({
          identity: { formatId: 'casc' },
          constraints: { readOnly: true, randomAccess: false },
        })

        const namespaceLease = await casc.session.dataSource(
          'common.view/namespace-entry-source',
          1,
        )
        try {
          const namespace = namespaceLease.value as NamespaceEntrySource
          const first = await namespace.list('campaigns/liberty.sc2campaign/', { limit: 1 })
          expect(first.items).toHaveLength(1)
          expect(first.nextCursor).toBeDefined()
          if (first.nextCursor === undefined) throw new Error('CASC first page had no cursor')
          const second = await namespace.list('campaigns/liberty.sc2campaign/', {
            cursor: first.nextCursor,
            limit: 1,
          })
          expect(second.items).toHaveLength(1)
          expect(second.items[0]?.id).not.toBe(first.items[0]?.id)

          const stockRoots = ['Core.SC2Mod', 'Liberty.SC2Mod', 'Swarm.SC2Mod', 'Void.SC2Mod']
          for (const name of stockRoots) {
            const page = await namespace.list(`mods/${name.toLowerCase()}/`, { limit: 1 })
            expect(page.items, `${name} has no entry in the installed CASC namespace`).toHaveLength(
              1,
            )
          }
          const workspace = await composeStarcraft2Workspace({
            workspaceId: 'installed-liberty-tarcade',
            gameId: 'org.modkitx/starcraft-2',
            activeRootId: 'retail:tarcade.sc2map',
            sources: [
              {
                sourceId: 'retail-casc',
                kind: 'casc',
                location: pathToFileURL(sc2Root).href,
                fingerprint: `${before.size}:${before.mtimeMs}`,
              },
            ],
            roots: [
              ...stockRoots.map(name => ({
                rootId: `retail:${name.toLowerCase()}`,
                sourceId: 'retail-casc',
                sourcePath: `mods/${name.toLowerCase()}`,
                displayName: name,
                kind: 'mod',
                declaredDependencies: [],
              })),
              {
                rootId: 'retail:liberty.sc2campaign',
                sourceId: 'retail-casc',
                sourcePath: 'campaigns/liberty.sc2campaign',
                displayName: 'Liberty.SC2Campaign',
                kind: 'campaign',
                declaredDependencies: [],
              },
              {
                rootId: 'retail:tarcade.sc2map',
                sourceId: 'retail-casc',
                sourcePath: mapRoot,
                displayName: 'TArcade.SC2Map',
                kind: 'map',
                declaredDependencies: [{ ref: 'Liberty.SC2Campaign', required: true }],
              },
            ],
            maxRoots: 32,
            maxDepth: 16,
          })
          expect(workspace.complete).toBe(true)
          expect(workspace.loadOrder.map(root => root.displayName)).toEqual([
            'Core.SC2Mod',
            'Liberty.SC2Mod',
            'Liberty.SC2Campaign',
            'TArcade.SC2Map',
          ])

          const extractCascBytes = async (path: string): Promise<Uint8Array> => {
            const extracted = await casc.session
              .operations()
              .invoke('extract-entry', { entryId: path })
            if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') {
              throw new Error(`CASC extraction failed for ${path}`)
            }
            return extracted.output.value
          }

          const mapDocuments = await Promise.all(
            ['objects', 'regions', 't3heightmap'].map(async name => {
              const path = `${mapRoot}/${name}`
              return { path, bytes: await extractCascBytes(path) }
            }),
          )
          const mapLimits = {
            maxDocuments: 8,
            maxDocumentBytes: 1_000_000,
            maxTotalBytes: 4_000_000,
            maxObjects: 10_000,
            maxRegions: 1_000,
            maxTerrainCells: 100_000,
            maxTerrainSamples: 32,
            maxDepth: 64,
          } as const
          const preliminaryMap = await openStarcraft2Map({
            workspaceId: workspace.workspaceId,
            gameId: workspace.gameId,
            mapId: mapRoot,
            documents: mapDocuments,
            ...mapLimits,
          })
          expect(preliminaryMap.complete).toBe(false)
          expect(preliminaryMap.catalogQueries).toContainEqual({
            namespace: 'Unit',
            entityId: 'Marine',
          })

          const catalogDocuments = (
            await Promise.all(
              workspace.loadOrder.map(async root => {
                const path = `${root.sourcePath}/base.sc2data/gamedata/unitdata.xml`
                const page = await namespace.list(path, { limit: 1 })
                if (page.items[0]?.path !== path) return undefined
                return {
                  rootId: root.rootId,
                  path,
                  text: new TextDecoder().decode(await extractCascBytes(path)),
                }
              }),
            )
          ).filter(document => document !== undefined)
          const catalog = await analyzeStarcraft2Data({
            workspaceId: workspace.workspaceId,
            gameId: workspace.gameId,
            documents: catalogDocuments,
            queries: preliminaryMap.catalogQueries,
            maxDocuments: 16,
            maxTextBytes: 16_777_216,
            maxEntities: 100_000,
            maxDepth: 128,
          })
          expect(catalog.entityCount).toBeGreaterThan(100)
          const marine = catalog.entities.find(entity => entity.entityId === 'Marine')
          expect(marine).toMatchObject({
            namespace: 'Unit',
            typeId: 'CUnit',
            entityId: 'Marine',
          })
          expect(Object.keys(marine?.fields ?? {})).toEqual(
            expect.arrayContaining(['LifeMax', 'Race']),
          )
          expect(marine?.sources.length).toBeGreaterThan(0)

          const semanticMap = await openStarcraft2Map({
            workspaceId: workspace.workspaceId,
            gameId: workspace.gameId,
            mapId: mapRoot,
            documents: mapDocuments,
            catalog,
            ...mapLimits,
          })
          expect(
            semanticMap.complete,
            semanticMap.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
          ).toBe(true)
          expect(semanticMap.terrain).toMatchObject({
            version: 101,
            width: 257,
            height: 257,
            cellCount: 66_049,
          })
          expect(semanticMap.regions).toContainEqual(
            expect.objectContaining({ regionId: 1, name: 'Cheer' }),
          )
          const placedMarine = semanticMap.objects.find(
            object => object.kind === 'unit' && object.typeId === 'Marine',
          )
          expect(placedMarine).toMatchObject({
            catalog: {
              ref: { namespace: 'Unit', entityId: 'Marine' },
              entity: { typeId: 'CUnit', fields: { Race: 'Terr' } },
            },
          })
          expect(semanticMap.resolvedCatalogObjects).toBe(
            semanticMap.objects.filter(object => object.kind === 'unit').length,
          )

          const cancelled = new AbortController()
          cancelled.abort()
          await expect(namespace.list('', { limit: 1 }, cancelled.signal)).rejects.toMatchObject({
            name: 'AbortError',
          })
        } finally {
          await namespaceLease.release()
        }

        const reopen = async (path: string, expectedFormat: string): Promise<void> => {
          const extracted = await casc.session
            .operations()
            .invoke('extract-entry', { entryId: path })
          if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') {
            throw new Error(`CASC extraction failed for ${path}`)
          }
          const nested = await openSubject({
            inventory,
            source: memorySource(extracted.output.value, path),
            path,
            intent: 'full',
            target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
            grant: { id: `sc2-casc-nested-${expectedFormat}`, classes: ['read-source'] },
            executionBackends,
            budget,
          })
          if (nested.state !== 'opened') {
            throw new Error(
              `nested ${expectedFormat} open failed: ${nested.reason} ${JSON.stringify(nested.candidates)}`,
            )
          }
          try {
            expect(nested.descriptor).toMatchObject({ identity: { formatId: expectedFormat } })
            if (expectedFormat === 'mpq') {
              const lease = await nested.session.dataSource('common.view/namespace-entry-source', 1)
              try {
                expect(
                  (await (lease.value as NamespaceEntrySource).list('', { limit: 1 })).items,
                ).not.toHaveLength(0)
              } finally {
                await lease.release()
              }
            }
          } finally {
            await nested.session.dispose()
          }
        }

        await reopen(m3Path, 'm3')
        await reopen(ddsPath, 'dds')
        await reopen(mpqPath, 'mpq')
      } finally {
        if (casc.state === 'opened') await casc.session.dispose()
        await vfs.dispose()
      }
      const after = statSync(buildInfoPath)
      expect({ size: after.size, mtimeMs: after.mtimeMs }).toEqual({
        size: before.size,
        mtimeMs: before.mtimeMs,
      })
    },
    120_000,
  )
})

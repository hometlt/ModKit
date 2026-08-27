import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'
import {
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
  analyzeResolvedMapWorkspace,
  analyzeResolvedDataWorkspace,
  artifactNamespaceSourceFromVfsMount,
  buildInventory,
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openNestedSubject,
  openSubject,
  registerServiceDefinitionsOrThrow,
  resolveDataCatalogAnalysis,
  resolveGameInstallationDiscovery,
  resolveMapSemanticAnalysis,
  resolveModWorkspaceComposition,
} from '@modkitx-x3/host'
import { openRuntimeSession } from '@modkitx-x3/host/runtime'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'
import { proves } from '@modkitx-x3/testkit'
import {
  type ModelSceneSource,
  type NamespaceEntrySource,
  type RasterImageSource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import { inspectCandidateWorld } from '@modkitx-x3/ui/world'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'

import { assessCandidateWorldUvwAdmission } from '../src/uvw-materialization.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const sc2Override = process.env.MODKITX_SC2_ROOT?.trim()
const sc2Root = sc2Override ?? ''
const buildInfoPath = join(sc2Root, '.build.info')
const m3Path =
  'campaigns/liberty.sc2campaign/base.sc2assets/assets/campaign/terran/artifact1/artifact1.m3'
const ddsPath = 'campaigns/liberty.sc2campaign/base.sc2assets/assets/textures/alpha2.dds'
const mpqPath =
  'mods/liberty.sc2mod/base.sc2data/battlenetcache/fc2161abf876306f1a0467cfacf5e513cba4281fdc13532b440e8c8abb8835ac.s2ma'
const mapRoot = 'campaigns/liberty.sc2campaign/base.sc2maps/maps/campaign/tarcade.sc2map'

const budget: ResourceBudget = {
  maxInputBytes: 268_435_456n,
  maxDepth: 128,
  maxNodes: 750_000,
  maxScalarBytes: 134_217_728,
  maxDiagnostics: 100,
}

describe('installed StarCraft II CASC product path', () => {
  it.skipIf(sc2Override === undefined)(
    'discovers the install, resolves dependencies and opens a real semantic map through CASC',
    async () => {
      if (!existsSync(buildInfoPath)) {
        throw new Error(
          `configured corpus MODKITX_SC2_ROOT does not contain the required .build.info sentinel: ${buildInfoPath}`,
        )
      }
      const before = statSync(buildInfoPath)
      const corpusDescriptor = Object.freeze({
        environment: 'MODKITX_SC2_ROOT',
        sentinel: '.build.info',
        size: before.size,
        modifiedMs: before.mtimeMs,
      })
      const directories = [
        ['blizzard', 'starcraft2-game'],
        ['blizzard', 'starcraft2'],
        ['blizzard', 'casc'],
        ['blizzard', 'models'],
        ['blizzard', 'mpq'],
        ['common', 'images'],
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
      const serviceDefinitions = createBundledServiceDefinitionRegistry()
      await registerServiceDefinitionsOrThrow(inventory, serviceDefinitions)
      const target = {
        environment: 'node' as const,
        operatingSystem: 'windows' as const,
        architecture: 'x64' as const,
      }
      const services = { inventory, target, executionBackends, serviceDefinitions }
      const serviceGrant = {
        id: 'sc2-casc-real-services',
        classes: ['filesystem-read', 'process-launch'] as const,
      }
      const discoveryResolution = await resolveGameInstallationDiscovery({
        services,
        gameId: 'org.modkitx/starcraft-2',
        grant: serviceGrant,
        budgets: budget,
      })
      if (discoveryResolution.state !== 'resolved') {
        throw new Error(
          `SC2 discovery service did not resolve: ${discoveryResolution.diagnostics.map(item => item.message).join('; ')}`,
        )
      }
      const workspaceResolution = await resolveModWorkspaceComposition({
        services,
        gameId: 'org.modkitx/starcraft-2',
        grant: { id: 'sc2-casc-real-workspace', classes: [] },
        budgets: budget,
      })
      if (workspaceResolution.state !== 'resolved') {
        await discoveryResolution.release()
        throw new Error(
          `SC2 workspace service did not resolve: ${workspaceResolution.diagnostics.map(item => item.message).join('; ')}`,
        )
      }
      const dataResolution = await resolveDataCatalogAnalysis({
        services,
        gameId: 'org.modkitx/starcraft-2',
        grant: { id: 'sc2-casc-real-data', classes: [] },
        budgets: budget,
      })
      if (dataResolution.state !== 'resolved') {
        await workspaceResolution.release()
        await discoveryResolution.release()
        throw new Error(
          `SC2 data service did not resolve: ${dataResolution.diagnostics.map(item => item.message).join('; ')}`,
        )
      }
      const mapResolution = await resolveMapSemanticAnalysis({
        services,
        gameId: 'org.modkitx/starcraft-2',
        grant: { id: 'sc2-casc-real-map', classes: [] },
        budgets: budget,
      })
      if (mapResolution.state !== 'resolved') {
        await dataResolution.release()
        await workspaceResolution.release()
        await discoveryResolution.release()
        throw new Error(
          `SC2 map service did not resolve: ${mapResolution.diagnostics.map(item => item.message).join('; ')}`,
        )
      }
      const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
      let casc: Awaited<ReturnType<typeof openSubject>> | undefined
      try {
        const discovered = await discoveryResolution.discovery.discover({
          gameId: 'org.modkitx/starcraft-2',
          configuredPaths: [sc2Root],
          maxCandidates: 16,
        })
        const normalizedInstallPath = sc2Root
          .replace(/\\/gu, '/')
          .replace(/\/+$/gu, '')
          .toLowerCase()
        const installation = discovered.installations.find(
          candidate => candidate.normalizedPath.toLowerCase() === normalizedInstallPath,
        )
        expect(installation).toBeDefined()
        if (installation === undefined) throw new Error('configured SC2 installation was not found')
        const installationUri = pathToFileURL(installation.installPath).href
        const mount = await vfs.openMount(installationUri)
        casc = await openSubject({
          inventory,
          source: artifactNamespaceSourceFromVfsMount(mount),
          path: 'StarCraft II',
          intent: 'full',
          target,
          grant: { id: 'sc2-casc-real', classes: ['read-source'] },
          executionBackends,
          budget,
        })
        if (casc.state !== 'opened') {
          throw new Error(
            `CASC open failed: ${casc.reason} ${JSON.stringify({ candidates: casc.candidates, diagnostics: casc.diagnostics })}`,
          )
        }
        const cascSession = casc.session
        expect(casc.selected).toMatchObject({
          contributionId: 'org.modkitx/casc',
          confidence: 0.99,
        })
        expect(casc.descriptor).toMatchObject({
          identity: { formatId: 'casc' },
          constraints: { readOnly: true, randomAccess: false },
        })

        const namespaceLease = await cascSession.dataSource('common.view/namespace-entry-source', 1)
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
          const workspace = await workspaceResolution.composition.compose({
            workspaceId: 'installed-liberty-tarcade',
            gameId: 'org.modkitx/starcraft-2',
            activeRootId: 'retail:tarcade.sc2map',
            sources: [
              {
                sourceId: 'retail-casc',
                kind: 'casc',
                location: installationUri,
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
          expect(workspace.logicalRoots?.map(root => root.displayName)).toEqual([
            'TArcade.SC2Map',
            'Liberty.SC2Campaign',
            'Liberty.SC2Mod',
            'Core.SC2Mod',
          ])

          const extractCascBytes = async (path: string): Promise<Uint8Array> => {
            const extracted = await cascSession
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
            maxTerrainSamples: 100_000,
            maxDepth: 64,
          } as const
          const preliminaryMap = await mapResolution.analysis.open({
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
          const catalog = await dataResolution.analysis.analyze({
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

          /*
           * Block 15B product path: the selected provider owns only the plan and parsing.
           * Every real catalog/localization byte crosses the CASC namespace -> host-owned
           * ResourceSessionPort seam; neither the host coordinator nor this test imports the
           * provider implementation or reads an unpacked install child from the filesystem.
           */
          const { createNamespaceCompanionOrigin } = (await import(
            pathToFileURL(join(repoRoot, 'packages', 'host', 'src', 'namespace-origin.js')).href
          )) as typeof import('../../host/src/namespace-origin.js')
          const { createResourceSession } = (await import(
            pathToFileURL(join(repoRoot, 'packages', 'host', 'src', 'resource-session.js')).href
          )) as typeof import('../../host/src/resource-session.js')
          const cascRevision = (await cascSession.descriptor()).revision
          const resources = createResourceSession({
            origin: createNamespaceCompanionOrigin({
              namespace,
              primaryLogicalId: mapRoot,
              containerRevision: cascRevision,
              extract: extractCascBytes,
            }),
            revision: cascRevision,
          })
          const liveData = await analyzeResolvedDataWorkspace({
            services,
            grant: { id: 'sc2-casc-real-resolved-data', classes: [] },
            budgets: budget,
            workspace,
            resources,
            locales: ['enUS'],
            queries: [{ namespace: 'Unit', entityId: 'Marine' }],
            localizationKeys: ['Unit/Name/Marine'],
            limits: {
              maxRequirements: 64,
              maxDocumentBytes: 4_194_304,
              maxTextBytes: 16_777_216,
              maxEntities: 100_000,
              maxDepth: 128,
              maxPageSize: 128,
            },
          })
          expect(
            liveData.state,
            liveData.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
          ).toBe('resolved')
          if (liveData.state !== 'resolved') {
            await resources.dispose()
            throw new Error('real resolved data workspace did not open')
          }
          try {
            const provenance = resources.provenance()
            for (const path of [
              'mods/core.sc2mod/base.sc2data/gamedata/unitdata.xml',
              'mods/liberty.sc2mod/base.sc2data/gamedata/unitdata.xml',
              'mods/core.sc2mod/enus.sc2data/localizeddata/gamestrings.txt',
              'mods/liberty.sc2mod/enus.sc2data/localizeddata/gamestrings.txt',
            ]) {
              expect(
                provenance.find(item => item.logicalId === path),
                `real corpus did not resolve planned Core/Liberty resource ${path}`,
              ).toMatchObject({ state: 'resolved' })
            }
            expect(
              liveData.plan.requirements
                .filter(item => item.kind === 'catalog')
                .slice(0, 16)
                .map(item => item.rootId),
            ).toEqual([
              ...Array(8).fill('retail:core.sc2mod'),
              ...Array(8).fill('retail:liberty.sc2mod'),
            ])
            const liveMarine = liveData.snapshot.definitions.find(
              entity => entity.namespace === 'Unit' && entity.entityId === 'Marine',
            )
            expect(liveMarine).toMatchObject({ typeId: 'CUnit', entityId: 'Marine' })
            expect(liveMarine?.sources.map(item => item.rootId)).toContain('retail:liberty.sc2mod')
            const overlaid = liveData.snapshot.definitions.filter(entity => {
              const sourceRoots = new Set(entity.sources.map(source => source.rootId))
              return (
                sourceRoots.has('retail:core.sc2mod') && sourceRoots.has('retail:liberty.sc2mod')
              )
            })
            expect(overlaid.length).toBeGreaterThan(0)
            const coreUnit = provenance.find(
              item => item.logicalId === 'mods/core.sc2mod/base.sc2data/gamedata/unitdata.xml',
            )
            const libertyUnit = provenance.find(
              item => item.logicalId === 'mods/liberty.sc2mod/base.sc2data/gamedata/unitdata.xml',
            )
            expect(coreUnit?.revision).not.toBe(libertyUnit?.revision)
            const activeUnit = provenance.find(
              item => item.logicalId === `${mapRoot}/base.sc2data/gamedata/unitdata.xml`,
            )
            expect(activeUnit).toBeDefined()
            if (activeUnit?.state === 'unresolved') expect(liveData.snapshot.complete).toBe(false)
            expect(liveData.snapshot.relations.length).toBeGreaterThan(0)
            expect(liveData.snapshot.localizedStrings).toContainEqual(
              expect.objectContaining({
                key: 'Unit/Name/Marine',
                resolvedLocale: 'enUS',
              }),
            )
            const graph = await liveData.facets.relations.value.summary()
            expect(graph).toMatchObject({
              snapshotId: liveData.snapshot.snapshotId,
              completeness: 'partial',
            })
            console.info(
              `[sc2-live] resolved data ${JSON.stringify(corpusDescriptor)}: ${liveData.snapshot.definitions.length} definitions, ${liveData.snapshot.relations.length} typed relations, ${liveData.snapshot.localizedStrings.length} localized strings; complete=${String(liveData.snapshot.complete)}`,
            )
          } finally {
            await liveData.release()
            await resources.dispose()
          }

          /*
           * Block 15G retail proof. The source still comes from the live CASC namespace through a
           * fresh ResourceSessionPort. A pure zero-argument function is executed only when the
           * retail script actually contains one in the named bounded profile; native paths are
           * tested separately and must remain a structured refusal, never a claim that the whole
           * generated map program runs.
           */
          const runtimePage = await namespace.list(`${mapRoot}/`, { limit: 128 })
          const mapScript = runtimePage.items.find(item => /\/mapscript\.galaxy$/iu.test(item.path))
          expect(mapScript, 'installed TArcade map has no Galaxy source').toBeDefined()
          if (mapScript === undefined) throw new Error('retail MapScript.galaxy is unavailable')
          const mapScriptText = new TextDecoder().decode(await extractCascBytes(mapScript.path))
          const pureFunction = [
            ...mapScriptText.matchAll(
              /\b(?:void\s+([A-Za-z_]\w*)\s*\(\s*\)\s*\{\s*\}|(?:int|bool|string)\s+([A-Za-z_]\w*)\s*\(\s*\)\s*\{\s*return\s+(?:-?\d+|true|false|null|"(?:[^"\\]|\\.)*")\s*;\s*\})/gu,
            ),
          ]
            .map(match => match[1] ?? match[2])
            .find(name => name !== undefined)
          const runtimeResources = createResourceSession({
            origin: createNamespaceCompanionOrigin({
              namespace,
              primaryLogicalId: mapRoot,
              containerRevision: cascRevision,
              extract: extractCascBytes,
            }),
            revision: cascRevision,
            sessionId: 'sc2-casc-real-runtime-resources',
          })
          const runtime = await openRuntimeSession({
            services,
            runtimeId: 'blizzard.starcraft2.galaxy-pure-bounded-v1',
            sessionId: 'sc2-casc-real-runtime',
            budget: { maxWallTimeMs: 100, maxTicks: 1_000, maxMemoryBytes: 16_777_216 },
            grant: { id: 'sc2-casc-real-runtime', classes: [] },
            activationBudget: budget,
            providerInvocation: {
              resources: runtimeResources,
              inputs: [
                {
                  id: 'retail-map-script',
                  kind: 'source',
                  logicalId: mapScript.path,
                  scopes: ['current-mount'],
                  maxBytes: 4_194_304,
                },
              ],
            },
          })
          expect(
            runtime.state,
            runtime.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
          ).toBe('resolved')
          if (runtime.state !== 'resolved') {
            await runtimeResources.dispose()
            throw new Error('retail bounded runtime did not resolve')
          }
          try {
            if (pureFunction !== undefined) {
              await expect(
                runtime.session.execute({
                  entrypoint: pureFunction,
                  resources: { wallTimeMs: 1, ticks: 0, memoryBytes: 0 },
                }),
              ).resolves.toMatchObject({ state: 'completed' })
            }
            let refusedNative: string | undefined
            for (const entrypoint of ['InitMap', 'InitTriggers', 'main']) {
              const result = await runtime.session.execute({
                entrypoint,
                resources: { wallTimeMs: 1, ticks: 0, memoryBytes: 0 },
              })
              if (result.state === 'refused' && result.reason === 'native-unavailable') {
                refusedNative = entrypoint
                break
              }
            }
            expect(
              refusedNative,
              'retail map did not expose an expected named native-call refusal',
            ).toBeDefined()
            proves({
              capabilityId: 'format/sc2-runtime/open-inspect',
              operation: 'inspect',
              note: `retail CASC MapScript executed pure ${pureFunction ?? 'not-present'} and refused native entrypoint ${refusedNative ?? 'missing'}`,
            })
            console.info(
              `[sc2-live] bounded runtime: pure=${pureFunction ?? 'not-present'}; native-refusal=${refusedNative}`,
            )
          } finally {
            await runtime.release()
            await runtimeResources.dispose()
          }

          const mapResources = createResourceSession({
            origin: createNamespaceCompanionOrigin({
              namespace,
              primaryLogicalId: mapRoot,
              containerRevision: cascRevision,
              extract: extractCascBytes,
            }),
            revision: cascRevision,
          })
          const semanticMap = await analyzeResolvedMapWorkspace({
            services,
            grant: { id: 'sc2-casc-real-map-world', classes: [] },
            budgets: budget,
            workspace,
            resources: mapResources,
            catalog,
            limits: {
              ...mapLimits,
              maxRequirements: 8,
              maxPageSize: 4_096,
              maxDiagnostics: 100,
            },
          })
          expect(
            semanticMap.state,
            semanticMap.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
          ).toBe('resolved')
          if (semanticMap.state !== 'resolved') {
            await mapResources.dispose()
            throw new Error('real resolved map workspace did not open')
          }
          try {
            expect(
              semanticMap.snapshot.complete,
              [...semanticMap.snapshot.semantic.diagnostics, ...semanticMap.snapshot.diagnostics]
                .map(item => `${item.code}: ${item.message}`)
                .join('\n'),
            ).toBe(true)
            expect(semanticMap.snapshot.semantic.terrain).toMatchObject({
              version: 101,
              width: 257,
              height: 257,
              cellCount: 66_049,
            })
            expect(semanticMap.snapshot.semantic.terrain?.samples).toHaveLength(66_049)
            expect(semanticMap.snapshot.semantic.terrain?.samples.at(0)).toMatchObject({
              x: 0,
              y: 0,
            })
            expect(semanticMap.snapshot.semantic.terrain?.samples.at(-1)).toMatchObject({
              x: 256,
              y: 256,
            })
            expect(semanticMap.snapshot.semantic.regions).toContainEqual(
              expect.objectContaining({ regionId: 1, name: 'Cheer' }),
            )
            const placedMarine = semanticMap.snapshot.semantic.objects.find(
              object => object.kind === 'unit' && object.typeId === 'Marine',
            )
            expect(placedMarine).toMatchObject({
              catalog: {
                ref: { namespace: 'Unit', entityId: 'Marine' },
                entity: { typeId: 'CUnit', fields: { Race: 'Terr' } },
              },
            })
            expect(semanticMap.snapshot.semantic.resolvedCatalogObjects).toBe(
              semanticMap.snapshot.semantic.objects.filter(object => object.kind === 'unit').length,
            )
            expect(mapResources.provenance()).toEqual(
              expect.arrayContaining(
                ['objects', 'regions', 't3heightmap'].map(name =>
                  expect.objectContaining({ logicalId: `${mapRoot}/${name}`, state: 'resolved' }),
                ),
              ),
            )
            const worldInfo = await semanticMap.world.value.info()
            expect(worldInfo).toMatchObject({
              contract: 'org.modkitx.blizzard.starcraft2/world-scene-source',
              maturity: 'publisher-candidate',
              mapId: mapRoot,
            })
            expect(worldInfo.crossSpaceTransforms).toContainEqual(
              expect.objectContaining({
                from: 'height-grid',
                to: 'map-native',
                state: 'unknown',
              }),
            )
            expect(worldInfo.facets).toContainEqual(
              expect.objectContaining({
                facet: 'terrain',
                state: 'available',
                itemCount: 66_049,
                lods: ['exact'],
              }),
            )
            const uvwAdmission = await assessCandidateWorldUvwAdmission(semanticMap.world.value, {
              maxPageItems: 4_096,
              maxTerrainItems: 100_000,
            })
            expect(uvwAdmission.refusalCodes).toEqual([
              'terrain-bounds-unproven',
              'coordinate-transform-unproven',
              'source-unit-unproven',
              'canonical-origin-unproven',
              'cell-size-unproven',
              'vertical-quantization-unproven',
            ])
            expect(uvwAdmission).toMatchObject({
              state: 'refused',
              source: {
                contract: 'org.modkitx.blizzard.starcraft2/world-scene-source',
                snapshotId: semanticMap.snapshot.snapshotId,
                infoSnapshotId: semanticMap.snapshot.snapshotId,
              },
              requestedLod: 'exact',
              pageRequests: 17,
              observedTerrainItems: 66_049,
              materialized: false,
              serialized: false,
              serializedBytes: 0,
              lostFacetIds: [],
            })
            const viewer = await inspectCandidateWorld(semanticMap.world.value, {
              maxLayers: 8,
              maxItemsPerLayer: 8,
            })
            expect(viewer.layers.map(item => item.layer.kind)).toEqual([
              'terrain',
              'objects',
              'regions',
              'resources',
              'navigation',
            ])
            const resourceLayerId = worldInfo.facets.find(
              item => item.facet === 'resources',
            )?.layerId
            if (resourceLayerId === undefined) throw new Error('world resource layer is absent')
            const marineResource = (
              await semanticMap.world.value.page({
                facet: 'resources',
                layerId: resourceLayerId,
                limit: 16,
              })
            ).items.find(item => item.facet === 'resources' && item.entityId === 'Marine')
            expect(marineResource).toMatchObject({ resolved: true })
            proves({
              capabilityId: 'format/sc2-map/open-inspect',
              operation: 'read',
              note: 'Real installed TArcade bytes traverse CASC, ResourceSession and the resolved map service.',
            })
            proves({
              capabilityId: 'format/sc2-map/open-inspect',
              operation: 'inspect',
              note: 'Generic world harness consumes the SC2 publisher candidate with exact resource joins.',
            })
            console.info(
              `[sc2-live] world ${mapRoot}: ${semanticMap.snapshot.semantic.objects.length} objects, ${semanticMap.snapshot.semantic.regions.length} regions, navigation=${String(semanticMap.snapshot.navigation !== undefined)}, candidate=${semanticMap.world.value.contract}@1, uvw=${uvwAdmission.state}:${uvwAdmission.refusalCodes.join(',')}`,
            )
          } finally {
            await semanticMap.release()
            await mapResources.dispose()
          }

          const cancelled = new AbortController()
          cancelled.abort()
          await expect(namespace.list('', { limit: 1 }, cancelled.signal)).rejects.toMatchObject({
            name: 'AbortError',
          })
        } finally {
          await namespaceLease.release()
        }

        const reopen = async (path: string, expectedFormat: string): Promise<void> => {
          const opened = await openNestedSubject({
            parent: cascSession,
            entryId: path,
            inventory,
            intent: 'full',
            target,
            grant: { id: `sc2-casc-nested-${expectedFormat}`, classes: ['read-source'] },
            executionBackends,
            budget,
            serviceDefinitions,
          })
          const nested = opened.result
          if (nested.state !== 'opened') {
            throw new Error(
              `nested ${expectedFormat} open failed: ${nested.reason} ${JSON.stringify(nested.candidates)}`,
            )
          }
          try {
            expect(nested.descriptor).toMatchObject({ identity: { formatId: expectedFormat } })
            if (expectedFormat === 'm3') {
              const lease = await nested.session.dataSource('common.view/model-scene-source', 1)
              try {
                const model = lease.value as ModelSceneSource
                const info = await model.info()
                expect(info).toMatchObject({ geometryAccess: 'decoded' })
                expect(info.primitives).toBeGreaterThan(0)
                const meshes = await model.meshes({ limit: 1 })
                const primitiveId = meshes.items[0]?.primitiveIds[0]
                if (primitiveId === undefined || model.primitive === undefined) {
                  throw new Error(`M3 ${path} published no readable primitive`)
                }
                const primitive = await model.primitive(primitiveId, {
                  maxBytes: budget.maxScalarBytes,
                })
                expect(primitive.positions.length).toBeGreaterThan(0)
                console.info(
                  `[sc2-live] M3 ${path}: ${info.primitives} primitive(s), ${primitive.positions.length / 3} decoded vertices`,
                )
              } finally {
                await lease.release()
              }
            } else if (expectedFormat === 'dds') {
              const lease = await nested.session.dataSource('common.view/raster-image-source', 1)
              try {
                const image = lease.value as RasterImageSource
                const info = await image.info()
                expect(info).toMatchObject({ decodedAccess: true })
                if (image.readRegion === undefined) throw new Error(`DDS ${path} cannot decode`)
                const pixel = await image.readRegion({
                  x: 0,
                  y: 0,
                  width: 1,
                  height: 1,
                  pixelFormat: 'rgba8',
                  maxBytes: 4,
                })
                expect(pixel.pixels).toHaveLength(4)
                console.info(`[sc2-live] DDS ${path}: ${info.width}x${info.height}, decoded RGBA8`)
              } finally {
                await lease.release()
              }
            } else if (expectedFormat === 'mpq') {
              const lease = await nested.session.dataSource('common.view/namespace-entry-source', 1)
              try {
                const namespace = lease.value as NamespaceEntrySource
                const paths: string[] = []
                let cursor: string | undefined
                do {
                  const page = await namespace.list('', {
                    ...(cursor === undefined ? {} : { cursor }),
                    limit: 1_000,
                  })
                  paths.push(...page.items.map(item => item.path))
                  cursor = page.nextCursor
                } while (cursor !== undefined)
                expect(paths).not.toHaveLength(0)
                const nestedDdsPath = paths.find(item => /\.dds$/iu.test(item))
                if (nestedDdsPath === undefined) throw new Error(`MPQ ${path} contains no DDS`)
                const openedDds = await openNestedSubject({
                  parent: nested.session,
                  entryId: nestedDdsPath,
                  inventory,
                  intent: 'full',
                  target,
                  grant: { id: 'sc2-casc-mpq-dds', classes: ['read-source'] },
                  executionBackends,
                  budget,
                  serviceDefinitions,
                })
                const nestedDds = openedDds.result
                if (nestedDds.state !== 'opened') {
                  throw new Error(`nested MPQ DDS open failed: ${nestedDds.reason}`)
                }
                try {
                  expect(nestedDds.descriptor).toMatchObject({ identity: { formatId: 'dds' } })
                  const imageLease = await nestedDds.session.dataSource(
                    'common.view/raster-image-source',
                    1,
                  )
                  try {
                    const image = imageLease.value as RasterImageSource
                    const info = await image.info()
                    expect(info.decodedAccess).toBe(true)
                    console.info(
                      `[sc2-live] CASC -> MPQ -> DDS ${path}/${nestedDdsPath}: ${info.width}x${info.height}`,
                    )
                  } finally {
                    await imageLease.release()
                  }
                } finally {
                  await nestedDds.session.dispose()
                }
                console.info(
                  `[sc2-live] MPQ ${path}: ${paths.length} entries; models=${paths
                    .filter(item => /\.m3$/iu.test(item))
                    .slice(0, 5)
                    .join(',')}; textures=${paths
                    .filter(item => /\.dds$/iu.test(item))
                    .slice(0, 5)
                    .join(',')}`,
                )
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
        if (casc?.state === 'opened') await casc.session.dispose()
        await vfs.dispose()
        await mapResolution.release()
        await dataResolution.release()
        await workspaceResolution.release()
        await discoveryResolution.release()
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

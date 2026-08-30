import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { productExtensionDirectory } from '../../../scripts/lib/external-extension-roots.mjs'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'
import {
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
  analyzeResolvedDataWorkspace,
  artifactNamespaceSourceFromVfsMount,
  buildInventory,
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openNestedSubject,
  openMapPreviewAssetSession,
  openSubject,
  registerServiceDefinitionsOrThrow,
  resolveDataCatalogAnalysis,
  resolveGameInstallationDiscovery,
  resolveMapSemanticAnalysis,
  resolveModWorkspaceComposition,
} from '@modkitx-x3/host'
import { openRuntimeSession } from '@modkitx-x3/host/runtime'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'
import {
  drainModelProjection,
  materializeAndCompare,
  proves,
  unexplainedDifferences,
} from '@modkitx-x3/testkit'
import {
  type ModelSceneSource,
  type MapTerrainNativeTransform,
  type MapTerrainSample,
  type NamespaceEntrySource,
  type RasterImageSource,
  type ResolvedDataWorkspaceSnapshot,
  type ResourceBudget,
  WORLD_SCENE_SOURCE_CONTRACT,
} from '@modkitx-x3/sdk'
import { inspectCandidateWorld } from '@modkitx-x3/ui/world'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'

import { assessCandidateWorldUvwAdmission } from '../src/uvw-materialization.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const sc2Override = process.env.MODKITX_SC2_ROOT?.trim()
const m3Path =
  'campaigns/liberty.sc2campaign/base.sc2assets/assets/campaign/terran/artifact1/artifact1.m3'
const ddsPath = 'campaigns/liberty.sc2campaign/base.sc2assets/assets/textures/alpha2.dds'
const mpqPath =
  'mods/liberty.sc2mod/base.sc2data/battlenetcache/fc2161abf876306f1a0467cfacf5e513cba4281fdc13532b440e8c8abb8835ac.s2ma'
const mapRoot = 'campaigns/liberty.sc2campaign/base.sc2maps/maps/campaign/tarcade.sc2map'

const SC2_WORLD_ORACLE = Object.freeze({
  native: 'c3419baf0f7834682342035b3d1d485a21a0f30adc7712e6a7424dc3c075e8e7',
  renderer: '4befdf3b649b32c3e9f96c927df9a18b73f35a2c49db57148056ba5d6422794a',
  canonical: 'dc1cb1b5d7a09b797721b79f158039141828cb567f2b8fd733d0a2dff108ba5b',
})

function sc2WorldTupleDigests(
  samples: readonly MapTerrainSample[],
  transform: MapTerrainNativeTransform,
): Readonly<{ native: string; renderer: string; canonical: string }> {
  if (!('vertData' in transform)) {
    throw new TypeError('SC2 world oracle requires a quantized HMAP transform')
  }
  const count = transform.heightMap.dim[0] * transform.heightMap.dim[1]
  if (samples.length !== count) throw new TypeError('SC2 world oracle requires the exact HMAP grid')
  const positions = new Array<readonly [number, number, number]>(count)
  const native = new Uint8Array(count * 3 * 8)
  const renderer = new Uint8Array(count * 3 * 4)
  const canonical = new Uint8Array(count * 3 * 8)
  const nativeView = new DataView(native.buffer)
  const rendererView = new DataView(renderer.buffer)
  const canonicalView = new DataView(canonical.buffer)
  const columns = transform.heightMap.dim[0]
  const rows = transform.heightMap.dim[1]
  for (let index = 0; index < count; index += 1) {
    const sample = samples[index]
    if (sample === undefined) throw new TypeError(`SC2 world oracle sample ${String(index)} absent`)
    const base =
      sample.heightBase * transform.vertData.quantizeScale - transform.vertData.quantizeBias
    const adjustment =
      sample.heightAdjustment * transform.vertData.quantizeScale - transform.vertData.quantizeBias
    const position = Object.freeze([
      transform.heightMap.offset.x + sample.x * transform.heightMap.scale.x,
      transform.heightMap.offset.y + sample.y * transform.heightMap.scale.y,
      base * transform.heightMap.scale.z + transform.heightMap.offset.z + adjustment,
    ] as const)
    positions[index] = position
    for (const [axis, value] of position.entries()) {
      nativeView.setFloat64((index * 3 + axis) * 8, value, true)
      rendererView.setFloat32((index * 3 + axis) * 4, value, true)
    }
  }
  for (let outputRow = 0; outputRow < rows; outputRow += 1) {
    const sourceRow = rows - 1 - outputRow
    for (let column = 0; column < columns; column += 1) {
      const outputIndex = outputRow * columns + column
      const position = positions[sourceRow * columns + column]
      if (position === undefined) throw new TypeError('SC2 canonical oracle position absent')
      const values = [position[0], position[2], position[1] === 0 ? 0 : -position[1]]
      for (const [axis, value] of values.entries()) {
        canonicalView.setFloat64((outputIndex * 3 + axis) * 8, value, true)
      }
    }
  }
  const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
  return Object.freeze({
    native: digest(native),
    renderer: digest(renderer),
    canonical: digest(canonical),
  })
}

const budget: ResourceBudget = {
  maxInputBytes: 268_435_456n,
  maxDepth: 128,
  maxNodes: 750_000,
  maxScalarBytes: 134_217_728,
  maxDiagnostics: 100,
}

describe('installed StarCraft II CASC product path', () => {
  it('discovers the install, resolves dependencies and opens a real semantic map through CASC', async () => {
    const directories = [
      ['blizzard', 'starcraft2'],
      ['blizzard', 'casc'],
      ['blizzard', 'models'],
      ['blizzard', 'mpq'],
      ['common', 'images'],
    ]
    const inputs = await Promise.all(
      directories.map(parts => loadExtensionDirectory(productExtensionDirectory(repoRoot, parts))),
    )
    const inventory = await buildInventory(
      inputs.map(input => ({
        ...input,
        execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
      })),
      createHostContributionContractRegistry(),
    )
    const executionBackends = createExecutionBackendRegistry([TRUSTED_IN_PROCESS_EXECUTION_BACKEND])
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
    const discovered = await discoveryResolution.discovery.discover({
      gameId: 'org.modkitx/starcraft-2',
      ...(sc2Override === undefined ? {} : { configuredPaths: [sc2Override] }),
      maxCandidates: 16,
    })
    const normalizedOverride = sc2Override?.replace(/\\/gu, '/').replace(/\/+$/gu, '').toLowerCase()
    const installation =
      normalizedOverride === undefined
        ? discovered.installations[0]
        : discovered.installations.find(
            candidate => candidate.normalizedPath.toLowerCase() === normalizedOverride,
          )
    if (installation === undefined) {
      await discoveryResolution.release()
      if (sc2Override !== undefined) {
        throw new Error(
          `MODKITX_SC2_ROOT did not resolve to a valid SC2 installation: ${sc2Override}`,
        )
      }
      throw new Error(
        'SC2 installation discovery returned no usable installation; the GA real-corpus proof must not skip',
      )
    }
    const buildInfoPath = join(installation.installPath, '.build.info')
    if (!existsSync(buildInfoPath)) {
      await discoveryResolution.release()
      throw new Error(
        `discovered SC2 installation does not contain the required .build.info sentinel: ${buildInfoPath}`,
      )
    }
    const before = statSync(buildInfoPath)
    const corpusDescriptor = Object.freeze({
      source: sc2Override === undefined ? 'auto-discovery' : 'MODKITX_SC2_ROOT',
      sentinel: '.build.info',
      size: before.size,
      modifiedMs: before.mtimeMs,
    })
    const installationUri = pathToFileURL(installation.installPath).href
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
    let liveDataSnapshot: ResolvedDataWorkspaceSnapshot | undefined
    let liveDataResourceRevision: string | undefined
    let sc2WorldUvwArtifactDigest: string | undefined
    try {
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
          expect(page.items, `${name} has no entry in the installed CASC namespace`).toHaveLength(1)
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
        proves({
          capabilityId: 'game/starcraft-2/discover-open',
          operation: 'inspect',
          note: 'the installed SC2 discovery route opens CASC and composes the pinned Map, Campaign and Mod dependency chain',
        })

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
          queries: [
            ...preliminaryMap.catalogQueries,
            { namespace: 'Effect', entityId: 'Corruption' },
            { namespace: 'Effect', entityId: 'GuardianShieldSearch' },
          ],
          localizationKeys: ['Unit/Name/Marine'],
          limits: {
            maxRequirements: 512,
            maxDocumentBytes: 16_777_216,
            maxTextBytes: 268_435_456,
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
              .slice(0, 218)
              .map(item => item.rootId),
          ).toEqual([
            ...Array(109).fill('retail:core.sc2mod'),
            ...Array(109).fill('retail:liberty.sc2mod'),
          ])
          const liveMarine = liveData.snapshot.definitions.find(
            entity => entity.namespace === 'Unit' && entity.entityId === 'Marine',
          )
          expect(liveMarine).toMatchObject({ typeId: 'CUnit', entityId: 'Marine' })
          expect(liveMarine?.sources.map(item => item.rootId)).toContain('retail:liberty.sc2mod')
          const corruption = liveData.snapshot.definitions.find(
            entity => entity.namespace === 'Effect' && entity.entityId === 'Corruption',
          )
          expect(corruption).toMatchObject({
            typeId: 'CEffectCreatePersistent',
            fields: { PeriodicEffectArray: ['CorruptionLaunchMissile'] },
          })
          expect(corruption?.sources).toContainEqual(
            expect.objectContaining({ rootId: 'retail:liberty.sc2mod' }),
          )
          const guardianShieldSearch = liveData.snapshot.definitions.find(
            entity => entity.namespace === 'Effect' && entity.entityId === 'GuardianShieldSearch',
          )
          expect(guardianShieldSearch).toMatchObject({
            typeId: 'CEffectEnumArea',
            fields: {
              AreaArray: [{ Radius: 4, Effect: 'GuardianShieldApplyBehavior' }],
            },
          })
          expect(guardianShieldSearch?.sources).toContainEqual(
            expect.objectContaining({ rootId: 'retail:liberty.sc2mod' }),
          )
          expect(liveData.snapshot.relations).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                from: { namespace: 'Effect', entityId: 'Corruption' },
                to: { namespace: 'Effect', entityId: 'CorruptionLaunchMissile' },
                role: 'PeriodicEffectArray',
                dead: false,
              }),
              expect.objectContaining({
                from: { namespace: 'Effect', entityId: 'GuardianShieldSearch' },
                to: { namespace: 'Effect', entityId: 'GuardianShieldApplyBehavior' },
                role: 'AreaArray.Effect',
                dead: false,
              }),
            ]),
          )
          const overlaid = liveData.snapshot.definitions.filter(entity => {
            const sourceRoots = new Set(entity.sources.map(source => source.rootId))
            return sourceRoots.has('retail:core.sc2mod') && sourceRoots.has('retail:liberty.sc2mod')
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
          if (activeUnit?.state === 'unresolved') {
            expect(
              liveData.plan.requirements.find(
                item => item.path === `${mapRoot}/base.sc2data/gamedata/unitdata.xml`,
              )?.required,
            ).toBe(false)
            expect(liveData.snapshot.complete).toBe(true)
          }
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
          liveDataSnapshot = liveData.snapshot
          liveDataResourceRevision = resources.revision
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
        const semanticMap = await openMapPreviewAssetSession({
          services,
          grant: { id: 'sc2-casc-real-map-world', classes: [] },
          budgets: budget,
          workspace,
          resources: mapResources,
          subjectUri: `sc2-map:${mapRoot}`,
          catalog:
            liveDataSnapshot ??
            (() => {
              throw new Error('real resolved data snapshot was not retained for the map join')
            })(),
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
        ).toBe('opened')
        if (semanticMap.state !== 'opened') {
          throw new Error('real resolved map workspace did not open')
        }
        const worldLease = await semanticMap.session.dataSource(WORLD_SCENE_SOURCE_CONTRACT, 1)
        const world = worldLease.value
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
          expect(semanticMap.snapshot.terrainTransform).toMatchObject({
            schemaVersion: 1,
            descriptorVersion: 113,
            snapshotId: semanticMap.snapshot.snapshotId,
            source: {
              terrainDocumentPath: `${mapRoot}/t3terrain.xml`,
              heightDocumentPath: `${mapRoot}/t3heightmap`,
              rootElement: 'terrain',
              heightMapElement: 'heightMap',
              quantizationElement: 'vertData',
            },
            heightMap: {
              dim: [257, 257],
              offset: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
            },
            vertData: {
              quantizeBias: 8.000585,
              quantizeScale: 0.0002898855,
              standardHeight: 9.999965,
            },
            bounds: {
              coordinateSpaceId: 'map-native',
              minimum: { x: 0, y: 0 },
              maximum: { x: 256, y: 256 },
            },
          })
          expect(Number.isFinite(semanticMap.snapshot.terrainTransform?.bounds.minimum.z)).toBe(
            true,
          )
          expect(Number.isFinite(semanticMap.snapshot.terrainTransform?.bounds.maximum.z)).toBe(
            true,
          )
          const exactTerrain = semanticMap.snapshot.semantic.terrain
          const nativeTransform = semanticMap.snapshot.terrainTransform
          if (exactTerrain === undefined || nativeTransform === undefined) {
            throw new Error('retail SC2 terrain oracle inputs are unavailable')
          }
          expect(sc2WorldTupleDigests(exactTerrain.samples, nativeTransform)).toEqual(
            SC2_WORLD_ORACLE,
          )
          expect(semanticMap.snapshot.uvwTransform).toMatchObject({
            schemaVersion: 1,
            snapshotId: semanticMap.snapshot.snapshotId,
            sourceCoordinateSpaceId: 'map-native',
            targetCoordinateSpaceId: 'uvw-canonical',
            basis: {
              handedness: 'right',
              upAxis: 'y',
              forwardAxis: '+z',
              unit: 'source-unit',
              sourceUnit: 'sc2-game-unit',
              unitsPerCell: 1,
            },
            axes: {
              x: { sourceAxis: 'x', scale: 1, offset: 0 },
              y: { sourceAxis: 'z', scale: 1, offset: 0 },
              z: { sourceAxis: 'y', scale: -1, offset: 0 },
            },
            heightfield: {
              columns: 257,
              rows: 257,
              cellSize: 1,
              origin: [0, 0, -256],
              sourceRowOrder: 'reverse',
            },
            bounds: {
              coordinateSpaceId: 'uvw-canonical',
              minimum: { x: 0, z: -256 },
              maximum: { x: 256, z: 0 },
            },
            proof: {
              kind: 'adapter-qualification',
              tupleCount: 66_049,
              nativeTupleDigest: `sha256:${SC2_WORLD_ORACLE.native}`,
              presentationTupleDigest: `sha256:${SC2_WORLD_ORACLE.renderer}`,
              canonicalTupleDigest: `sha256:${SC2_WORLD_ORACLE.canonical}`,
            },
          })
          expect(semanticMap.snapshot.snapshotId).toContain(
            '#sha256:994658707b6a56dd2b6261e9114b61ee10095a0801d57cbdc0dcec82181bcc6f',
          )
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
              ['objects', 'regions', 't3heightmap', 't3terrain.xml'].map(name =>
                expect.objectContaining({ logicalId: `${mapRoot}/${name}`, state: 'resolved' }),
              ),
            ),
          )
          const worldInfo = await world.info()
          expect(worldInfo).toMatchObject({
            contract: WORLD_SCENE_SOURCE_CONTRACT,
            maturity: 'publisher-candidate',
            mapId: mapRoot,
          })
          expect(worldInfo.crossSpaceTransforms).toContainEqual(
            expect.objectContaining({
              from: 'height-grid',
              to: 'map-native',
              state: 'known',
            }),
          )
          expect(worldInfo.terrainTransform).toEqual(semanticMap.snapshot.terrainTransform)
          expect(worldInfo.uvwTransform).toEqual(semanticMap.snapshot.uvwTransform)
          expect(worldInfo.crossSpaceTransforms).toContainEqual(
            expect.objectContaining({
              from: 'map-native',
              to: 'uvw-canonical',
              state: 'known',
            }),
          )
          expect(worldInfo.bounds).toContainEqual(
            expect.objectContaining({
              facet: 'terrain',
              coordinateSpaceId: 'map-native',
              x: { state: 'known', minimum: 0, maximum: 256 },
              y: { state: 'known', minimum: 0, maximum: 256 },
              z: expect.objectContaining({ state: 'known' }),
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
          expect(semanticMap.snapshot.gameId).toBe(liveDataSnapshot?.gameId)
          expect(semanticMap.snapshot.workspaceId).toBe(liveDataSnapshot?.workspaceId)
          expect(semanticMap.snapshot.gameId).toBe(workspace.gameId)
          expect(semanticMap.snapshot.workspaceId).toBe(workspace.workspaceId)
          expect(String(mapResources.revision)).toBe(liveDataResourceRevision)
          expect(worldInfo.provenance).toEqual(mapResources.provenance())
          const definitionRefs = semanticMap.snapshot.semantic.objects.flatMap(object =>
            object.catalog === undefined ? [] : [object.catalog],
          )
          expect(definitionRefs.length).toBeGreaterThan(0)
          const unresolvedDefinitionRefs = definitionRefs.filter(
            binding => binding.entity === undefined,
          )
          expect(unresolvedDefinitionRefs).toEqual([])
          expect(semanticMap.snapshot.semantic.resolvedCatalogObjects).toBe(definitionRefs.length)
          proves({
            capabilityId: 'vertical/starcraft-2/neutral-definitions-world',
            operation: 'inspect',
            note: 'retail resolved definitions and TArcade world share the same game, workspace and CASC revision; every emitted world definition reference resolves',
          })
          proves({
            capabilityId: 'vertical/starcraft-2/neutral-definitions-world',
            operation: 'read',
            note: 'the live definition and world facets are joined without claiming a portable UVD or production UVW artifact',
          })
          const uvwAdmission = await assessCandidateWorldUvwAdmission(world, {
            maxPageItems: 4_096,
            maxTerrainItems: 100_000,
          })
          expect(uvwAdmission.refusalCodes).toEqual([])
          expect(uvwAdmission).toMatchObject({
            state: 'materialized-candidate',
            source: {
              contract: WORLD_SCENE_SOURCE_CONTRACT,
              snapshotId: semanticMap.snapshot.snapshotId,
              infoSnapshotId: semanticMap.snapshot.snapshotId,
            },
            requestedLod: 'exact',
            pageRequests: 17,
            observedTerrainItems: 66_049,
            materialized: true,
            serialized: true,
            lostFacetIds: [],
            receipt: {
              canonicalTupleDigest: `sha256:${SC2_WORLD_ORACLE.canonical}`,
              admissionGate: 'second-family-required',
              planes: [{ planeId: 'heightfield-base', state: 'inferred' }],
            },
          })
          if (uvwAdmission.state !== 'materialized-candidate') {
            throw new Error('retail TArcade UVW candidate did not materialize')
          }
          expect(uvwAdmission.serializedBytes).toBeGreaterThan(1_000_000)
          expect(uvwAdmission.serializedBytes).toBe(uvwAdmission.artifactBytes.byteLength)
          expect(uvwAdmission.document).toMatchObject({
            basis: {
              unit: 'source-unit',
              sourceUnit: 'sc2-game-unit',
              unitsPerCell: 1,
            },
            bounds: {
              min: [0, 2.9961863570000027, -256],
              max: [256, 11.996261475500003, 0],
            },
            layers: [
              {
                columns: 257,
                rows: 257,
                cellSize: 1,
                origin: [0, 0, -256],
              },
            ],
          })
          const uvwSamples = uvwAdmission.document.layers[0]?.samples
          expect(uvwSamples?.[0]?.[0]).toBe(2.9961863570000027)
          expect(uvwSamples?.[135]?.[185]).toBe(11.996261475500003)
          expect(uvwSamples?.[256]?.[256]).toBe(2.9961863570000027)
          const uvwProfile = (await import(
            pathToFileURL(
              join(repoRoot, 'vendor', 'multiverse-specs', 'specs', 'tools', 'uvw-profile.mjs'),
            ).href
          )) as { readonly assertUvwProfile: (document: unknown) => unknown }
          expect(() => uvwProfile.assertUvwProfile(uvwAdmission.document)).not.toThrow()
          const repeatedUvw = await assessCandidateWorldUvwAdmission(world, {
            maxPageItems: 2_048,
            maxTerrainItems: 100_000,
          })
          expect(repeatedUvw.state).toBe('materialized-candidate')
          if (repeatedUvw.state !== 'materialized-candidate') {
            throw new Error('repeat retail TArcade UVW candidate did not materialize')
          }
          expect(repeatedUvw.artifactBytes).toEqual(uvwAdmission.artifactBytes)
          expect(repeatedUvw.receipt.artifactDigest).toBe(uvwAdmission.receipt.artifactDigest)
          sc2WorldUvwArtifactDigest = uvwAdmission.receipt.artifactDigest
          const viewer = await inspectCandidateWorld(world, {
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
          const resourceLayerId = worldInfo.facets.find(item => item.facet === 'resources')?.layerId
          if (resourceLayerId === undefined) throw new Error('world resource layer is absent')
          const marineResource = (
            await world.page({
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
            `[sc2-live] world ${mapRoot}: ${semanticMap.snapshot.semantic.objects.length} objects, ${semanticMap.snapshot.semantic.regions.length} regions, terrain-transform=${String(semanticMap.snapshot.terrainTransform !== undefined)}, navigation=${String(semanticMap.snapshot.navigation !== undefined)}, candidate=${world.contract}@1, uvw=${uvwAdmission.state}:${uvwAdmission.refusalCodes.join(',')}`,
          )
        } finally {
          await worldLease.release()
          await semanticMap.session.dispose()
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
              const projection = await drainModelProjection(model, {
                maxBytes: budget.maxScalarBytes,
              })
              const verdict = await materializeAndCompare(repoRoot, projection, {
                assetId: `sc2/${path}`,
                sourceFormat: 'm3',
                subjectRevision: nested.session.revision,
                assetClass: 'unit',
              })
              expect(verdict.byteStable).toBe(true)
              expect(unexplainedDifferences(verdict)).toEqual([])
              if (!verdict.exact) {
                expect(
                  verdict.receipt.diff.length +
                    verdict.receipt.lostFacetIds.length +
                    verdict.receipt.excludedFacetIds.length,
                ).toBeGreaterThan(0)
              }
              expect(sc2WorldUvwArtifactDigest).toMatch(/^sha256:[0-9a-f]{64}$/u)
              proves({
                capabilityId: 'vertical/starcraft-2/native-to-uv',
                operation: 'read',
                note: 'one retail CASC workflow proves receipt-complete M3-to-UVM and exact TArcade candidate UVW materialization; the separate companion proof closes exact M3 UVM scope without making UVW a production writer',
              })
              console.info(
                `[sc2-live] M3 ${path}: ${info.primitives} primitive(s), ${primitive.positions.length / 3} decoded vertices, UVM ${verdict.bytes.byteLength} bytes`,
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
  }, 300_000)
})

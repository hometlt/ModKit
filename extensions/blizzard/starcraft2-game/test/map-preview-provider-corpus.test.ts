import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
  artifactNamespaceSourceFromVfsMount,
  buildInventory,
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  coordinateMapPreviewAssetSession,
  openSubject,
  registerServiceDefinitionsOrThrow,
  resolveGameInstallationDiscovery,
  resolveMapPreviewPreparation,
} from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'
import type { AssetSession, ResourceBudget } from '@modkitx-x3/sdk'
import type { MapPreviewPreparationRequest } from '@modkitx-x3/sdk/maps'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')
const sc2Override = process.env.MODKITX_SC2_ROOT?.trim()
const productMaxSubjectEntries = 4_096
const productMaxSubjectPages = 64
const pinnedMapRoot = 'campaigns/liberty.sc2campaign/base.sc2maps/maps/campaign/tarcade.sc2map'

const budget: ResourceBudget = {
  maxInputBytes: 268_435_456n,
  maxDepth: 128,
  maxNodes: 750_000,
  maxScalarBytes: 134_217_728,
  maxDiagnostics: 100,
}

const previewLimits = {
  maxDocuments: 8,
  maxDocumentBytes: 1_048_576,
  maxTotalBytes: 4_194_304,
  maxObjects: 100_000,
  maxRegions: 10_000,
  maxTerrainCells: 100_000,
  maxTerrainSamples: 100_000,
  maxDepth: 64,
  maxRequirements: 8,
  maxPageSize: 4_096,
  maxDiagnostics: 100,
} as const

describe.skipIf(process.platform !== 'win32')(
  'installed StarCraft II CASC map preview preparation',
  () => {
    it('uses auto-discovery and the product 4096-entry root listing without pretending it is complete', async ({
      skip,
    }) => {
      const inputs = await Promise.all(
        [
          ['blizzard', 'starcraft2-game'],
          ['blizzard', 'casc'],
        ].map(parts => loadExtensionDirectory(join(repoRoot, 'extensions', ...parts))),
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
      const discoveryResolution = await resolveGameInstallationDiscovery({
        services,
        gameId: 'org.modkitx/starcraft-2',
        grant: {
          id: 'sc2-map-preview-corpus-discovery',
          classes: ['filesystem-read', 'process-launch'],
        },
        budgets: budget,
      })
      if (discoveryResolution.state !== 'resolved') {
        throw new Error(
          `SC2 discovery service did not resolve: ${discoveryResolution.diagnostics.map(item => item.message).join('; ')}`,
        )
      }

      const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
      let casc: Awaited<ReturnType<typeof openSubject>> | undefined
      let previewResolution: Awaited<ReturnType<typeof resolveMapPreviewPreparation>> | undefined
      let openedPreview: AssetSession | undefined
      try {
        const discovered = await discoveryResolution.discovery.discover({
          gameId: 'org.modkitx/starcraft-2',
          ...(sc2Override === undefined ? {} : { configuredPaths: [sc2Override] }),
          maxCandidates: 16,
        })
        const normalizedOverride = sc2Override
          ?.replace(/\\/gu, '/')
          .replace(/\/+$/gu, '')
          .toLowerCase()
        const installation =
          normalizedOverride === undefined
            ? discovered.installations[0]
            : discovered.installations.find(
                candidate => candidate.normalizedPath.toLowerCase() === normalizedOverride,
              )
        if (installation === undefined) {
          if (sc2Override !== undefined) {
            throw new Error(
              `MODKITX_SC2_ROOT did not resolve to a valid SC2 installation: ${sc2Override}`,
            )
          }
          skip()
          return
        }
        const buildInfoPath = join(installation.installPath, '.build.info')
        if (!existsSync(buildInfoPath)) {
          throw new Error(`discovered SC2 installation has no .build.info: ${buildInfoPath}`)
        }

        const installationUri = pathToFileURL(installation.installPath).href
        const mount = await vfs.openMount(installationUri)
        casc = await openSubject({
          inventory,
          source: artifactNamespaceSourceFromVfsMount(mount),
          path: 'StarCraft II',
          intent: 'full',
          target,
          grant: { id: 'sc2-map-preview-corpus-casc', classes: ['read-source'] },
          executionBackends,
          budget,
          serviceDefinitions,
        })
        if (casc.state !== 'opened') {
          throw new Error(`CASC open failed: ${casc.reason} ${JSON.stringify(casc.diagnostics)}`)
        }
        const cascSession = casc.session
        expect(casc.descriptor).toMatchObject({ identity: { formatId: 'casc' } })

        previewResolution = await resolveMapPreviewPreparation({
          services,
          subjectFormatId: 'casc',
          grant: { id: 'sc2-map-preview-corpus-provider', classes: [] },
          budgets: budget,
        })
        if (previewResolution.state !== 'resolved') {
          throw new Error(
            `SC2 map-preview preparation did not resolve: ${previewResolution.diagnostics.map(item => item.message).join('; ')}`,
          )
        }

        const preparationRequests: MapPreviewPreparationRequest[] = []
        const preparation = Object.freeze({
          ...previewResolution.preparation,
          async prepare(request: MapPreviewPreparationRequest) {
            preparationRequests.push(request)
            return previewResolution?.state === 'resolved'
              ? previewResolution.preparation.prepare(request)
              : Promise.reject(new Error('preparation lease was released early'))
          },
        })
        const coordinate = (selectionId?: string) =>
          coordinateMapPreviewAssetSession({
            services,
            grant: { id: 'sc2-map-preview-corpus-coordinate', classes: [] },
            budgets: budget,
            original: cascSession,
            preparation,
            ...(selectionId === undefined ? {} : { selectionId }),
            maxCandidates: 64,
            maxSubjectEntries: productMaxSubjectEntries,
            maxSubjectPages: productMaxSubjectPages,
            maxRoots: 32,
            maxDepth: 16,
            limits: previewLimits,
          })

        const selection = await coordinate()
        expect(
          selection.state,
          selection.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
        ).toBe('selection-required')
        if (selection.state !== 'selection-required') {
          throw new Error('installed CASC did not produce explicit map selection')
        }
        expect(preparationRequests).toHaveLength(2)
        const rootFacts = preparationRequests[0].subject.namespace
        expect(rootFacts).toMatchObject({ state: 'truncated' })
        expect(rootFacts.entries).toHaveLength(productMaxSubjectEntries)
        const rootListingPinnedMarkers = new Set(
          rootFacts.entries
            .filter(entry => entry.path.startsWith(`${pinnedMapRoot}/`))
            .map(entry => entry.path.slice(pinnedMapRoot.length + 1).toLowerCase()),
        )
        expect(rootListingPinnedMarkers).toEqual(new Set())
        const markerFacts = preparationRequests[1].subject.namespaceSearches?.[0]
        expect(markerFacts).toMatchObject({
          searchId: 'sc2-map-marker-documents',
          state: expect.stringMatching(/^(?:complete|truncated)$/u),
        })
        if (markerFacts === undefined) throw new Error('coordinator did not return marker facts')
        expect(markerFacts.entries.length).toBeGreaterThan(0)
        expect(markerFacts.entries.length).toBeLessThanOrEqual(productMaxSubjectEntries)
        const pinned = selection.candidates.find(
          candidate => candidate.sourcePath === pinnedMapRoot,
        )
        if (pinned === undefined) {
          throw new Error(
            `bounded installed selection omitted ${pinnedMapRoot}; offered ${selection.candidates.length} candidate(s)`,
          )
        }

        const opened = await coordinate(pinned.candidateId)
        expect(
          opened.state,
          opened.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
        ).toBe('opened')
        if (opened.state !== 'opened') throw new Error('selected installed map did not open')
        openedPreview = opened.session
        expect(opened.snapshot).toMatchObject({
          gameId: 'org.modkitx/starcraft-2',
          mapId: pinnedMapRoot,
        })
        expect(preparationRequests).toHaveLength(4)
        expect(preparationRequests[3].selectionId).toBe(pinned.candidateId)

        console.info(
          `[sc2-map-preview] root entries=${rootFacts.entries.length}/${rootFacts.state}; indexed markers=${markerFacts.entries.length}/${markerFacts.state}; candidates=${selection.candidates.length}; selected=${pinned.candidateId}; world=${opened.state}`,
        )
      } finally {
        if (openedPreview !== undefined) await openedPreview.dispose()
        else if (casc?.state === 'opened') await casc.session.dispose()
        await vfs.dispose()
        if (previewResolution?.state === 'resolved') await previewResolution.release()
        await discoveryResolution.release()
      }
    }, 120_000)
  },
)

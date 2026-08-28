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
  openSubject,
  registerServiceDefinitionsOrThrow,
  resolveGameInstallationDiscovery,
  resolveMapPreviewPreparation,
} from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'
import type { NamespaceEntrySource, ResourceBudget } from '@modkitx-x3/sdk'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')
const sc2Override = process.env.MODKITX_SC2_ROOT?.trim()
const productMaxSubjectEntries = 4_096
const productMaxSubjectPages = 64
const productPageSize = 256
const pinnedMapRoot = 'campaigns/liberty.sc2campaign/base.sc2maps/maps/campaign/tarcade.sc2map'

const budget: ResourceBudget = {
  maxInputBytes: 268_435_456n,
  maxDepth: 128,
  maxNodes: 750_000,
  maxScalarBytes: 134_217_728,
  maxDiagnostics: 100,
}

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

        const namespaceLease = await casc.session.dataSource(
          'common.view/namespace-entry-source',
          1,
        )
        let namespaceState: 'complete' | 'truncated' = 'complete'
        const entries: { path: string; kind: 'file' | 'directory'; size?: string }[] = []
        const prefixEntries: { path: string; kind: 'file' | 'directory'; size?: string }[] = []
        try {
          const namespace = namespaceLease.value as NamespaceEntrySource
          let cursor: string | undefined
          let pages = 0
          do {
            const remaining = productMaxSubjectEntries - entries.length
            if (remaining === 0 || pages >= productMaxSubjectPages) {
              namespaceState = 'truncated'
              break
            }
            const page = await namespace.list('', {
              ...(cursor === undefined ? {} : { cursor }),
              limit: Math.min(remaining, productPageSize),
            })
            pages += 1
            entries.push(
              ...page.items.map(item => ({
                path: item.path,
                kind: item.kind,
                ...(item.size === undefined ? {} : { size: item.size.toString(10) }),
              })),
            )
            cursor = page.nextCursor
          } while (cursor !== undefined)

          cursor = undefined
          pages = 0
          do {
            if (
              prefixEntries.length >= productMaxSubjectEntries ||
              pages >= productMaxSubjectPages
            ) {
              throw new Error('pinned SC2Map prefix exceeds the product namespace budget')
            }
            const page = await namespace.list(`${pinnedMapRoot}/`, {
              ...(cursor === undefined ? {} : { cursor }),
              limit: Math.min(productMaxSubjectEntries - prefixEntries.length, productPageSize),
            })
            pages += 1
            prefixEntries.push(
              ...page.items.map(item => ({
                path: item.path,
                kind: item.kind,
                ...(item.size === undefined ? {} : { size: item.size.toString(10) }),
              })),
            )
            cursor = page.nextCursor
          } while (cursor !== undefined)
        } finally {
          await namespaceLease.release()
        }

        expect(entries).toHaveLength(productMaxSubjectEntries)
        expect(namespaceState).toBe('truncated')
        const subject = {
          schemaVersion: 1 as const,
          subjectUri: casc.descriptor.subjectUri,
          revision: casc.descriptor.revision,
          formatId: 'casc',
          traits: casc.descriptor.traits.map(item => item.id),
          dataSources: casc.descriptor.dataSources.map(item => ({
            contract: item.contract,
            major: item.major,
          })),
          operations: casc.descriptor.operations.map(item => ({ id: item.id, state: item.state })),
          namespace: { state: namespaceState, entries },
        }
        const result = await previewResolution.preparation.prepare({
          subject,
          maxCandidates: 64,
          maxRoots: 32,
          maxDepth: 16,
        })
        const rootListingPinnedMarkers = new Set(
          entries
            .filter(entry => entry.path.startsWith(`${pinnedMapRoot}/`))
            .map(entry => entry.path.slice(pinnedMapRoot.length + 1).toLowerCase()),
        )
        expect(rootListingPinnedMarkers).toEqual(new Set())
        expect(result).toMatchObject({
          state: 'unresolved',
          diagnostics: [{ code: expect.stringMatching(/prefix-discovery-required$/u) }],
        })

        const prefixMarkers = new Set(
          prefixEntries.map(entry => entry.path.slice(pinnedMapRoot.length + 1).toLowerCase()),
        )
        expect([...prefixMarkers]).toEqual(
          expect.arrayContaining(['objects', 'regions', 't3heightmap']),
        )
        const prefixSubject = {
          ...subject,
          namespace: { state: 'truncated' as const, entries: prefixEntries },
        }
        const selection = await previewResolution.preparation.prepare({
          subject: prefixSubject,
          maxCandidates: 64,
          maxRoots: 32,
          maxDepth: 16,
        })
        expect(selection).toMatchObject({
          state: 'selection-required',
          candidates: [{ sourcePath: pinnedMapRoot }],
        })
        if (selection.state !== 'selection-required') {
          throw new Error('bounded TArcade prefix did not produce an explicit selection')
        }
        const pinned = selection.candidates.find(
          candidate => candidate.sourcePath === pinnedMapRoot,
        )
        if (pinned === undefined) throw new Error('pinned TArcade root was not offered')
        const prepared = await previewResolution.preparation.prepare({
          subject: prefixSubject,
          selectionId: pinned.candidateId,
          maxCandidates: 64,
          maxRoots: 32,
          maxDepth: 16,
        })
        expect(prepared).toMatchObject({
          state: 'prepared',
          plan: {
            workspace: { roots: [{ sourcePath: pinnedMapRoot }] },
            resources: {
              strategy: 'subject-namespace',
              roots: [{ rootId: 'map', namespacePrefix: pinnedMapRoot }],
            },
          },
        })

        console.info(
          `[sc2-map-preview] product root listing entries=${entries.length}, result=${result.state}; bounded ${pinnedMapRoot}/ prefix entries=${prefixEntries.length}, selected=${pinned.candidateId}`,
        )
      } finally {
        if (casc?.state === 'opened') await casc.session.dispose()
        await vfs.dispose()
        if (previewResolution?.state === 'resolved') await previewResolution.release()
        await discoveryResolution.release()
      }
    }, 120_000)
  },
)

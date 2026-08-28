import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import { createHostTopology, resolveModWorkspaceGraph } from '@modkitx-x3/sdk'
import {
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  createSubjectServices,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
  type LinkedExtension,
} from '../src/index.js'
import { openFileArtifactSource } from '../src/node/file-artifact-source.js'
import {
  createNodeMapPreviewResourcePlanResolver,
  NODE_GAME_INSTALLATION_ARCHIVE_MAP_PREVIEW_RESOLVER_ID,
} from '../src/node/map-preview-resource-resolver.js'
import { coordinateMapPreviewAssetSession } from '../src/maps/index.js'

const corpusRoot = process.env['MODKITX_WARZONE_ROOT']
const configured =
  typeof corpusRoot === 'string' &&
  existsSync(join(corpusRoot, 'data', 'mp.wz')) &&
  existsSync(join(corpusRoot, 'data', 'base.wz'))
const GAME_ID = 'org.modkitx/warzone-2100'
const MAP_ROOT = 'multiplay/maps/2c-highground'
const budget = {
  maxInputBytes: 1_073_741_824n,
  maxDepth: 128,
  maxNodes: 1_000_000,
  maxScalarBytes: 256 * 1024 * 1024,
  maxDiagnostics: 200,
}

describe.skipIf(!configured)('installed Warzone map-preview resource resolution', () => {
  it('reuses opened mp.wz, opens base.wz normally and reads the pinned map root', async () => {
    if (corpusRoot === undefined) throw new Error('MODKITX_WARZONE_ROOT is not configured')
    const repoRoot = join(import.meta.dirname, '..', '..', '..')
    const { archives } = (await import(
      pathToFileURL(join(repoRoot, 'extensions', 'common', 'archives', 'src', 'linked.js')).href
    )) as { readonly archives: LinkedExtension }
    const { warzone2100 } = (await import(
      pathToFileURL(join(repoRoot, 'extensions', 'opensource', 'warzone-2100', 'src', 'linked.js'))
        .href
    )) as { readonly warzone2100: LinkedExtension }
    const linked = linkedExtensionInputs([archives, warzone2100])
    const executionBackends = createExecutionBackendRegistry([
      linkedInProcessBackend(linked.modules),
    ])
    const operatingSystem =
      process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'
    const realmId = 'org.modkitx.test/map-preview-resource-corpus'
    const topology = createHostTopology({
      schemaVersion: 1,
      topologyId: realmId,
      realms: [
        {
          schemaVersion: 1,
          realmId,
          revision: '1',
          target: { environment: 'node', operatingSystem, architecture: 'x64' },
          facilities: [],
          budgets: {
            maxConcurrentTasks: 2,
            maxWorkerCount: 0,
            maxResidentBytes: uint64('1073741824'),
            maxTransferBytes: uint64('1073741824'),
            defaultDeadlineMs: 120_000,
          },
          policy: { id: `${realmId}/policy`, revision: '1' },
        },
      ],
      links: [],
    })
    const composition = await createHostComposition({
      topology,
      realmId,
      extensions: linked.inputs,
      executionBackends,
    })
    const definitions = createBundledServiceDefinitionRegistry()
    await registerServiceDefinitionsOrThrow(composition.inventory, definitions)
    const services = createSubjectServices({
      inventory: composition.inventory,
      target: composition.target,
      executionBackends,
      serviceDefinitions: definitions,
    })
    const mpPath = join(corpusRoot, 'data', 'mp.wz')
    const opened = await services.open({
      source: await openFileArtifactSource(mpPath),
      path: mpPath,
      intent: 'inspect',
      grant: { id: 'warzone-resource-corpus-open', classes: ['read-source'] },
      budget,
    })
    expect(opened.state).toBe('opened')
    if (opened.state !== 'opened') throw new Error('installed mp.wz did not open')
    const ordinaryOpen = vi.fn(services.open.bind(services))
    const resolver = createNodeMapPreviewResourcePlanResolver({
      subjects: { open: ordinaryOpen },
      configuredPaths: { [GAME_ID]: [corpusRoot] },
      maxInstallationCandidates: 64,
    })
    const workspace = resolveModWorkspaceGraph({
      workspaceId: 'warzone-installed-preview',
      gameId: GAME_ID,
      activeRootId: 'map',
      sources: [
        { sourceId: 'base-source', kind: 'archive', location: 'installed:base' },
        { sourceId: 'mp-source', kind: 'archive', location: 'installed:mp' },
        { sourceId: 'map-source', kind: 'archive', location: 'opened:mp' },
      ],
      roots: [
        {
          rootId: 'base',
          sourceId: 'base-source',
          sourcePath: 'base',
          displayName: 'base.wz',
          kind: 'package',
          dependencies: [],
        },
        {
          rootId: 'mp',
          sourceId: 'mp-source',
          sourcePath: 'mp',
          displayName: 'mp.wz',
          kind: 'package',
          dependencies: [
            { targetRootId: 'base', ref: 'base.wz', required: true, provenance: 'implicit' },
          ],
        },
        {
          rootId: 'map',
          sourceId: 'map-source',
          sourcePath: MAP_ROOT,
          displayName: '2c-highground',
          kind: 'map',
          dependencies: [
            { targetRootId: 'mp', ref: 'mp.wz', required: true, provenance: 'implicit' },
          ],
        },
      ],
      maxRoots: 3,
      maxDepth: 2,
    })
    const result = await resolver.resolve({
      plan: {
        schemaVersion: 1,
        strategy: 'host-resolved',
        resolverId: NODE_GAME_INSTALLATION_ARCHIVE_MAP_PREVIEW_RESOLVER_ID,
        subjectNamespaceRoots: [{ rootId: 'map', namespacePrefix: MAP_ROOT }],
        roots: [
          {
            rootId: 'mp',
            locator: {
              schemaVersion: 1,
              kind: 'game-installation-archive',
              gameId: GAME_ID,
              archiveRelativePaths: ['data/mp.wz', 'mp.wz'],
              openedSubjectPolicy: 'prefer-matching-opened-subject',
            },
          },
          {
            rootId: 'base',
            locator: {
              schemaVersion: 1,
              kind: 'game-installation-archive',
              gameId: GAME_ID,
              archiveRelativePaths: ['data/base.wz', 'base.wz'],
              openedSubjectPolicy: 'installation-only',
            },
          },
        ],
      },
      subject: {
        schemaVersion: 1,
        subjectUri: (await opened.session.descriptor()).subjectUri,
        revision: String(opened.session.revision),
        formatId: 'warzone-wz',
        traits: [],
        dataSources: [{ contract: 'common.view/namespace-entry-source', major: 1 }],
        operations: [{ id: 'container.extract', state: 'available' }],
        namespace: { state: 'unavailable', entries: [] },
      },
      workspace,
      original: opened.session,
      services: { ...composition, serviceDefinitions: definitions },
      grant: {
        id: 'warzone-resource-corpus',
        classes: ['read-source', 'filesystem-read', 'process-launch'],
      },
      budgets: budget,
    })
    expect(
      result.state,
      result.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
    ).toBe('resolved')
    if (result.state !== 'resolved') throw new Error('installed resources did not resolve')
    try {
      expect(ordinaryOpen).toHaveBeenCalledOnce()
      expect(ordinaryOpen.mock.calls[0]?.[0].path.replace(/\\/gu, '/')).toContain('/data/base.wz')
      const gameMap = await result.origin.open(`${MAP_ROOT}/game.map`)
      try {
        if (gameMap.value.kind !== 'bytes') throw new Error('game.map did not open as bytes')
        const bytes = await gameMap.value.read(0n, Number(gameMap.value.size ?? 0n))
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(
          'c03e17c13a837339a1b8066047385758539cdc14ef903d806fcf871d30409111',
        )
      } finally {
        await gameMap.release()
      }
    } finally {
      await result.release()
    }

    let previewSession: { dispose(): Promise<void> } | undefined
    try {
      const previewRequest = {
        services: { ...composition, serviceDefinitions: definitions },
        grant: {
          id: 'warzone-coordinated-preview-corpus',
          classes: ['read-source', 'filesystem-read', 'process-launch'],
        },
        budgets: budget,
        original: opened.session,
        resourcePlanResolver: resolver,
        maxCandidates: 64,
        maxSubjectEntries: 4096,
        maxSubjectPages: 32,
        maxRoots: 3,
        maxDepth: 2,
        limits: {
          maxRequirements: 8,
          maxDocuments: 8,
          maxDocumentBytes: 16 * 1024 * 1024,
          maxTotalBytes: 32 * 1024 * 1024,
          maxObjects: 100_000,
          maxRegions: 10_000,
          maxTerrainCells: 65_536,
          maxTerrainSamples: 65_536,
          maxDepth: 64,
          maxPageSize: 256,
          maxDiagnostics: 200,
        },
      } as const
      const selection = await coordinateMapPreviewAssetSession(previewRequest)
      expect(selection.state).toBe('selection-required')
      if (selection.state !== 'selection-required') {
        throw new Error('installed mp.wz did not expose map selection')
      }
      const selected = selection.candidates.find(candidate => candidate.sourcePath === MAP_ROOT)
      expect(selected).toBeDefined()
      if (selected === undefined) throw new Error('2c-highground selection is absent')
      const preview = await coordinateMapPreviewAssetSession({
        ...previewRequest,
        selectionId: selected.candidateId,
      })
      expect(
        preview.state,
        preview.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
      ).toBe('opened')
      if (preview.state !== 'opened') throw new Error('coordinated Warzone preview did not open')
      previewSession = preview.session
      expect(preview.snapshot.semantic.mapId).toBe(MAP_ROOT)
      expect(preview.snapshot.semantic.objects).toHaveLength(177)
      const terrainSource = preview.snapshot.terrainTransform?.source
      expect(
        terrainSource !== undefined && 'format' in terrainSource ? terrainSource.format : undefined,
      ).toBe('warzone-game-map')
      expect(ordinaryOpen).toHaveBeenCalledTimes(2)
    } finally {
      if (previewSession === undefined) await opened.session.dispose()
      else await previewSession.dispose()
    }
  }, 120_000)
})

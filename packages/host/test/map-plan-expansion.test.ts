import { expect, it } from 'vitest'
import { diagnostic } from '@modkit/core'
import { revisionId } from '@modkit/sdk'
import type { ModWorkspaceLock, ResourceSessionPort } from '@modkit/sdk'
import type { ResolvedMapWorkspaceAnalysis, ResolvedMapWorkspaceAnalysisRequest, ResolvedMapWorkspacePlan, ResolvedMapWorkspacePlanExpansionRequest } from '@modkit/sdk/maps'
import { analyzeResolvedMapWorkspace } from '../src/maps/index.js'
import { buildInventory, createBundledServiceDefinitionRegistry, createExecutionBackendRegistry, createHostContributionContractRegistry,
  defineLinkedExtension, linkedExtensionInputs, linkedInProcessBackend, registerServiceDefinitionsOrThrow } from '../src/index.js'

const workspace = { schemaVersion: 1, workspaceId: 'test/planning', gameId: 'test/map', activeRootId: 'map', sources: [],
  loadOrder: [{ rootId: 'map', sourceId: 'memory', sourcePath: 'maps/Example', displayName: 'Example' }], dependencyOrder: [], diagnostics: [], complete: true } as unknown as ModWorkspaceLock
const main = { requirementId: 'mission', path: 'maps/Example/mission.json', kind: 'terrain-native-parameters' as const, required: true }
const dependency = { requirementId: 'attributes', path: 'data/attributes.bin', kind: 'terrain-native-parameters' as const, required: true, scope: 'workspace' as const }
const plan: ResolvedMapWorkspacePlan = { schemaVersion: 1, workspaceId: workspace.workspaceId, gameId: workspace.gameId,
  mapId: 'maps/Example', analyzerId: 'test/map', requirements: [main], diagnostics: [], complete: true }
type Expand = NonNullable<ResolvedMapWorkspaceAnalysis['expandPlan']>
async function fixture(expandPlan?: Expand, changes: { maxRequirements?: number; maxTotalBytes?: number; files?: Map<string, Uint8Array>; signal?: AbortSignal } = {}) {
  const observed: ResolvedMapWorkspaceAnalysisRequest[] = [], reads: string[] = [], released: string[] = []
  let providerReleases = 0
  const provider: ResolvedMapWorkspaceAnalysis = { contract: 'common.map/resolved-workspace', analyzerId: 'test/map', gameIds: ['test/map'],
    plan: async () => structuredClone(plan), ...(expandPlan === undefined ? {} : { expandPlan }),
    analyze: async request => {
      observed.push(request)
      const base = { schemaVersion: 1 as const, workspaceId: request.workspaceId, gameId: request.gameId, mapId: request.mapId, analyzerId: 'test/map' }
      return { ...base, snapshotId: request.snapshotId,
        semantic: { ...base, documentPaths: request.documents.map(document => document.path), regions: [], objects: [], catalogQueries: [], resolvedCatalogObjects: 0, diagnostics: [], complete: true },
        worldCandidate: { contract: 'test/map-world', major: 1, maturity: 'publisher-candidate', coordinateSpaces: [], crossSpaceTransforms: [], unknownFacets: [] },
        unresolvedRequirementIds: request.unresolvedRequirementIds, diagnostics: [], diagnosticsTruncated: false, complete: true }
    } }
  const linked = linkedExtensionInputs([defineLinkedExtension({ source: 'linked:test/map-plan-expansion',
    packageJson: { name: 'modkit-test-map-plan', version: '1.0.0', license: 'MIT', type: 'module', modkit: { schemaVersion: 1, publisher: 'modkit.test', id: 'map-plan', contributionManifests: ['./provider.json'] } },
    contributions: [{ path: 'provider.json', manifest: { schemaVersion: 1, contract: { id: 'modkit/service-provider-contribution', major: 1 }, id: 'modkit.test/map-plan', displayName: 'Map planner fixture',
      runtimeVariants: [{ variantId: 'trusted-node', entrypoint: './provider.js', target: { environments: ['node'] }, executionProfile: 'trusted-in-process', requestedPermissionClasses: [] }],
      spec: { provides: [{ offerId: 'maps', contract: 'common.map/resolved-workspace', major: 1, version: '1.0.0', facet: { gameIds: ['test/map'] } }], lifecycleScope: 'session' } } }],
    modules: { './provider.js': { abiVersion: 1, provides: ['common.map/resolved-workspace'], createProvider: async () => ({ value: provider, release: async () => { providerReleases++ } }) } },
  })])
  const inventory = await buildInventory(linked.inputs, createHostContributionContractRegistry())
  const definitions = createBundledServiceDefinitionRegistry(); await registerServiceDefinitionsOrThrow(inventory, definitions)
  const files = changes.files ?? new Map([[main.path, Uint8Array.of(1)], [dependency.path, Uint8Array.of(2, 3)]])
  const resources = { revision: revisionId('provider-token:resource-1'), state: () => 'live', provenance: () => [],
    resolve: async ({ logicalId }: { logicalId: string }) => {
      reads.push(logicalId); const bytes = files.get(logicalId)
      if (bytes === undefined) return { state: 'unresolved', diagnostic: diagnostic('warning', 'test/missing', logicalId) }
      return { state: 'resolved', revision: revisionId('provider-token:file-1'), lease: { value: { kind: 'bytes', size: BigInt(bytes.length),
        async *stream() { yield bytes.slice() } }, release: async () => { released.push(logicalId) } } }
    } } as unknown as ResourceSessionPort
  const result = await analyzeResolvedMapWorkspace({ services: { inventory, serviceDefinitions: definitions,
    executionBackends: createExecutionBackendRegistry([linkedInProcessBackend(linked.modules)]), target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } },
    workspace, resources, grant: { id: 'test', classes: ['read-source'] }, budgets: { maxInputBytes: 1024n, maxScalarBytes: 1024, maxNodes: 128, maxDepth: 32, maxDiagnostics: 64 },
    limits: { maxRequirements: changes.maxRequirements ?? 8, maxTotalBytes: changes.maxTotalBytes ?? 128, maxDocumentBytes: Math.min(64, changes.maxTotalBytes ?? 128), maxObjects: 8, maxRegions: 8, maxTerrainCells: 8, maxTerrainSamples: 8, maxPageSize: 8, maxDepth: 16, maxDiagnostics: 64 },
    ...(changes.signal === undefined ? {} : { signal: changes.signal }),
  })
  return { result, observed, reads, released, providerReleases: () => providerReleases }
}
const expand: Expand = async request => request.plan.requirements.length > 1 ? request.plan
  : { ...request.plan, requirements: [...request.plan.requirements, dependency] }

it('uses the registered optional ABI method and one reader, with cumulative identity and lease accounting', async () => {
  const rounds: ResolvedMapWorkspacePlanExpansionRequest[] = []
  const f = await fixture(async request => { rounds.push(request); return expand(request) })
  expect(f.result.state, JSON.stringify(f.result.diagnostics)).toBe('resolved')
  expect(rounds.map(round => round.documents.length)).toEqual([1, 2])
  expect(f.reads).toEqual([main.path, dependency.path]); expect(f.released).toEqual(f.reads)
  expect(f.observed[0]?.documents.map(document => [...document.bytes])).toEqual([[1], [2, 3]])
  expect(f.observed[0]?.snapshotId).toContain('data/attributes.bin@provider-token:file-1#sha256:')
  if (f.result.state === 'resolved') { expect(f.result.plan.requirements).toHaveLength(2); await f.result.release() }
  expect(f.providerReleases()).toBe(1)
})
it('keeps a provider without expansion on the existing one-plan path', async () => {
  const f = await fixture(); expect(f.result.state, JSON.stringify(f.result.diagnostics)).toBe('resolved')
  expect(f.reads).toEqual([main.path]); if (f.result.state === 'resolved') await f.result.release()
  expect(f.providerReleases()).toBe(1)
})
it('refuses mutation of prior reads, analyzer, window, duplicate paths and non-confined dependencies before reading them', async () => {
  for (const mutate of [
    (p: ResolvedMapWorkspacePlan) => ({ ...p, requirements: [{ ...main, path: 'maps/Example/other.json' }] }),
    (p: ResolvedMapWorkspacePlan) => ({ ...p, analyzerId: 'other/map' }),
    (p: ResolvedMapWorkspacePlan) => ({ ...p, window: { minimumX: 0, minimumY: 0, maximumX: 1, maximumY: 1 } }),
    (p: ResolvedMapWorkspacePlan) => ({ ...p, requirements: [] }),
    (p: ResolvedMapWorkspacePlan) => ({ ...p, requirements: [...p.requirements, { ...dependency, path: main.path }] }),
    (p: ResolvedMapWorkspacePlan) => ({ ...p, requirements: [...p.requirements, { ...dependency, path: 'data/../outside.bin' }] }),
  ]) {
    const f = await fixture(async request => mutate(request.plan)); expect(f.result.state).toBe('unresolved')
    expect(f.reads).toEqual([main.path]); expect(f.released).toEqual([main.path]); expect(f.providerReleases()).toBe(1)
  }
})
it('applies document count and byte limits across all stages and preserves unresolved optional reads', async () => {
  const limited = await fixture(expand, { maxRequirements: 1 }); expect(limited.result.state).toBe('unresolved'); expect(limited.reads).toEqual([main.path])
  const bytes = await fixture(expand, { maxTotalBytes: 2 }); expect(bytes.observed[0]?.unresolvedRequirementIds).toEqual(['attributes'])
  expect(bytes.released).toEqual([main.path, dependency.path]); if (bytes.result.state === 'resolved') await bytes.result.release()
  const optional = await fixture(async request => request.plan.requirements.length > 1 ? request.plan
    : { ...request.plan, requirements: [...request.plan.requirements, { ...dependency, required: false }] }, { files: new Map([[main.path, Uint8Array.of(1)]]) })
  expect(optional.observed[0]?.unresolvedRequirementIds).toEqual(['attributes']); expect(optional.observed[0]?.requiredRequirementIds).toEqual(['mission'])
  expect(optional.reads).toEqual([main.path, dependency.path]); if (optional.result.state === 'resolved') await optional.result.release()
})

it('bounds an ever-growing plan by cumulative requirements rather than resetting its allowance', async () => {
  let rounds = 0
  const f = await fixture(async request => {
    rounds++
    return { ...request.plan, requirements: [...request.plan.requirements,
      { ...dependency, requirementId: `dependency-${rounds}`, path: `data/dependency-${rounds}.bin`, required: false }] }
  }, { maxRequirements: 3 })
  expect(f.result.state).toBe('unresolved'); expect(rounds).toBe(3)
  expect(f.reads).toEqual([main.path, 'data/dependency-1.bin', 'data/dependency-2.bin'])
  expect(f.providerReleases()).toBe(1)
})

it('includes newly discovered bytes in identity even when their provider revision is unchanged', async () => {
  const first = await fixture(expand)
  const second = await fixture(expand, { files: new Map([[main.path, Uint8Array.of(1)], [dependency.path, Uint8Array.of(2, 4)]]) })
  expect(first.observed[0]?.snapshotId).not.toEqual(second.observed[0]?.snapshotId)
  expect(first.observed).toHaveLength(1); expect(second.observed).toHaveLength(1)
  if (first.result.state === 'resolved') await first.result.release()
  if (second.result.state === 'resolved') await second.result.release()
})

it('cancels during expansion without issuing the newly requested read', async () => {
  const controller = new AbortController()
  await expect(fixture(async request => {
    controller.abort(new Error('cancel-expansion'))
    return expand(request)
  }, { signal: controller.signal })).rejects.toThrow('cancel-expansion')
})

it('keeps the read identities and bytes owned across the optional service ABI', async () => {
  const f = await fixture(async request => {
    request.documents[0]!.bytes[0] = 99
    return request.plan
  })
  expect(f.observed[0]?.documents[0]?.bytes).toEqual(Uint8Array.of(1))
  if (f.result.state === 'resolved') await f.result.release()
  const changed = await fixture(async request => {
    Object.assign(request.plan.requirements[0]!, { path: 'maps/Example/retargeted.json' })
    return request.plan
  })
  expect(changed.result.state).toBe('unresolved')
  expect(changed.reads).toEqual([main.path]); expect(changed.providerReleases()).toBe(1)
})

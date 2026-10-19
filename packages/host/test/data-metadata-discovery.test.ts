/** Data capture coordination: real ResourceSession and activated service boundary. */
import { describe, expect, it, vi } from 'vitest'
import { uint64 } from '@modkit/core'
import { createHostTopology, revisionId, type ArtifactSource, type ModWorkspaceLock,
  type TreeDataSource, type TableDataSource, type RelationGraphSource, type Lease } from '@modkit/sdk'
import { RESOLVED_DATA_WORKSPACE_CONTRACT, resolveDataCatalog } from '@modkit/sdk/data'
import type { DataWorkspacePlan, DataWorkspacePlanRequest, DataWorkspaceDocumentRequirement,
  ResolvedDataWorkspaceAnalysisRequest, ResolvedDataWorkspaceSnapshot } from '@modkit/sdk/data'
import { createBundledServiceDefinitionRegistry, createExecutionBackendRegistry, createHostComposition,
  defineLinkedExtension, linkedExtensionInputs, linkedInProcessBackend, registerServiceDefinitionsOrThrow } from '@modkit/host'
import type { CompanionOrigin } from '../src/input-resolution.js'
import { createResourceSession } from '../src/resource-session.js'
import { planDataWorkspace, analyzeResolvedDataWorkspace, type DataHostServices } from '../src/data/index.js'

const workspace = { workspaceId: 'fixture', gameId: 'fixture-game', activeRootId: 'mod',
  loadOrder: [{ rootId: 'base', sourcePath: 'base' }, { rootId: 'mod', sourcePath: 'mod' }],
} as unknown as ModWorkspaceLock
const request = { workspace, locales: [], maxRequirements: 64,
  intent: { kind: 'capture-inputs' as const, documentKinds: ['catalog', 'usage'] as const } }
type Context = NonNullable<Parameters<typeof planDataWorkspace>[3]>
type Discovery = NonNullable<DataWorkspacePlan['discovery']>

/** A transport fixture, not a game adapter: the SDK owns its empty catalog and leases own all facets. */
async function activatedFixture(options: { interleave?: boolean; mutatePlan?: boolean; mutateAnalysis?: boolean;
  failFacet?: number; beforeAnalysis?: () => void; beforeFacet?: (index: number) => void | Promise<void> } = {}) {
  const paths = ['base/main.rules', 'mod/main.rules', 'base/categories.rules', 'mod/categories.rules']
  const source = fixture({ 'base/manifest': 'ABCD', ...Object.fromEntries(paths.map((path, index) => [path, `rule-${index}`])) })
  const binary = Uint8Array.of(0, 255, 1, 42)
  const streams: string[] = [], sourceBuffers: Uint8Array[] = []
  const originalResolve = source.resources.resolve.bind(source.resources)
  const resources: typeof source.resources = { ...source.resources, async resolve(...args) {
    const loaded = await originalResolve(...args)
    if (loaded.state !== 'resolved') return loaded
    const asset = loaded.lease.value
    if (asset.kind !== 'bytes') return loaded
    const name = args[0].logicalId
    return { ...loaded, lease: { ...loaded.lease, value: { ...asset,
      async *stream() {
        streams.push(name)
        if (name === 'base/manifest') { sourceBuffers.push(binary); yield binary; binary.fill(66) }
        else yield* asset.stream()
      } } } }
  } }
  const workspace: ModWorkspaceLock = { schemaVersion: 1, workspaceId: 'fixture', gameId: 'fixture-game', activeRootId: 'mod',
    sources: [], loadOrder: [{ rootId: 'base', sourceId: 'fixture', sourcePath: 'base', displayName: 'Base', kind: 'dependency', dependencies: [] },
      { rootId: 'mod', sourceId: 'fixture', sourcePath: 'mod', displayName: 'Mod', kind: 'primary', dependencies: [] }],
    dependencyOrder: [], diagnostics: [], complete: true }
  const held = new Set<number>(), closed: number[] = []
  const calls: DataWorkspacePlanRequest[] = [], analyses: ResolvedDataWorkspaceAnalysisRequest[] = []
  let creates = 0, releases = 0, facetIndex = 0, lastPlan = '', services: DataHostServices
  const never = async (): Promise<never> => { throw new Error('empty transport facet is not queried') }
  const tree: TreeDataSource = { root: never, facts: never, children: async () => ({ items: [] }), async *search() {} }
  const table: TableDataSource = { shape: async () => ({ rows: 0, columns: 0 }), cell: never,
    rows: async () => ({ items: [] }), async *search() {} }
  const graph: RelationGraphSource = { summary: never, nodes: async () => ({ items: [] }), edges: async () => ({ items: [] }) }
  const open = async <T>(value: T): Promise<Lease<T>> => {
    const index = ++facetIndex
    if (index === options.failFacet) throw new Error(`fixture facet failure ${index}`)
    held.add(index)
    await options.beforeFacet?.(index)
    return { value, release: async () => { if (held.delete(index)) closed.push(index) } }
  }
  const terminal = (): DataWorkspacePlan => ({ schemaVersion: 1, workspaceId: workspace.workspaceId, gameId: workspace.gameId,
    analyzerId: 'fixture-data', complete: true, diagnostics: [], requirements: paths.map((path, index) =>
      ({ requirementId: `semantic-${index}`, rootId: path.split('/')[0]!, path, kind: 'catalog' })),
    discovery: { state: 'terminal', documentKinds: ['catalog'], catalogOrder: 'provider-authored' } })
  const revision = revisionId('provider-token:fixture-catalog')
  const adapter = { id: 'org.modkit.test/capture-transport', version: '1.0.0' }
  const provider = {
    contract: RESOLVED_DATA_WORKSPACE_CONTRACT, providerId: 'fixture-data', gameIds: ['fixture-game'],
    async plan(value: DataWorkspacePlanRequest): Promise<DataWorkspacePlan> {
      calls.push(value)
      lastPlan = value.intent?.kind ?? 'editor'
      if (value.intent?.kind !== 'capture-inputs') {
        const { discovery: _discovery, ...editor } = terminal()
        return { ...editor, requirements: [] }
      }
      if (!value.metadata?.length) return { ...terminal(), requirements: [],
        discovery: { state: 'expand', metadataRequirements: [{ requirementId: 'manifest', rootId: 'base', path: 'base/manifest', encoding: 'binary' }] } }
      const observed = value.metadata[0]!
      if (observed.state !== 'present') throw new Error('fixture needs captured metadata')
      expect(observed.document.bytes).toBeInstanceOf(Uint8Array)
      expect([...observed.document.bytes]).toEqual([0, 255, 1, 42])
      if (options.mutatePlan) observed.document.bytes.fill(77)
      if (options.interleave) {
        const editor = await analyzeResolvedDataWorkspace({ ...requestFor(), intent: { kind: 'editor' } })
        expect(editor.state).toBe('unresolved')
      }
      return terminal()
    },
    async analyze(value: ResolvedDataWorkspaceAnalysisRequest): Promise<ResolvedDataWorkspaceSnapshot> {
      analyses.push(value)
      expect(value.intent).toMatchObject({ kind: 'capture-inputs', catalogOrder: 'provider-authored' })
      expect(value.plannedDocumentCount).toBe(4)
      expect(value.documents.map(doc => doc.path)).toEqual(paths)
      const metadata = value.metadata![0]!
      if (metadata.state !== 'present') throw new Error('metadata expected')
      expect(metadata.document.bytes).toBeInstanceOf(Uint8Array)
      const received = [...metadata.document.bytes]
      expect(received).toEqual([0, 255, 1, 42])
      if (options.interleave) expect(lastPlan).toBe('editor')
      if (options.mutateAnalysis) metadata.document.bytes.fill(88)
      options.beforeAnalysis?.()
      return resolveDataCatalog({ workspaceId: workspace.workspaceId, gameId: workspace.gameId, analyzerId: 'fixture-data',
        schemas: [], patches: [], queries: [], maxEntities: 128, maxDepth: 32, includeWorkspaceFacets: true,
        snapshotId: 'fixture:captured', ownerMetadata: { received, lastPlan },
        projectionPlan: { adapter, subjectRevision: revision, facets: [] },
        projectionReceipt: { form: 'local', adapter, subjectRevision: revision, companions: [],
          basis: { handedness: 'right', upAxis: 'y', forwardAxis: '+z', unit: 'source-unit' },
          planes: [], evidence: [], confidence: 'exact' } }) as ResolvedDataWorkspaceSnapshot
    },
    openSchemaTree: () => open(tree), openDefinitionTable: () => open(table),
    openLocalizationTable: () => open(table), openRelations: () => open(graph),
    resolveEditTarget: never, planEdit: never, planIsolation: never,
  }
  const extension = defineLinkedExtension({ source: 'linked:test/capture-final-analysis', packageJson: {
    name: 'modkit-test-capture-final-analysis', version: '1.0.0', type: 'module', license: 'MIT', description: 'Data capture transport fixture.',
    modkit: { schemaVersion: 1, publisher: 'org.modkit.test', id: 'capture-final-analysis', contributionManifests: ['./contributions/data.json'] } },
    contributions: [{ path: 'contributions/data.json', manifest: { schemaVersion: 1,
      contract: { id: 'modkit/service-provider-contribution', major: 1 }, id: 'org.modkit.test/capture-final-data', displayName: 'Capture transport',
      runtimeVariants: [{ variantId: 'trusted-node', entrypoint: './src/provider.js', target: { environments: ['node'] },
        executionProfile: 'trusted-in-process', requestedPermissionClasses: [] }], spec: { lifecycleScope: 'session', provides: [{
        offerId: 'capture-final-data-v1', contract: 'common.data/resolved-workspace', major: 1, version: '1.0.0', facet: { gameIds: ['fixture-game'] } }] } } }],
    modules: { './src/provider.js': { abiVersion: 1, provides: ['common.data/resolved-workspace'],
      createProvider: () => { creates++; return { value: provider, release: async () => { releases++ } } } } } })
  const linked = linkedExtensionInputs([extension]), realmId = 'org.modkit.test/capture-final-host'
  const topology = createHostTopology({ schemaVersion: 1, topologyId: 'org.modkit.test/capture-final-topology', realms: [{
    schemaVersion: 1, realmId, revision: '1', target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
    facilities: [], budgets: { maxConcurrentTasks: 4, maxWorkerCount: 0, maxResidentBytes: uint64('134217728'),
      maxTransferBytes: uint64('16777216'), defaultDeadlineMs: 10000 }, policy: { id: 'org.modkit.test/capture-final-policy', revision: '1' } }], links: [] })
  const composition = await createHostComposition({ topology, realmId, extensions: linked.inputs,
    executionBackends: createExecutionBackendRegistry([linkedInProcessBackend(linked.modules)]) })
  const serviceDefinitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(composition.inventory, serviceDefinitions)
  services = { ...composition, serviceDefinitions, preferTrustedInProcess: true }
  function requestFor(): Parameters<typeof analyzeResolvedDataWorkspace>[0] { return { services,
    grant: { id: 'fixture-data-capture', classes: [] }, budgets: { maxInputBytes: 1000000n, maxDepth: 128,
      maxNodes: 100000, maxScalarBytes: 1000000, maxDiagnostics: 100 }, workspace, resources, locales: [], queries: [],
    intent: { kind: 'capture-inputs', documentKinds: ['catalog'], catalogOrder: 'provider-authored' },
    limits: { maxRequirements: 64, maxDocumentBytes: 4096, maxTextBytes: 4096, maxEntities: 128, maxDepth: 64, maxPageSize: 16 } } }
  return { ...source, resources, workspace, calls, analyses, held, closed, streams, sourceBuffers,
    requestFor, creates: () => creates, releases: () => releases }
}

describe('activated final capture analysis', () => {
  it('passes owned binary metadata after a same-workspace editor plan without rereading or edit callbacks', async () => {
    const nativeClone = globalThis.structuredClone
    const retained: NonNullable<Context['captured']>[] = []
    const spy = vi.spyOn(globalThis, 'structuredClone').mockImplementation(function<T>(value: T, options?: Parameters<typeof nativeClone>[1]): T {
      const result = nativeClone(value, options)
      const candidate = result as Record<string, unknown> | null
      if (candidate && Array.isArray(candidate['inputs']) && Array.isArray(candidate['metadata']) && candidate['usage'])
        retained.push(result as unknown as NonNullable<Context['captured']>)
      return result
    })
    const f = await activatedFixture({ interleave: true, mutatePlan: true, mutateAnalysis: true })
    try {
      const result = await analyzeResolvedDataWorkspace(f.requestFor())
      expect(result.state).toBe('resolved')
      if (result.state !== 'resolved') throw new Error(JSON.stringify(result.diagnostics))
      expect(f.streams).toEqual(['base/manifest', 'base/main.rules', 'mod/main.rules', 'base/categories.rules', 'mod/categories.rules'])
      expect(f.analyses).toHaveLength(1)
      expect(retained).toHaveLength(1)
      const metadata = retained[0]!.metadata[0]!
      if (metadata.state !== 'present') throw new Error('expected retained binary metadata')
      expect([...metadata.document.bytes]).toEqual([0, 255, 1, 42])
      expect([...retained[0]!.inputs[0]!.bytes]).toEqual([0, 255, 1, 42])
      expect([...f.sourceBuffers[0]!]).toEqual([66, 66, 66, 66])
      expect(retained[0]!.usage.bytes).toBe(28)
      expect(result.snapshot.ownerMetadata).toEqual({ received: [0, 255, 1, 42], lastPlan: 'editor' })
      for (const name of ['resolveEditTarget', 'planEdit', 'buildEditChange', 'planIsolation', 'buildIsolationChange'])
        expect(result).not.toHaveProperty(name)
      expect(f.held.size).toBe(4)
      await result.release(); await result.release()
      expect(f.held.size).toBe(0); expect(f.closed).toHaveLength(4)
      expect(f.releases()).toBe(f.creates())
      expect(f.outstanding()).toBe(0)
    } finally { spy.mockRestore(); await f.resources.dispose() }
  })

  it('releases earlier facets and the activated provider when a later facet fails', async () => {
    const f = await activatedFixture({ failFacet: 3 })
    try {
      const result = await analyzeResolvedDataWorkspace(f.requestFor())
      expect(result.state).toBe('unresolved')
      expect(f.closed.sort()).toEqual([1, 2]); expect(f.held.size).toBe(0)
      expect(f.releases()).toBe(f.creates()); expect(f.outstanding()).toBe(0)
    } finally { await f.resources.dispose() }
  })

  it('rejects writable capture requests before resolving a provider or reading sources', async () => {
    const f = await activatedFixture()
    try {
      const value = { ...f.requestFor(), writableRoots: [{ rootId: 'base' }] } as unknown as Parameters<typeof analyzeResolvedDataWorkspace>[0]
      await expect(analyzeResolvedDataWorkspace(value)).rejects.toThrow('writable')
      expect(f.creates()).toBe(0); expect(f.streams).toEqual([])
    } finally { await f.resources.dispose() }
  })

  for (const at of ['analysis', 'facet'] as const) it(`releases the activated operation on cancellation during ${at}`, async () => {
    const abort = new AbortController()
    const f = await activatedFixture(at === 'analysis' ? { beforeAnalysis: () => abort.abort() }
      : { beforeFacet: index => { if (index === 2) abort.abort() } })
    try {
      await expect(analyzeResolvedDataWorkspace({ ...f.requestFor(), signal: abort.signal })).rejects.toThrow()
      expect(f.analyses).toHaveLength(1)
      expect(f.held.size).toBe(0); expect(f.outstanding()).toBe(0)
      expect(f.releases()).toBe(f.creates())
    } finally { await f.resources.dispose() }
  })

  it('does not reset the metadata byte allowance before semantic acquisition', async () => {
    const f = await activatedFixture()
    try {
      const value = f.requestFor()
      const result = await analyzeResolvedDataWorkspace({ ...value, limits: { ...value.limits, maxTextBytes: 27 } })
      expect(result.state).toBe('unresolved')
      expect(f.analyses).toHaveLength(0); expect(f.held.size).toBe(0)
      expect(f.releases()).toBe(f.creates()); expect(f.outstanding()).toBe(0)
    } finally { await f.resources.dispose() }
  })

  it('releases acquired facets when the ResourceSession closes before publication', async () => {
    const f = await activatedFixture({ beforeFacet: async index => { if (index === 2) await f.resources.dispose() } })
    try {
      const result = await analyzeResolvedDataWorkspace(f.requestFor())
      expect(result.state).toBe('unresolved')
      expect(f.closed.sort()).toEqual([1, 2]); expect(f.held.size).toBe(0)
      expect(f.releases()).toBe(f.creates()); expect(f.outstanding()).toBe(0)
    } finally { await f.resources.dispose() }
  })
})

describe('private provider-authored capture order handshake', () => {
  const paths = ['base/main.rules', 'mod/main.rules', 'base/categories.rules', 'mod/categories.rules']
  const documents = paths.map((path, index) => ({ requirementId: `ordered-${index}`, rootId: path.split('/')[0]!,
    path, kind: 'catalog' as const }))
  const explicit = { ...request, intent: { kind: 'capture-inputs' as const, documentKinds: ['catalog'] as const,
    catalogOrder: 'provider-authored' as const } }
  const terminal = (): DataWorkspacePlan => answer({ state: 'terminal', documentKinds: ['catalog'],
    catalogOrder: 'provider-authored' }, documents)
  const files = () => Object.fromEntries(paths.map((path, index) => [path, `rule ${index}`]))

  it('retains the provider sequence in captured documents without an ordinal map', async () => {
    const f = fixture(files()), c = f.context()
    try {
      const plan = await planDataWorkspace({ plan: async () => terminal() }, explicit, undefined, c)
      expect(plan.requirements.map(row => row.path)).toEqual(paths)
      expect(c.captured!.documents.map(row => row.document.path)).toEqual(paths)
      expect(f.streams).toEqual(paths)
      expect(c.captured!.documents.map(row => row.document.text)).toEqual(paths.map((_, index) => `rule ${index}`))
      expect(c.captured!.documents.every(row => !('semanticIndex' in row.document))).toBe(true)
      expect(f.outstanding()).toBe(0)
    } finally { await f.resources.dispose() }
  })

  it('retains the old dependency-first guard for omitted or explicit default capture policy', async () => {
    for (const catalogOrder of [undefined, 'dependency-first' as const]) {
      const f = fixture(files()), c = f.context()
      try {
        const value = { ...explicit, intent: { kind: 'capture-inputs' as const, documentKinds: ['catalog'] as const,
          ...(catalogOrder === undefined ? {} : { catalogOrder }) } }
        await expect(planDataWorkspace({ plan: async () => answer({ state: 'terminal', documentKinds: ['catalog'],
          ...(catalogOrder === undefined ? {} : { catalogOrder }) }, documents) }, value, undefined, c))
          .rejects.toThrow('dependency-first')
        expect(f.streams).toEqual([]); expect(c.captured).toBeUndefined()
      } finally { await f.resources.dispose() }
    }
  })

  for (const [requested, offered] of [[undefined, 'provider-authored'], ['provider-authored', undefined],
    ['provider-authored', 'dependency-first'], ['dependency-first', 'provider-authored'],
    ['unknown', 'provider-authored'], ['provider-authored', 'unknown']] as const)
    it(`refuses order handshake ${String(requested)} → ${String(offered)} before semantic reads`, async () => {
      const f = fixture(files()), c = f.context()
      try {
        // Unknown strings deliberately cross the runtime boundary, rather than widening SDK types.
        const value = { ...explicit, intent: { ...explicit.intent,
          ...(requested === undefined ? { catalogOrder: undefined } : { catalogOrder: requested }) } } as unknown as DataWorkspacePlanRequest
        const reply = { ...terminal(), discovery: { state: 'terminal', documentKinds: ['catalog'],
          ...(offered === undefined ? {} : { catalogOrder: offered }) } } as unknown as DataWorkspacePlan
        await expect(planDataWorkspace({ plan: async () => reply }, value, undefined, c)).rejects.toThrow(/catalog order/u)
        expect(f.streams).toEqual([]); expect(c.captured).toBeUndefined(); expect(f.outstanding()).toBe(0)
      } finally { await f.resources.dispose() }
    })

  for (const problem of ['foreign-root', 'path-escape', 'duplicate-id', 'budget'] as const)
    it(`does not relax ${problem} admission under provider-authored order`, async () => {
      const f = fixture(files()), c = f.context(), reply = terminal()
      try {
        const first = documents[0]!
        const requirements = problem === 'foreign-root' ? [{ ...first, rootId: 'foreign' }]
          : problem === 'path-escape' ? [{ ...first, path: 'mod/main.rules' }]
          : problem === 'duplicate-id' ? [first, { ...documents[1]!, requirementId: first.requirementId }]
          : documents
        await expect(planDataWorkspace({ plan: async () => ({ ...reply, requirements }) },
          { ...explicit, maxRequirements: problem === 'budget' ? 1 : 64 }, undefined, c)).rejects.toThrow()
        expect(f.streams).toEqual([]); expect(c.captured).toBeUndefined(); expect(f.outstanding()).toBe(0)
      } finally { await f.resources.dispose() }
    })

  it('retains metadata observations and the original shared byte allowance with the new terminal policy', async () => {
    const f = fixture({ 'base/manifest': '{"next":"base/parts"}', 'base/parts': 'metadata child',
      'base/early.rules': 'base rules', 'mod/later.rules': 'mod rules' }), c = f.context(), source = provider('json')
    const planner = { async plan(value: DataWorkspacePlanRequest): Promise<DataWorkspacePlan> {
      const result = await source.plan(value)
      return result.discovery?.state === 'terminal'
        ? { ...result, discovery: { ...result.discovery, catalogOrder: 'provider-authored' } } : result
    } }
    try {
      await planDataWorkspace(planner, { ...request, intent: { ...request.intent, catalogOrder: 'provider-authored' } }, undefined, c)
      expect(source.seen).toHaveLength(3)
      expect(source.seen[1]!.metadata![0]).toEqual(source.seen[2]!.metadata![0])
      expect(f.streams.filter(path => path === 'base/manifest')).toHaveLength(1)
      expect(c.captured!.inputs).toHaveLength(4)
      expect(c.captured!.usage.bytes).toBe(Object.values({ a: '{"next":"base/parts"}', b: 'metadata child',
        c: 'base rules', d: 'mod rules' }).reduce((sum, text) => sum + new TextEncoder().encode(text).length, 0))
      expect(f.outstanding()).toBe(0)
    } finally { await f.resources.dispose() }
  })
})

/** Synthetic origin supplies bytes only; the production resource session owns resolution/leases. */
function fixture(files: Record<string, string>, options: { fail?: string; unknownSize?: boolean; beforeYield?: () => void; reuseChunks?: boolean } = {}) {
  const streams: string[] = []
  const opens: string[] = []
  let leases = 0
  const origin: CompanionOrigin = {
    primaryLogicalId: 'mod/main', caseSensitivity: 'sensitive', scopes: ['current-mount'],
    async *enumerate(_scope, query) {
      for (const path of Object.keys(files)) if (path.startsWith(query.prefix))
        yield { logicalId: path, size: BigInt(new TextEncoder().encode(files[path]).byteLength) }
    },
    async open(path) {
      opens.push(path)
      leases++
      const bytes = new TextEncoder().encode(files[path])
      const source: ArtifactSource = { kind: 'bytes', ref: { id: path, uri: `memory:/${path}` },
        revision: revisionId(`provider-token:fixture-${encodeURIComponent(path)}`), ...(options.unknownSize ? {} : { size: BigInt(bytes.byteLength) }),
        async read() { return new Uint8Array(bytes) },
        async *stream() {
          streams.push(path)
          options.beforeYield?.()
          if (options.fail === path) throw new Error('fixture backing companion unavailable')
          if (options.reuseChunks) {
            const chunk = Buffer.alloc(4)
            chunk.write('aaaa'); yield chunk
            chunk.write('bbbb'); yield chunk
          } else yield new Uint8Array(bytes)
        } }
      return { value: source, release: async () => { leases-- } }
    },
  }
  const resources = createResourceSession({ origin, revision: revisionId('provider-token:fixture-session'), revisionPolicy: 'pin' })
  const context = (maxTextBytes = 4096): Context => ({ resources, limits: { maxDocumentBytes: 4096, maxTextBytes } })
  return { resources, context, streams, opens, outstanding: () => leases }
}

/** The provider alone chooses metadata syntax, discovered paths and final canonical order. */
function provider(format: 'json' | 'lines', mutate = false) {
  const seen: DataWorkspacePlanRequest[] = []
  return { seen, async plan(value: DataWorkspacePlanRequest): Promise<DataWorkspacePlan> {
    seen.push(value)
    const metadata = value.metadata ?? []
    if (metadata.length === 0) return answer({ state: 'expand', metadataRequirements: [meta('root', 'base/manifest')] })
    const root = metadata.find(row => row.requirementId === 'root')
    if (root?.state !== 'present') throw new Error('expected root bytes')
    expect(root.document).not.toHaveProperty('text')
    const text = new TextDecoder().decode(root.document.bytes)
    const next = format === 'json' ? String(JSON.parse(text).next) : text.trim()
    if (metadata.length === 1) return answer({ state: 'expand', metadataRequirements: [meta('root', 'base/manifest'), meta('child', next)] })
    if (mutate) {
      root.document.bytes.fill(0)
      ;(value.workspace.loadOrder as unknown as { rootId: string }[]).reverse()
    }
    return answer({ state: 'terminal', documentKinds: ['catalog', 'usage'] }, [
      semantic('early', 'base', 'base/early.rules'), semantic('late', 'mod', 'mod/later.rules'),
      { ...semantic('root-semantic', 'base', 'base/manifest'), kind: 'usage', encoding: 'binary' },
    ])
  } }
}

/** Fixture descriptors are ordinary existing Data requirements, not another planner. */
const semantic = (requirementId: string, rootId: string, path: string): DataWorkspaceDocumentRequirement =>
  ({ requirementId, rootId, path, kind: 'catalog' })
const meta = (requirementId: string, path: string) => ({ requirementId, rootId: 'base', path, encoding: 'binary' as const })
const answer = (discovery: Discovery, requirements: readonly DataWorkspaceDocumentRequirement[] = []): DataWorkspacePlan =>
  ({ schemaVersion: 1, workspaceId: 'fixture', gameId: 'fixture-game', analyzerId: 'fixture-data',
    requirements, complete: true, diagnostics: [], discovery })

describe('private bounded Data metadata discovery through one ResourceSession', () => {
  for (const format of ['json', 'lines'] as const) it(`expands ${format} metadata before one canonical plan without rereading metadata`, async () => {
    const files = { 'base/manifest': format === 'json' ? '{"next":"base/parts"}' : 'base/parts\n',
      'base/parts': 'fixture child content', 'base/early.rules': 'base unit defaults', 'mod/later.rules': 'mod overrides' }
    const f = fixture(files), p = provider(format, true), c = f.context()
    try {
      const plan = await planDataWorkspace(p, request, undefined, c)
      expect(p.seen).toHaveLength(3)
      expect(plan.requirements.map(row => row.rootId)).toEqual(['base', 'mod', 'base'])
      expect(plan).not.toHaveProperty('captured')
      expect(c.phase).toBe('complete')
      expect(c.captured?.metadata).toHaveLength(2)
      expect(c.captured?.documents[0]?.document.text).toBe(files['base/early.rules'])
      expect(new TextDecoder().decode(c.captured?.documents[2]?.document.bytes)).toBe(files['base/manifest'])
      expect(c.captured?.inputs.map(row => row.path)).toEqual(Object.keys(files))
      expect(c.captured?.usage).toMatchObject({ requirements: 5, documents: 4, rounds: 3,
        bytes: Object.values(files).reduce((sum, text) => sum + new TextEncoder().encode(text).byteLength, 0) })
      expect(f.streams).toEqual(Object.keys(files))
      expect(f.outstanding()).toBe(0)
      expect(workspace.loadOrder.map(row => row.rootId)).toEqual(['base', 'mod'])
    } finally { await f.resources.dispose() }
    expect(f.outstanding()).toBe(0)
  })

  it('requires an explicit terminal answer; old complete:true never authorizes capture', async () => {
    const f = fixture({}), c = f.context()
    try {
      const legacy = { plan: async () => ({ ...answer({ state: 'terminal', documentKinds: ['catalog'] }), discovery: undefined }) }
      await expect(planDataWorkspace(legacy as unknown as { plan(): Promise<DataWorkspacePlan> }, request, undefined, c))
        .rejects.toThrow(/legacy complete/u)
      expect(c.captured).toBeUndefined()
      expect(c.phase).toBe('failed')
      await expect(planDataWorkspace(provider('json'), request, undefined, c)).rejects.toThrow(/single-operation/u)
    } finally { await f.resources.dispose() }
  })

  it('refuses premature semantic publication, retargeting and removal of metadata', async () => {
    for (const failure of ['premature', 'retarget', 'remove'] as const) {
      const f = fixture({ 'base/manifest': '{}' }), c = f.context()
      const p = { plan: async (value: DataWorkspacePlanRequest) => value.metadata?.length
        ? answer({ state: 'expand', metadataRequirements: failure === 'remove' ? [] : [meta('root', 'base/other')] })
        : answer({ state: 'expand', metadataRequirements: [meta('root', 'base/manifest')] },
          failure === 'premature' ? [semantic('early', 'base', 'base/early.rules')] : []) }
      try {
        await expect(planDataWorkspace(p, request, undefined, c)).rejects.toThrow(/before terminal|retargeted|removed/u)
        expect(c.captured).toBeUndefined()
      } finally { await f.resources.dispose() }
      expect(f.outstanding()).toBe(0)
    }
  })

  it('confines discovered reads before resource I/O and rejects incorrect final order', async () => {
    for (const mode of ['escape', 'order'] as const) {
      const f = fixture({}), c = f.context()
      const p = { plan: async () => mode === 'escape'
        ? answer({ state: 'expand', metadataRequirements: [meta('m', 'mod/secret')] })
        : answer({ state: 'terminal', documentKinds: ['catalog', 'usage'] },
          [semantic('late', 'mod', 'mod/later'), semantic('early', 'base', 'base/early')]) }
      try {
        await expect(planDataWorkspace(p, request, undefined, c)).rejects.toThrow(/escapes its root|dependency-first/u)
        expect(f.streams).toEqual([])
      } finally { await f.resources.dispose() }
    }
  })

  it('shares metadata/final requirement and byte budgets instead of resetting at terminal', async () => {
    for (const limit of ['requirements', 'bytes', 'stream-bytes'] as const) {
      const f = fixture({ 'base/manifest': 'x', 'base/final': '12345' }, { unknownSize: limit === 'stream-bytes' }),
        c = f.context(limit === 'requirements' ? 4096 : 5)
      const p = { plan: async (value: DataWorkspacePlanRequest) => value.metadata?.length
        ? answer({ state: 'terminal', documentKinds: ['catalog', 'usage'] }, [semantic('final', 'base', 'base/final')])
        : answer({ state: 'expand', metadataRequirements: [meta('root', 'base/manifest')] }) }
      try {
        await expect(planDataWorkspace(p, { ...request, maxRequirements: limit === 'requirements' ? 1 : 8 }, undefined, c))
          .rejects.toThrow(/shared budget|budget-exceeded/u)
        expect(c.captured).toBeUndefined()
      } finally { await f.resources.dispose() }
      expect(f.outstanding()).toBe(0)
    }
  })

  it('never converts not-found or a listed but unreadable optional input into absence', async () => {
    for (const missing of [true, false]) {
      const f = fixture(missing ? {} : { 'base/broken': 'x' }, { fail: 'base/broken' }), c = f.context()
      const p = { plan: async () => answer({ state: 'terminal', documentKinds: ['catalog', 'usage'] },
        [{ ...semantic('file', 'base', 'base/broken'), required: false }]) }
      try {
        await expect(planDataWorkspace(p, request, undefined, c)).rejects.toThrow(/cannot qualify absent|read-failed/u)
        expect(c.captured).toBeUndefined()
        expect(f.outstanding()).toBe(0)
      } finally { await f.resources.dispose() }
      expect(f.outstanding()).toBe(0)
    }
  })

  it('refuses partial listings, scope escapes and case-colliding paths', async () => {
    const p = { plan: async () => ({ ...answer({ state: 'expand', metadataRequirements: [] }),
      listingQueries: [{ rootId: 'base', prefix: 'data' }] }) }
    for (const listed of [{ paths: [], complete: false }, { paths: ['outside/file'], complete: true },
      { paths: ['data/a', 'data/A'], complete: true }]) {
      const f = fixture({}), c = f.context()
      try {
        await expect(planDataWorkspace(p, request, async () => listed, c)).rejects.toThrow(/partial|scope escape|collision/u)
        expect(c.captured).toBeUndefined()
      } finally { await f.resources.dispose() }
    }
  })

  it('refuses no progress and terminal coverage that omits a requested kind', async () => {
    for (const phase of [{ state: 'expand', metadataRequirements: [] },
      { state: 'terminal', documentKinds: ['catalog'] }] as const) {
      const f = fixture({}), c = f.context()
      try {
        await expect(planDataWorkspace({ plan: async () => answer(phase) }, request, undefined, c))
          .rejects.toThrow(/no progress|coverage/u)
      } finally { await f.resources.dispose() }
    }
  })

  it('refuses forged observations and abort/disposal after asynchronous owners return', async () => {
    const f = fixture({}), c = f.context()
    try {
      await expect(planDataWorkspace(provider('json'), { ...request, metadata: [] }, undefined, c))
        .rejects.toThrow(/caller-supplied/u)
    } finally { await f.resources.dispose() }
    for (const closing of ['abort', 'dispose'] as const) {
      const next = fixture({}), context = next.context(), controller = new AbortController()
      try {
        const p = { plan: async () => {
          if (closing === 'abort') controller.abort()
          else await next.resources.dispose()
          return answer({ state: 'terminal', documentKinds: ['catalog', 'usage'] })
        } }
        await expect(planDataWorkspace(p, { ...request, signal: controller.signal }, undefined, context))
          .rejects.toThrow(/abort|disposed/iu)
        expect(context.captured).toBeUndefined()
      } finally { await next.resources.dispose() }
      expect(next.outstanding()).toBe(0)
    }
  })

  it('captures recycled stream buffers before the producer reuses their backing storage', async () => {
    const f = fixture({ 'base/final': 'aaaabbbb' }, { reuseChunks: true }), c = f.context()
    try {
      const p = { plan: async () => answer({ state: 'terminal', documentKinds: ['catalog', 'usage'] },
        [semantic('file', 'base', 'base/final')]) }
      await planDataWorkspace(p, request, undefined, c)
      expect(c.captured?.documents[0]?.document.text).toBe('aaaabbbb')
    } finally { await f.resources.dispose() }
    expect(f.outstanding()).toBe(0)
  })

  it('cancels during the existing stream loop and releases every caller lease', async () => {
    const controller = new AbortController()
    const f = fixture({ 'base/manifest': 'x' }, { beforeYield: () => controller.abort() }), c = f.context()
    try {
      const p = { plan: async () => answer({ state: 'expand', metadataRequirements: [meta('root', 'base/manifest')] }) }
      await expect(planDataWorkspace(p, { ...request, signal: controller.signal }, undefined, c)).rejects.toThrow(/abort/iu)
      expect(c.captured).toBeUndefined()
      expect(f.outstanding()).toBe(0)
    } finally { await f.resources.dispose() }
    expect(f.outstanding()).toBe(0)
  })

  it('bounds a continuing metadata expansion by rounds without resetting input allowances', async () => {
    const f = fixture(Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`base/meta${index}`, 'x']))), c = f.context()
    const p = { plan: async (value: DataWorkspacePlanRequest) => answer({ state: 'expand', metadataRequirements:
      Array.from({ length: (value.metadata?.length ?? 0) + 1 }, (_, index) => meta(`m${index}`, `base/meta${index}`)) }) }
    try {
      await expect(planDataWorkspace(p, request, undefined, c)).rejects.toThrow(/round budget/u)
      expect(f.streams).toHaveLength(32)
      expect(c.captured).toBeUndefined()
    } finally { await f.resources.dispose() }
    expect(f.outstanding()).toBe(0)
  })

  it('bounds listing queries cumulatively across rounds', async () => {
    const f = fixture({}), c = f.context()
    let listed = 0
    const p = { plan: async (value: DataWorkspacePlanRequest) => ({ ...answer({ state: 'expand', metadataRequirements: [] }),
      listingQueries: Array.from({ length: 3 }, (_, index) => ({ rootId: 'base', prefix: `scope${(value.listings?.length ?? 0) + index}` })) }) }
    try {
      await expect(planDataWorkspace(p, request, async () => { listed++; return { paths: [], complete: true } }, c))
        .rejects.toThrow(/query budget/u)
      expect(listed).toBe(63) // the entire final three-query round is refused before I/O
      expect(c.captured).toBeUndefined()
    } finally { await f.resources.dispose() }
  })

  it('preserves captured listing spelling for explicitly case-sensitive roots', async () => {
    const f = fixture({}), c = f.context()
    const p = { plan: async (value: DataWorkspacePlanRequest) => value.listings?.length
      ? answer({ state: 'terminal', documentKinds: ['catalog', 'usage'] })
      : { ...answer({ state: 'expand', metadataRequirements: [] }), listingQueries: [{ rootId: 'base', prefix: 'data' }] } }
    const sensitive = { ...request, workspace: { ...workspace,
      loadOrder: workspace.loadOrder.map(root => ({ ...root, caseSensitive: true })) } }
    try {
      await planDataWorkspace(p, sensitive, async () => ({ paths: ['data/a', 'data/A'], complete: true }), c)
      expect(c.captured?.listings[0]?.paths).toEqual(['data/a', 'data/A'])
    } finally { await f.resources.dispose() }
  })

  it('does not accept terminal success alongside provider error diagnostics', async () => {
    const f = fixture({}), c = f.context()
    const p = { plan: async () => ({ ...answer({ state: 'terminal', documentKinds: ['catalog', 'usage'] }),
      diagnostics: [{ severity: 'error' as const, code: 'fixture:incomplete', message: 'required input missing' }] }) }
    try {
      await expect(planDataWorkspace(p, request, undefined, c)).rejects.toThrow(/error diagnostics/u)
      expect(f.streams).toEqual([])
      expect(c.captured).toBeUndefined()
    } finally { await f.resources.dispose() }
  })

  it('rejects a truthy nonboolean complete field from a JavaScript provider', async () => {
    const f = fixture({}), c = f.context()
    const p = { plan: async () => ({ ...answer({ state: 'terminal', documentKinds: ['catalog', 'usage'] }),
      complete: 'true' as unknown as boolean }) }
    try {
      await expect(planDataWorkspace(p, request, undefined, c)).rejects.toThrow(/coverage/u)
      expect(c.captured).toBeUndefined()
    } finally { await f.resources.dispose() }
  })

  it('preflights every metadata descriptor before opening any new input in a malformed round', async () => {
    for (const failure of ['retarget', 'duplicate', 'remove', 'escape', 'encoding'] as const) {
      const f = fixture({ 'base/manifest': 'original bytes', 'base/new': 'new bytes', 'base/other': 'other' }), c = f.context()
      let observed: Uint8Array | undefined
      const p = { plan: async (value: DataWorkspacePlanRequest) => {
        if (!value.metadata?.length) return answer({ state: 'expand', metadataRequirements: [meta('m1', 'base/manifest')] })
        const row = value.metadata[0]
        if (row?.state === 'present') observed = row.document.bytes
        const prior = meta('m1', 'base/manifest'), newer = meta('m2', 'base/new')
        const metadataRequirements = failure === 'retarget' ? [newer, meta('m1', 'base/other')]
          : failure === 'duplicate' ? [newer, prior, prior]
          : failure === 'remove' ? [newer]
          : failure === 'escape' ? [newer, meta('m1', 'mod/foreign')]
          : [newer, { ...prior, encoding: 'text' as unknown as 'binary' }]
        return answer({ state: 'expand', metadataRequirements })
      } }
      try {
        await expect(planDataWorkspace(p, request, undefined, c)).rejects.toThrow(/retarget|duplicate|removed|root|invalid/u)
        expect(f.opens).toEqual(['base/manifest'])
        expect(new TextDecoder().decode(observed)).toBe('original bytes')
        expect(c.captured).toBeUndefined()
        expect(f.outstanding()).toBe(0)
      } finally { await f.resources.dispose() }
    }
  })

  it('preflights listing scopes and metadata together before any new listing calls', async () => {
    for (const failure of ['query', 'metadata'] as const) {
      const f = fixture({}), c = f.context()
      let calls = 0
      const p = { plan: async () => ({ ...answer({ state: 'expand', metadataRequirements: failure === 'metadata'
        ? [{ ...meta('m', 'base/manifest'), encoding: 'text' as unknown as 'binary' }] : [] }),
        listingQueries: [{ rootId: 'base', prefix: 'data' }, ...(failure === 'query' ? [{ rootId: 'unknown', prefix: 'data' }] : [])] }) }
      try {
        await expect(planDataWorkspace(p, request, async () => { calls++; return { paths: [], complete: true } }, c))
          .rejects.toThrow(/unknown root|invalid/u)
        expect(calls).toBe(0)
        expect(f.opens).toEqual([])
      } finally { await f.resources.dispose() }
    }
  })

  it('preflights final semantic identities before reading preceding valid final inputs', async () => {
    const f = fixture({ 'base/manifest': 'original bytes', 'base/new': 'new bytes' }), c = f.context()
    const p = { plan: async (value: DataWorkspacePlanRequest) => value.metadata?.length
      ? answer({ state: 'terminal', documentKinds: ['catalog', 'usage'] }, [semantic('new', 'base', 'base/new'), semantic('m1', 'base', 'base/manifest')])
      : answer({ state: 'expand', metadataRequirements: [meta('m1', 'base/manifest')] }) }
    try {
      await expect(planDataWorkspace(p, request, undefined, c)).rejects.toThrow(/metadata identity reused/u)
      expect(f.opens).toEqual(['base/manifest'])
      expect(c.captured).toBeUndefined()
      expect(f.outstanding()).toBe(0)
    } finally { await f.resources.dispose() }
  })
})

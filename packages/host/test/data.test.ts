import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import {
  createHostTopology,
  resolveModWorkspaceGraph,
  revisionId,
  type ArtifactSource,
  type InputSearchScope,
  type Lease,
  type ModWorkspaceLock,
} from '@modkitx-x3/sdk'
import {
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
  type HostComposition,
  type LinkedExtension,
} from '@modkitx-x3/host'
import {
  analyzeResolvedDataWorkspace,
  createResolvedDataSubjectSelectorLease,
  RESOLVED_DATA_WORKSPACE_CONTRACT_DEFINITION,
  resolveDataCatalogAnalysis,
  resolveResolvedDataWorkspace,
} from '@modkitx-x3/host/data'
import type { CompanionEnumerationOptions, CompanionOrigin } from '../src/input-resolution.js'
import { createResourceSession } from '../src/resource-session.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const { starcraft2Game } = (await import(
  pathToFileURL(join(repoRoot, '..', 'modkit-blizzard', 'starcraft2-game', 'src', 'linked.js')).href
)) as { readonly starcraft2Game: LinkedExtension }

const GAME_ID = 'org.modkitx/starcraft-2'
const REALM = 'org.modkitx.test/data-host'
const operatingSystem =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.modkitx.test/data',
  realms: [
    {
      schemaVersion: 1,
      realmId: REALM,
      revision: '1',
      target: { environment: 'node', operatingSystem, architecture: 'x64' },
      facilities: [],
      budgets: {
        maxConcurrentTasks: 2,
        maxWorkerCount: 0,
        maxResidentBytes: uint64('134217728'),
        maxTransferBytes: uint64('16777216'),
        defaultDeadlineMs: 10_000,
      },
      policy: { id: 'org.modkitx.test/data-policy', revision: '1' },
    },
  ],
  links: [],
})
const activationBudget = {
  maxInputBytes: 16_777_216n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 4_194_304,
  maxDiagnostics: 100,
}

const catalogFiles = [
  'abildata.xml',
  'actordata.xml',
  'behaviordata.xml',
  'buttondata.xml',
  'effectdata.xml',
  'unitdata.xml',
  'upgradedata.xml',
  'weapondata.xml',
] as const

const roots = {
  core: 'mods/core.sc2mod',
  liberty: 'mods/liberty.sc2mod',
  active: 'workspace/active.sc2mod',
} as const

function workspaceLock(): ModWorkspaceLock {
  return resolveModWorkspaceGraph({
    workspaceId: 'synthetic-map-workspace',
    gameId: GAME_ID,
    activeRootId: 'active',
    sources: [
      { sourceId: 'workspace', kind: 'memory', location: 'memory:workspace' },
      { sourceId: 'retail', kind: 'memory', location: 'memory:retail' },
    ],
    roots: [
      {
        rootId: 'core',
        sourceId: 'retail',
        sourcePath: roots.core,
        displayName: 'Core',
        kind: 'dependency',
        dependencies: [],
      },
      {
        rootId: 'liberty',
        sourceId: 'retail',
        sourcePath: roots.liberty,
        displayName: 'Liberty',
        kind: 'dependency',
        dependencies: [
          { targetRootId: 'core', ref: 'Core.SC2Mod', required: true, provenance: 'declared' },
        ],
      },
      {
        rootId: 'active',
        sourceId: 'workspace',
        sourcePath: roots.active,
        displayName: 'Active',
        kind: 'workspace',
        dependencies: [
          {
            targetRootId: 'liberty',
            ref: 'Liberty.SC2Mod',
            required: true,
            provenance: 'declared',
          },
        ],
      },
    ],
    maxRoots: 8,
    maxDepth: 8,
  })
}

function completeWorkspaceFiles(): Map<string, string> {
  const files = new Map<string, string>()
  for (const root of Object.values(roots)) {
    for (const file of catalogFiles) {
      files.set(`${root}/base.sc2data/gamedata/${file}`, '<Catalog/>')
    }
    for (const locale of ['frfr', 'enus']) {
      files.set(`${root}/${locale}.sc2data/localizeddata/gamestrings.txt`, '')
    }
  }
  files.set(
    `${roots.core}/base.sc2data/gamedata/unitdata.xml`,
    '<Catalog><CUnit id="Marine"><Name value="Unit/Name/Marine"/><LifeMax value="40"/><WeaponArray index="0" Link="Rifle"/><BehaviorArray index="0" Link="MissingBehavior"/></CUnit><CUnit id="CycleA" parent="CycleB"/><CUnit id="CycleB" parent="CycleA"/><CUnit id="Duplicate"><LifeMax value="1"/></CUnit><CUnit id="Duplicate"><LifeMax value="2"/></CUnit></Catalog>',
  )
  files.set(
    `${roots.core}/base.sc2data/gamedata/weapondata.xml`,
    '<Catalog><CWeapon id="Rifle"><Effect Link="RifleDamage"/></CWeapon></Catalog>',
  )
  files.set(
    `${roots.core}/base.sc2data/gamedata/effectdata.xml`,
    '<Catalog><CEffectSet id="RifleImpactSet"><EffectArray value="RifleDamage"/><EffectArray value="ApplyStim"/></CEffectSet><CEffectDamage id="RifleDamage"><Amount value="6"/></CEffectDamage><CEffectApplyBehavior id="ApplyStim"><Behavior value="StimBehavior"/></CEffectApplyBehavior><CEffectCreatePersistent id="Pulse"><PeriodicEffectArray value="RifleImpactSet"/><PeriodicEffectArray value="RifleDamage"/></CEffectCreatePersistent><CEffectEnumArea id="Search"><AreaArray index="0" Radius="4" Effect="RifleImpactSet"/><AreaArray index="1" Radius="2" Effect="ApplyStim"/></CEffectEnumArea></Catalog>',
  )
  files.set(
    `${roots.core}/base.sc2data/gamedata/behaviordata.xml`,
    '<Catalog><CBehavior id="StimBehavior"><DurationMin value="8"/></CBehavior></Catalog>',
  )
  files.set(
    `${roots.liberty}/base.sc2data/gamedata/unitdata.xml`,
    '<Catalog><CUnit id="Marine"><LifeMax value="45"/></CUnit></Catalog>',
  )
  files.set(
    `${roots.active}/base.sc2data/gamedata/unitdata.xml`,
    '<Catalog><CUnit id="Marine"><LifeMax value="55"/></CUnit></Catalog>',
  )
  files.set(
    `${roots.core}/enus.sc2data/localizeddata/gamestrings.txt`,
    'Unit/Name/Marine=Core Marine',
  )
  files.set(
    `${roots.liberty}/enus.sc2data/localizeddata/gamestrings.txt`,
    'Unit/Name/Marine=Liberty Marine',
  )
  files.set(
    `${roots.active}/enus.sc2data/localizeddata/gamestrings.txt`,
    'Unit/Name/Marine=<img src=x onerror=alert(1)>',
  )
  return files
}

function memoryOrigin(files: ReadonlyMap<string, string>): CompanionOrigin {
  const encoder = new TextEncoder()
  const paths = [...files.keys()].sort()
  const origin: CompanionOrigin = {
    primaryLogicalId: 'workspace/active.sc2map',
    caseSensitivity: 'insensitive',
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
      for (const path of paths) {
        signal?.throwIfAborted()
        if (!path.startsWith(options.prefix.toLowerCase())) continue
        yield Object.freeze({
          logicalId: path,
          size: BigInt(encoder.encode(files.get(path)).length),
        })
      }
    },
    open(logicalId: string, signal?: AbortSignal): Promise<Lease<ArtifactSource>> {
      signal?.throwIfAborted()
      const path = logicalId.toLowerCase()
      const text = files.get(path)
      if (text === undefined) throw new RangeError(`unknown memory resource ${logicalId}`)
      const bytes = encoder.encode(text)
      const uri = `memory://resolved-data/${encodeURIComponent(path)}`
      const source: ArtifactSource = Object.freeze({
        kind: 'bytes',
        ref: Object.freeze({ id: uri, uri }),
        revision: revisionId(
          `provider-token:${encodeURIComponent(`${path}:${String(bytes.length)}`)}`,
        ),
        size: BigInt(bytes.length),
        read(offset: bigint, length: number, readSignal?: AbortSignal) {
          readSignal?.throwIfAborted()
          const start = Number(offset)
          return Promise.resolve(bytes.slice(start, start + length))
        },
        async *stream(
          _range?: { readonly offset: bigint; readonly length?: bigint },
          streamSignal?: AbortSignal,
        ) {
          streamSignal?.throwIfAborted()
          yield bytes
        },
      })
      return Promise.resolve({
        value: source,
        release: () => Promise.resolve(),
      })
    },
  }
  return Object.freeze(origin)
}

let composition: HostComposition
let definitions: ReturnType<typeof createBundledServiceDefinitionRegistry>

beforeAll(async () => {
  const linked = linkedExtensionInputs([starcraft2Game])
  const executionBackends = createExecutionBackendRegistry([linkedInProcessBackend(linked.modules)])
  composition = await createHostComposition({
    topology,
    realmId: REALM,
    extensions: linked.inputs,
    executionBackends,
  })
  definitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(composition.inventory, definitions)
})

async function resolveCatalog() {
  const resolution = await resolveDataCatalogAnalysis({
    services: { ...composition, serviceDefinitions: definitions },
    gameId: GAME_ID,
    grant: { id: 'data-test', classes: [] },
    budgets: activationBudget,
  })
  expect(
    resolution.state,
    resolution.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
  ).toBe('resolved')
  if (resolution.state !== 'resolved') throw new Error('semantic catalog analyzer did not resolve')
  return resolution
}

describe('standard data contract and semantic game provider', () => {
  it('declares subject facts and calculations as optional workspace leases', () => {
    expect(
      RESOLVED_DATA_WORKSPACE_CONTRACT_DEFINITION.surface?.methods['openSubjectFacts'],
    ).toMatchObject({
      kind: 'lease',
      optional: true,
      wrapper: 'lease',
      result: { contract: 'common.view/subject-facts-source', major: 1 },
      signal: { arg: 0, key: 'signal' },
    })
    expect(
      RESOLVED_DATA_WORKSPACE_CONTRACT_DEFINITION.surface?.methods['openSubjectCalculations'],
    ).toMatchObject({
      kind: 'lease',
      optional: true,
      wrapper: 'lease',
      result: { contract: 'common.view/subject-calculations-source', major: 1 },
      signal: { arg: 0, key: 'signal' },
    })
  })

  it('parses ordered XML patches and exposes inherited schema-backed entities', async () => {
    const resolution = await resolveCatalog()
    try {
      const snapshot = await resolution.analysis.analyze({
        workspaceId: 'map-workspace',
        gameId: GAME_ID,
        documents: [
          {
            rootId: 'base',
            path: 'Base.SC2Data/GameData/UnitData.xml',
            text: '<Catalog><CUnit id="Infantry"><LifeMax value="40"/><WeaponArray index="0" Link="Rifle"/></CUnit></Catalog>',
          },
          {
            rootId: 'active',
            path: 'Active.SC2Data/GameData/UnitData.xml',
            text: '<Catalog><CUnit id="Infantry"><LifeMax value="45"/></CUnit><CUnit id="Marine" parent="Infantry"><Race value="Terr"/><WeaponArray index="1" Link="Grenade"/></CUnit></Catalog>',
          },
        ],
        queries: [{ namespace: 'Unit', entityId: 'Marine' }],
        maxDocuments: 8,
        maxTextBytes: 32_768,
        maxEntities: 128,
        maxDepth: 16,
      })

      expect(snapshot.complete).toBe(true)
      expect(snapshot.entities[0]).toMatchObject({
        namespace: 'Unit',
        typeId: 'CUnit',
        entityId: 'Marine',
        parentEntityId: 'Infantry',
        fields: {
          LifeMax: 45,
          Race: 'Terr',
          WeaponArray: [{ Link: 'Rifle' }, { Link: 'Grenade' }],
        },
      })
      expect(snapshot.entities[0]?.sources.map(item => item.rootId)).toEqual([
        'base',
        'active',
        'active',
      ])
      expect(Object.keys(snapshot).sort()).toEqual([
        'analyzerId',
        'complete',
        'diagnostics',
        'entities',
        'entityCount',
        'gameId',
        'namespaces',
        'patchCount',
        'schemaVersion',
        'typeIds',
        'workspaceId',
      ])
      expect(Object.keys(resolution.analysis).sort()).toEqual([
        'analyze',
        'analyzerId',
        'contract',
        'gameIds',
      ])
    } finally {
      await resolution.release()
    }
  })

  it('does not route the provider to another game', async () => {
    const resolution = await resolveDataCatalogAnalysis({
      services: { ...composition, serviceDefinitions: definitions },
      gameId: 'example/other-game',
      grant: { id: 'data-test-mismatch', classes: [] },
      budgets: activationBudget,
    })
    expect(resolution.state).toBe('unresolved')
    expect(resolution.diagnostics.map(item => item.code)).toContain(
      'x3.host/data-catalog-unresolved',
    )
  })

  it('runs provider plan through ResourceSession and serves bounded leased live facets', async () => {
    const workspace = workspaceLock()
    expect(workspace.loadOrder.map(root => root.rootId)).toEqual(['core', 'liberty', 'active'])
    expect(workspace.logicalRoots?.map(root => root.rootId)).toEqual(['active', 'liberty', 'core'])
    const resources = createResourceSession({
      origin: memoryOrigin(completeWorkspaceFiles()),
      revision: revisionId('provider-token:resolved-data-workspace-v1'),
    })
    const result = await analyzeResolvedDataWorkspace({
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'resolved-data-product-path', classes: [] },
      budgets: activationBudget,
      workspace,
      resources,
      locales: ['fr-FR', 'en-US'],
      queries: [{ namespace: 'Unit', entityId: 'Marine' }],
      localizationKeys: ['Unit/Name/Absent'],
      limits: {
        maxRequirements: 64,
        maxDocumentBytes: 65_536,
        maxTextBytes: 1_048_576,
        maxEntities: 1_024,
        maxDepth: 32,
        maxPageSize: 2,
      },
    })
    expect(
      result.state,
      result.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
    ).toBe('resolved')
    if (result.state !== 'resolved') throw new Error('resolved data product path failed')
    try {
      expect(
        result.plan.requirements.filter(item => item.kind === 'catalog').map(item => item.rootId),
      ).toEqual([...Array(9).fill('core'), ...Array(9).fill('liberty'), ...Array(9).fill('active')])
      expect(
        result.plan.requirements
          .filter(item => item.kind === 'localization')
          .slice(0, 3)
          .map(item => item.rootId),
      ).toEqual(['active', 'liberty', 'core'])
      expect(resources.provenance()).toHaveLength(33)

      const marine = result.snapshot.definitions.find(
        item => item.namespace === 'Unit' && item.entityId === 'Marine',
      )
      expect(marine).toMatchObject({ fields: { LifeMax: 55 } })
      expect(marine?.sources.map(item => item.rootId)).toEqual(['core', 'liberty', 'active'])
      expect(result.snapshot.localizedStrings).toContainEqual(
        expect.objectContaining({
          key: 'Unit/Name/Marine',
          value: '<img src=x onerror=alert(1)>',
          requestedLocale: 'frFR',
          resolvedLocale: 'enUS',
          fallback: true,
          source: expect.objectContaining({ rootId: 'active' }),
        }),
      )

      const selector = createResolvedDataSubjectSelectorLease(result, {
        maxPageSize: 64,
        maxEntities: 1_024,
        maxRelations: 1_024,
        maxCalculations: 64,
      })
      expect(selector).toBeDefined()
      if (selector === undefined) throw new Error('resolved SC2 subject selector is absent')
      const selectable = await selector.value.subjects({ limit: 64 })
      expect(selectable.items).toContainEqual(
        expect.objectContaining({ subjectId: 'Unit/Marine', kind: 'Unit' }),
      )
      expect(
        await selector.value.subjects({ limit: 64, kind: 'Unit', text: 'marine' }),
      ).toMatchObject({ items: [expect.objectContaining({ subjectId: 'Unit/Marine' })] })
      expect(await selector.value.subjects({ limit: 64, kind: 'Weapon' })).toMatchObject({
        items: expect.not.arrayContaining([expect.objectContaining({ kind: 'Unit' })]),
      })
      const facts = await selector.value.openFacts('Unit/Marine')
      const calculations = await selector.value.openCalculations('Unit/Marine')
      expect(await facts.value.summary()).toMatchObject({
        identity: { subjectId: 'Unit/Marine' },
      })
      expect(await calculations.value.summary()).toMatchObject({ subjectId: 'Unit/Marine' })
      await Promise.all([facts.release(), calculations.release(), selector.release()])
      expect(result.snapshot.relations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            from: { namespace: 'Unit', entityId: 'Marine' },
            to: { namespace: 'Weapon', entityId: 'Rifle' },
            dead: false,
          }),
          expect.objectContaining({
            from: { namespace: 'Unit', entityId: 'Marine' },
            to: { namespace: 'Behavior', entityId: 'MissingBehavior' },
            dead: true,
          }),
          expect.objectContaining({
            from: { namespace: 'Effect', entityId: 'RifleImpactSet' },
            to: { namespace: 'Effect', entityId: 'RifleDamage' },
            role: 'EffectArray',
            dead: false,
          }),
          expect.objectContaining({
            from: { namespace: 'Effect', entityId: 'RifleImpactSet' },
            to: { namespace: 'Effect', entityId: 'ApplyStim' },
            role: 'EffectArray',
            dead: false,
          }),
          expect.objectContaining({
            from: { namespace: 'Effect', entityId: 'ApplyStim' },
            to: { namespace: 'Behavior', entityId: 'StimBehavior' },
            role: 'Behavior',
            dead: false,
          }),
          expect.objectContaining({
            from: { namespace: 'Effect', entityId: 'Pulse' },
            to: { namespace: 'Effect', entityId: 'RifleImpactSet' },
            role: 'PeriodicEffectArray',
            dead: false,
          }),
          expect.objectContaining({
            from: { namespace: 'Effect', entityId: 'Search' },
            to: { namespace: 'Effect', entityId: 'ApplyStim' },
            role: 'AreaArray.Effect',
            dead: false,
          }),
        ]),
      )
      expect(result.snapshot.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'org.modkitx.blizzard.starcraft2/catalog-id-duplicate',
          }),
          expect.objectContaining({ code: 'common.data/entity-inheritance-cycle' }),
          expect.objectContaining({ code: 'common.data/relation-target-unavailable' }),
          expect.objectContaining({ code: 'common.data/localization-fallback' }),
          expect.objectContaining({ code: 'common.data/localization-key-unavailable' }),
        ]),
      )
      expect(result.snapshot.projectionReceipt.planes.map(item => item.state)).toEqual([
        'normalized',
        'normalized',
        'normalized',
        'normalized',
      ])

      const root = await result.facets.schemaTree.value.root()
      expect(
        (await result.facets.schemaTree.value.children(root, { limit: 2 })).nextCursor,
      ).toEqual(expect.any(String))
      const firstRows = await result.facets.definitions.value.rows({
        kind: 'range',
        from: 0,
        count: 1,
      })
      expect(firstRows.nextCursor).toEqual(expect.any(String))
      await expect(
        result.facets.definitions.value.rows({ kind: 'range', from: 0, count: 3 }),
      ).rejects.toThrow(/at most 2/u)
      await expect(
        result.facets.definitions.value.rows({
          kind: 'cursor',
          cursor: 'foreign-snapshot:1',
          count: 1,
        }),
      ).rejects.toThrow(/another source snapshot/u)
      const relationSummary = await result.facets.relations.value.summary()
      expect(relationSummary).toMatchObject({
        snapshotId: result.snapshot.snapshotId,
        completeness: 'partial',
      })
      const edges = await result.facets.relations.value.edges({ limit: 2 })
      const pagedEdges = [...edges.items]
      let edgeCursor = edges.nextCursor
      while (edgeCursor !== undefined) {
        const next = await result.facets.relations.value.edges({
          limit: 2,
          cursor: edgeCursor,
        })
        pagedEdges.push(...next.items)
        edgeCursor = next.nextCursor
      }
      expect(pagedEdges).toContainEqual(expect.objectContaining({ dead: true }))
      const cancelled = new AbortController()
      cancelled.abort()
      await expect(
        result.facets.localization.value.rows(
          { kind: 'range', from: 0, count: 1 },
          cancelled.signal,
        ),
      ).rejects.toThrow()
    } finally {
      await result.release()
      await resources.dispose()
    }
    expect(() => result.facets.definitions.value.shape()).toThrow(/lease is released/u)
  })

  it('parses the full schema-confirmed effect family and reports anonymous defaults explicitly', async () => {
    const resolution = await resolveCatalog()
    try {
      const snapshot = await resolution.analysis.analyze({
        workspaceId: 'effect-schema-slice',
        gameId: GAME_ID,
        documents: [
          {
            rootId: 'active',
            path: 'Active.SC2Data/GameData/EffectData.xml',
            text: '<Catalog><CEffectSet id="ImpactSet"><EffectArray value="Damage"/><EffectArray value="ApplyBuff"/></CEffectSet><CEffectApplyBehavior id="ApplyBuff"><Behavior value="Buff"/></CEffectApplyBehavior><CEffectDamage id="Damage"><Amount value="10"/></CEffectDamage><CEffectCreatePersistent id="Pulse"><PeriodicEffectArray value="Search"/><PeriodicEffectArray value="Damage"/></CEffectCreatePersistent><CEffectEnumArea id="Search"><AreaArray index="0" Radius="4" Effect="Damage"/><AreaArray index="1" Radius="2" Effect="ApplyBuff"/></CEffectEnumArea><CEffectRemoveBehavior id="Unverified"><Behavior value="Buff"/></CEffectRemoveBehavior><CEffectSet><EffectArray value="Damage"/></CEffectSet></Catalog>',
          },
        ],
        queries: [
          { namespace: 'Effect', entityId: 'ImpactSet' },
          { namespace: 'Effect', entityId: 'ApplyBuff' },
          { namespace: 'Effect', entityId: 'Pulse' },
          { namespace: 'Effect', entityId: 'Search' },
          { namespace: 'Effect', entityId: 'Unverified' },
        ],
        maxDocuments: 1,
        maxTextBytes: 32_768,
        maxEntities: 32,
        maxDepth: 8,
      })

      expect(snapshot.entities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            namespace: 'Effect',
            typeId: 'CEffectSet',
            entityId: 'ImpactSet',
            fields: { EffectArray: ['Damage', 'ApplyBuff'] },
          }),
          expect.objectContaining({
            namespace: 'Effect',
            typeId: 'CEffectApplyBehavior',
            entityId: 'ApplyBuff',
            fields: { Behavior: 'Buff' },
          }),
          expect.objectContaining({
            namespace: 'Effect',
            typeId: 'CEffectCreatePersistent',
            entityId: 'Pulse',
            fields: { PeriodicEffectArray: ['Search', 'Damage'] },
          }),
          expect.objectContaining({
            namespace: 'Effect',
            typeId: 'CEffectEnumArea',
            entityId: 'Search',
            fields: {
              AreaArray: [
                { Radius: 4, Effect: 'Damage' },
                { Radius: 2, Effect: 'ApplyBuff' },
              ],
            },
          }),
          expect.objectContaining({
            namespace: 'Effect',
            typeId: 'CEffectRemoveBehavior',
            entityId: 'Unverified',
            fields: { Behavior: 'Buff' },
          }),
        ]),
      )
      expect(snapshot.complete).toBe(true)
      expect(snapshot.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'org.modkitx.blizzard.starcraft2/data-default-definitions-preserved',
            message: expect.stringContaining('1 anonymous/default'),
          }),
        ]),
      )
    } finally {
      await resolution.release()
    }
  })

  it('fails closed for truncated plans, malformed logical roots and stale snapshots while tolerating absent optional catalog files', async () => {
    const resolution = await resolveResolvedDataWorkspace({
      services: { ...composition, serviceDefinitions: definitions },
      gameId: GAME_ID,
      grant: { id: 'resolved-data-negative', classes: [] },
      budgets: activationBudget,
    })
    expect(resolution.state).toBe('resolved')
    if (resolution.state !== 'resolved') throw new Error('resolved workspace provider unavailable')
    try {
      const workspace = workspaceLock()
      expect(
        (await resolution.workspace.plan({ workspace, locales: ['enUS'], maxRequirements: 1 }))
          .complete,
      ).toBe(false)
      const core = workspace.loadOrder[0]
      const active = workspace.loadOrder[2]
      if (core === undefined || active === undefined) throw new Error('workspace roots are absent')
      const duplicateLogicalRoots = {
        ...workspace,
        logicalRoots: [active, active, core],
      }
      await expect(
        resolution.workspace.plan({
          workspace: duplicateLogicalRoots,
          locales: ['enUS'],
          maxRequirements: 64,
        }),
      ).rejects.toThrow(/exactly the loadOrder roots/u)
      await expect(
        resolution.workspace.openDefinitionTable({
          snapshotId: 'stale-count-derived-id',
          maxPageSize: 1,
        }),
      ).rejects.toThrow(/stale, unknown or evicted/u)

      const contentSnapshot = async (life: number) =>
        resolution.workspace.analyze({
          workspaceId: workspace.workspaceId,
          gameId: workspace.gameId,
          documents: [
            {
              rootId: 'active',
              path: `${roots.active}/base.sc2data/gamedata/unitdata.xml`,
              text: `<Catalog><CUnit id="Marine"><LifeMax value="${String(life)}"/></CUnit></Catalog>`,
              revision: revisionId('provider-token:same-declared-revision'),
            },
          ],
          localizationDocuments: [],
          locales: ['enUS'],
          localizationKeys: [],
          queries: [{ namespace: 'Unit', entityId: 'Marine' }],
          plannedDocumentCount: 1,
          unresolvedRequirementIds: [],
          snapshotId: 'provider-token:same-resource-session',
          maxDocuments: 1,
          maxTextBytes: 4_096,
          maxEntities: 8,
          maxDepth: 8,
        })
      const first = await contentSnapshot(40)
      const second = await contentSnapshot(41)
      expect(first.snapshotId).not.toBe(second.snapshotId)
      await contentSnapshot(42)
      await contentSnapshot(43)
      await contentSnapshot(44)
      await expect(
        resolution.workspace.openDefinitionTable({
          snapshotId: first.snapshotId,
          maxPageSize: 1,
        }),
      ).rejects.toThrow(/stale, unknown or evicted/u)
    } finally {
      await resolution.release()
    }

    const sparse = new Map<string, string>([
      [
        `${roots.core}/base.sc2data/gamedata/unitdata.xml`,
        '<Catalog><CUnit id="Marine"><LifeMax value="40"/></CUnit></Catalog>',
      ],
    ])
    const resources = createResourceSession({
      origin: memoryOrigin(sparse),
      revision: revisionId('provider-token:resolved-data-sparse-v1'),
    })
    const result = await analyzeResolvedDataWorkspace({
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'resolved-data-missing', classes: [] },
      budgets: activationBudget,
      workspace: workspaceLock(),
      resources,
      locales: ['enUS'],
      queries: [{ namespace: 'Unit', entityId: 'Marine' }],
      limits: {
        maxRequirements: 512,
        maxDocumentBytes: 65_536,
        maxTextBytes: 1_048_576,
        maxEntities: 1_024,
        maxDepth: 32,
        maxPageSize: 2,
      },
    })
    expect(
      result.state,
      result.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
    ).toBe('resolved')
    if (result.state === 'resolved') {
      expect(result.snapshot.complete).toBe(true)
      expect(result.snapshot.diagnostics).not.toContainEqual(
        expect.objectContaining({
          code: 'org.modkitx.blizzard.starcraft2/data-plan-resources-unresolved',
        }),
      )
      await result.release()
    }
    await resources.dispose()
  })
})

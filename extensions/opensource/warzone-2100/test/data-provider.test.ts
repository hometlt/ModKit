import { describe, expect, it } from 'vitest'
import { DATA_CATALOG_ANALYSIS_CONTRACT, RESOLVED_DATA_WORKSPACE_CONTRACT } from '@modkitx-x3/sdk'
import {
  analyzeWarzoneData,
  analyzeWarzoneResolvedData,
  createProvider,
  planWarzoneDataWorkspace,
} from '../src/data-provider.js'

const GAME_ID = 'org.modkitx/warzone-2100'

const document = (rootId: string, path: string, value: unknown) => ({
  rootId,
  path,
  text: JSON.stringify(value),
})

const documents = [
  document('base', 'base/stats/templates.json', {
    ConstructionDroid: {
      id: 'ConstructionDroid',
      name: 'Construction unit',
      body: 'Body1REC',
      construct: 'Spade1Mk1',
      propulsion: 'wheeled01',
      type: 'DROID',
    },
  }),
  document('mp', 'mp/stats/templates.json', {
    ConstructionDroid: {
      id: 'ConstructionDroid',
      name: 'Multiplayer construction unit',
      body: 'Body1REC',
      construct: 'Spade1Mk1',
      propulsion: 'wheeled01',
      type: 'DROID',
    },
  }),
  document('mp', 'mp/stats/structure.json', {
    A0PowerGenerator: {
      id: 'A0PowerGenerator',
      name: 'Power generator',
      width: 2,
      breadth: 2,
      height: 1,
      structureModel: ['blpower0.pie'],
      type: 'POWER_GEN',
    },
  }),
  document('base', 'base/stats/features.json', {
    TreeSnow1: {
      id: 'TreeSnow1',
      name: 'Snow tree',
      width: 1,
      breadth: 1,
      model: 'tree1.pie',
      type: 'TREE',
    },
  }),
  document('base', 'base/stats/body.json', {
    Body1REC: {
      id: 'Body1REC',
      name: 'Viper',
      model: 'drlbod01.pie',
    },
  }),
  document('base', 'base/stats/construction.json', {
    Spade1Mk1: {
      id: 'Spade1Mk1',
      name: 'Truck',
      sensorModel: 'trlcon.pie',
    },
  }),
  document('base', 'base/stats/propulsion.json', {
    wheeled01: {
      id: 'wheeled01',
      name: 'Wheels',
      model: 'prlwhl1.pie',
    },
  }),
]

const request = {
  workspaceId: 'warzone-data-test',
  gameId: GAME_ID,
  documents,
  queries: [
    { namespace: 'warzone.templates', entityId: 'ConstructionDroid' },
    { namespace: 'warzone.structures', entityId: 'A0PowerGenerator' },
    { namespace: 'warzone.features', entityId: 'TreeSnow1' },
  ],
  maxDocuments: 16,
  maxTextBytes: 1_000_000,
  maxEntities: 1_000,
  maxDepth: 32,
}

describe('Warzone 2100 data provider', () => {
  it('plans map definitions and the six component tables required by their binding chains', async () => {
    const plan = await planWarzoneDataWorkspace({
      workspace: {
        schemaVersion: 1,
        workspaceId: 'warzone-data-test',
        gameId: GAME_ID,
        activeRootId: 'mp',
        sources: [],
        loadOrder: [
          { rootId: 'base', sourcePath: 'base', dependencies: [] },
          { rootId: 'mp', sourcePath: 'mp', dependencies: [] },
        ],
      },
      locales: ['enUS'],
      maxRequirements: 32,
    })

    expect(plan.complete).toBe(true)
    expect(plan.requirements).toHaveLength(18)
    expect(plan.requirements.map(item => item.path)).toEqual([
      'base/stats/templates.json',
      'base/stats/structure.json',
      'base/stats/features.json',
      'base/stats/body.json',
      'base/stats/construction.json',
      'base/stats/ecm.json',
      'base/stats/propulsion.json',
      'base/stats/sensor.json',
      'base/stats/weapons.json',
      'mp/stats/templates.json',
      'mp/stats/structure.json',
      'mp/stats/features.json',
      'mp/stats/body.json',
      'mp/stats/construction.json',
      'mp/stats/ecm.json',
      'mp/stats/propulsion.json',
      'mp/stats/sensor.json',
      'mp/stats/weapons.json',
    ])
  })

  it('resolves map object definitions with deterministic later-root overrides', async () => {
    const snapshot = await analyzeWarzoneData(request)

    expect(snapshot.entityCount).toBe(6)
    expect(snapshot.entities).toHaveLength(3)
    expect(snapshot.entities.find(item => item.namespace === 'warzone.templates')).toMatchObject({
      namespace: 'warzone.templates',
      entityId: 'ConstructionDroid',
      fields: { name: 'Multiplayer construction unit' },
      sources: [{ rootId: 'base' }, { rootId: 'mp' }],
    })
    expect(snapshot.complete).toBe(true)
  })

  it('publishes bounded live schema, definition and relation sources', async () => {
    const snapshot = await analyzeWarzoneResolvedData({
      ...request,
      localizationDocuments: [],
      locales: ['enUS'],
      localizationKeys: [],
      plannedDocumentCount: 18,
      unresolvedRequirementIds: Array.from({ length: 11 }, (_, index) => `missing:${index}`),
    })
    expect(snapshot.definitions).toHaveLength(6)
    expect(snapshot.entities).toHaveLength(3)
    expect(snapshot.relations.length).toBeGreaterThan(0)
    expect(snapshot.complete).toBe(true)

    const lease = await createProvider({
      contract: RESOLVED_DATA_WORKSPACE_CONTRACT,
      major: 1,
    })
    const remembered = await lease.value.analyze({
      ...request,
      localizationDocuments: [],
      locales: ['enUS'],
      localizationKeys: [],
      plannedDocumentCount: 18,
      unresolvedRequirementIds: Array.from({ length: 11 }, (_, index) => `missing:${index}`),
    })
    const definitions = await lease.value.openDefinitionTable({
      snapshotId: remembered.snapshotId,
      maxPageSize: 10,
    })
    expect(await definitions.value.shape()).toMatchObject({ rows: 6, columns: 6 })
    const rows = await definitions.value.rows({ kind: 'range', from: 0, count: 6 })
    expect(rows.items.map(item => item.cells[2])).toContain('Body1REC')
    const relations = await lease.value.openRelations({
      snapshotId: remembered.snapshotId,
      maxPageSize: 10,
    })
    expect((await relations.value.summary()).totalEdges).toBeGreaterThan(0)
    await relations.release()
    await definitions.release()
    await lease.release()
  })

  it('offers both catalog and resolved-workspace contracts', async () => {
    const catalog = await createProvider({ contract: DATA_CATALOG_ANALYSIS_CONTRACT, major: 1 })
    expect(catalog.value.gameIds).toEqual([GAME_ID])
    await catalog.release()
  })
})

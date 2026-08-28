import { describe, expect, it } from 'vitest'
import { proves } from '@modkitx-x3/testkit'
import { createCandidateWorldSceneLease } from '../../../../packages/host/src/maps/world-source.js'
import { analyzeWarzoneResolvedData } from '../src/data-provider.js'
import { WARZONE_PORTABLE_OBJECT_RESOURCE_CONTRACT } from '../src/data-resource-bindings.js'
import {
  analyzeWarzoneMapWorkspace,
  openWarzoneMap,
  planWarzoneMap,
  WARZONE_WORLD_SCENE_SOURCE_CONTRACT,
} from '../src/map-provider.js'

const GAME_ID = 'org.modkitx/warzone-2100'

function gameMap(width = 2, height = 3): Uint8Array {
  const count = width * height
  const bytes = new Uint8Array(16 + count * 3 + 8 + 4)
  bytes.set(new TextEncoder().encode('map '), 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(4, 10, true)
  view.setUint32(8, width, true)
  view.setUint32(12, height, true)
  let offset = 16
  for (let index = 0; index < count; index += 1) {
    view.setUint16(offset, 100 + index, true)
    view.setUint8(offset + 2, index + 1)
    offset += 3
  }
  view.setUint32(offset, 1, true)
  view.setUint32(offset + 4, 1, true)
  bytes.set([0, 0, width - 1, height - 1], offset + 8)
  return bytes
}

const limits = Object.freeze({
  maxDocuments: 4,
  maxDocumentBytes: 1_000_000,
  maxTotalBytes: 2_000_000,
  maxObjects: 1_000,
  maxRegions: 1_000,
  maxTerrainCells: 65_536,
  maxTerrainSamples: 65_536,
  maxDepth: 32,
  maxDiagnostics: 100,
})

function request(bytes = gameMap()) {
  return {
    workspaceId: 'warzone-workspace',
    gameId: GAME_ID,
    mapId: 'multiplay/maps/fixture',
    documents: [{ path: 'multiplay/maps/fixture/game.map', bytes }],
    ...limits,
  }
}

const jsonBytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

const catalogDocument = (path: string, value: unknown) => ({
  rootId: 'base',
  path: `base/stats/${path}`,
  text: JSON.stringify(value),
})

async function catalogWithDefinitionsOnly() {
  const documents = [
    catalogDocument('templates.json', {
      ConstructorDroid: {
        id: 'ConstructorDroid',
        body: 'Body1REC',
        construct: 'Spade1Mk1',
        propulsion: 'wheeled01',
      },
    }),
    catalogDocument('structure.json', {
      A0PowerGenerator: {
        id: 'A0PowerGenerator',
        baseModel: 'blbpower.pie',
        structureModel: ['blpower0.pie'],
      },
    }),
    catalogDocument('features.json', {
      TreeSnow1: { id: 'TreeSnow1', model: 'mistree1.pie' },
    }),
    catalogDocument('body.json', {
      Body1REC: { id: 'Body1REC', model: 'drlbod01.pie' },
    }),
    catalogDocument('construction.json', {
      Spade1Mk1: { id: 'Spade1Mk1', sensorModel: 'trlcon.pie' },
    }),
    catalogDocument('propulsion.json', {
      wheeled01: { id: 'wheeled01', model: 'prlwhl1.pie' },
    }),
  ]
  return analyzeWarzoneResolvedData({
    workspaceId: 'warzone-workspace',
    gameId: GAME_ID,
    documents,
    queries: [],
    maxDocuments: documents.length,
    maxTextBytes: 1_000_000,
    maxEntities: 1_000,
    maxDepth: 32,
    localizationDocuments: [],
    locales: [],
    localizationKeys: [],
    plannedDocumentCount: documents.length,
    unresolvedRequirementIds: [],
  })
}

const placedObjectDocuments = () => [
  { path: 'multiplay/maps/fixture/game.map', bytes: gameMap() },
  {
    path: 'multiplay/maps/fixture/droid.json',
    bytes: jsonBytes({
      droid_0010: {
        id: 10,
        position: [128, 256, 999],
        rotation: [65_535, 0, 0],
        startpos: 1,
        template: 'ConstructorDroid',
      },
    }),
  },
  {
    path: 'multiplay/maps/fixture/struct.json',
    bytes: jsonBytes({
      version: 2,
      structures: [
        {
          name: 'A0PowerGenerator',
          position: [384, 512],
          rotation: 32_768,
          player: 'scavenger',
          modules: 2,
        },
      ],
    }),
  },
  {
    path: 'multiplay/maps/fixture/feature.json',
    bytes: jsonBytes({
      feature_0007: {
        name: 'TreeSnow1',
        position: [640, 768, 123],
        rotation: [0, 0, 0],
      },
    }),
  },
]

describe('Warzone 2100 semantic map provider', () => {
  it('parses every direct height and publishes measured native and canonical transforms', async () => {
    const semantic = await openWarzoneMap(request())
    expect(semantic.terrain).toMatchObject({
      version: 10,
      width: 2,
      height: 3,
      cellCount: 6,
      minimumHeightBase: 2,
      maximumHeightBase: 12,
      trailingBytes: 0,
    })
    expect(semantic.terrain?.samples).toEqual([
      { x: 0, y: 0, heightBase: 2, heightAdjustment: 0, mask: 100 },
      { x: 1, y: 0, heightBase: 4, heightAdjustment: 0, mask: 101 },
      { x: 0, y: 1, heightBase: 6, heightAdjustment: 0, mask: 102 },
      { x: 1, y: 1, heightBase: 8, heightAdjustment: 0, mask: 103 },
      { x: 0, y: 2, heightBase: 10, heightAdjustment: 0, mask: 104 },
      { x: 1, y: 2, heightBase: 12, heightAdjustment: 0, mask: 105 },
    ])

    const snapshot = await analyzeWarzoneMapWorkspace({
      ...request(),
      snapshotId: 'warzone-snapshot',
      unresolvedRequirementIds: [],
      requiredRequirementIds: ['warzone-game-map'],
    })
    expect(snapshot.terrainTransform).toMatchObject({
      descriptorVersion: 10,
      source: { format: 'warzone-game-map', heightEncoding: 'uint8-times-2' },
      heightMap: { dim: [2, 3], scale: { x: 128, y: 128, z: 1 } },
      mapping: { vertical: 'direct-base-times-scale-plus-offset' },
      bounds: {
        minimum: { x: 0, y: 0, z: 2 },
        maximum: { x: 128, y: 256, z: 12 },
      },
    })
    expect(snapshot.uvwTransform).toMatchObject({
      basis: { sourceUnit: 'warzone-world-unit', unitsPerCell: 128 },
      heightfield: { columns: 2, rows: 3, cellSize: 128, origin: [0, 0, -256] },
      bounds: {
        minimum: { x: 0, y: 2, z: -256 },
        maximum: { x: 128, y: 12, z: 0 },
      },
      proof: {
        method: 'official-reference-differential',
        tupleCount: 4_608,
      },
    })
    expect(snapshot.worldCandidate.contract).toBe(WARZONE_WORLD_SCENE_SOURCE_CONTRACT)
    proves({
      contributionId: 'org.modkitx.opensource/warzone2100-map-semantic',
      operation: 'inspect',
      note: 'the semantic provider exposes every bounded game.map terrain sample and transform',
    })
    proves({
      contributionId: 'org.modkitx.opensource/warzone2100-map-semantic',
      operation: 'read',
      note: 'the semantic provider reads direct Warzone height samples without invented values',
    })
  })

  it('plans one confined game.map read and refuses malformed gateways', async () => {
    const plan = await planWarzoneMap({
      workspace: {
        schemaVersion: 1,
        workspaceId: 'warzone-workspace',
        gameId: GAME_ID,
        activeRootId: 'active',
        loadOrder: [{ rootId: 'active', sourcePath: 'multiplay/maps/fixture', kind: 'map' }],
      },
      maxRequirements: 1,
    })
    expect(plan.requirements).toEqual([
      {
        requirementId: 'warzone-game-map',
        path: 'multiplay/maps/fixture/game.map',
        kind: 'terrain-height',
        required: true,
      },
    ])

    const malformed = gameMap()
    new DataView(malformed.buffer).setUint32(16 + 6 * 3, 2, true)
    const result = await openWarzoneMap(request(malformed))
    expect(result.complete).toBe(false)
    expect(result.diagnostics[0]?.code).toBe(
      'org.modkitx.opensource.warzone2100/map-document-invalid',
    )
    proves({
      contributionId: 'org.modkitx.opensource/warzone2100-map-semantic',
      operation: 'validate',
      note: 'malformed gateway tables are refused instead of being silently truncated',
    })
  })

  it('reads official version 1/2 object JSON without treating the ignored third value as height', async () => {
    const semantic = await openWarzoneMap({
      ...request(),
      documents: [
        { path: 'multiplay/maps/fixture/game.map', bytes: gameMap() },
        {
          path: 'multiplay/maps/fixture/droid.json',
          bytes: jsonBytes({
            droid_0010: {
              id: 10,
              position: [128, 256, 999],
              rotation: [65_535, 0, 0],
              startpos: 1,
              template: 'ConstructorDroid',
            },
          }),
        },
        {
          path: 'multiplay/maps/fixture/struct.json',
          bytes: jsonBytes({
            version: 2,
            structures: [
              {
                name: 'A0PowerGenerator',
                position: [384, 512],
                rotation: 32_768,
                player: 'scavenger',
                modules: 2,
              },
            ],
          }),
        },
        {
          path: 'multiplay/maps/fixture/feature.json',
          bytes: jsonBytes({
            feature_0007: {
              name: 'TreeSnow1',
              position: [640, 768, 123],
              rotation: [0, 0, 0],
            },
          }),
        },
      ],
    })

    expect(semantic.complete).toBe(true)
    expect(semantic.objects).toEqual([
      {
        kind: 'unit',
        objectId: 4_294_967_306,
        sourceObjectId: 10,
        sourceKey: 'droid_0010',
        position: { x: 128, y: 256, z: 0 },
        sourcePositionDimensions: 2,
        rotation: 65_535,
        nativeRotationUnit: 'uint16-turn',
        typeId: 'ConstructorDroid',
        player: 1,
        name: 'droid_0010',
        catalog: { ref: { namespace: 'warzone.templates', entityId: 'ConstructorDroid' } },
      },
      {
        kind: 'structure',
        objectId: 8_589_934_593,
        sourceKey: 'structures[0]',
        position: { x: 384, y: 512, z: 0 },
        sourcePositionDimensions: 2,
        rotation: 32_768,
        nativeRotationUnit: 'uint16-turn',
        typeId: 'A0PowerGenerator',
        player: -1,
        modules: 2,
        name: 'structures[0]',
        catalog: { ref: { namespace: 'warzone.structures', entityId: 'A0PowerGenerator' } },
      },
      {
        kind: 'feature',
        objectId: 12_884_901_895,
        sourceKey: 'feature_0007',
        position: { x: 640, y: 768, z: 0 },
        sourcePositionDimensions: 2,
        rotation: 0,
        nativeRotationUnit: 'uint16-turn',
        typeId: 'TreeSnow1',
        name: 'feature_0007',
        catalog: { ref: { namespace: 'warzone.features', entityId: 'TreeSnow1' } },
      },
    ])
    expect(semantic.catalogQueries).toEqual([
      { namespace: 'warzone.templates', entityId: 'ConstructorDroid' },
      { namespace: 'warzone.structures', entityId: 'A0PowerGenerator' },
      { namespace: 'warzone.features', entityId: 'TreeSnow1' },
    ])
    expect(
      semantic.diagnostics.filter(
        item => item.code === 'org.modkitx.opensource.warzone2100/map-object-elevation-unavailable',
      ),
    ).toHaveLength(3)
    proves({
      contributionId: 'org.modkitx.opensource/warzone2100-map-semantic',
      operation: 'inspect',
      note: 'official version 1/2 static map objects retain exact x/y, rotation and catalog joins',
    })
  })

  it('projects definitions-only catalog model ids into semantic objects and world pages', async () => {
    const catalog = await catalogWithDefinitionsOnly()
    expect(catalog.entities).toEqual([])
    expect(catalog.definitions).toHaveLength(6)
    const snapshot = await analyzeWarzoneMapWorkspace({
      ...request(),
      documents: placedObjectDocuments(),
      catalog,
      snapshotId: 'warzone-resource-snapshot',
      unresolvedRequirementIds: [],
      requiredRequirementIds: ['warzone-game-map'],
    })

    expect(snapshot.semantic.resolvedCatalogObjects).toBe(3)
    expect(snapshot.semantic.warzoneResourceBindings).toEqual({
      schemaVersion: 1,
      contract: WARZONE_PORTABLE_OBJECT_RESOURCE_CONTRACT,
      objects: 3,
      definitionBoundObjects: 3,
      modelBoundObjects: 3,
      componentBindings: 3,
      logicalModelReferences: 6,
      materialTextureReferences: 0,
      modelReferencesComplete: true,
      materialReferencesComplete: false,
      complete: false,
    })
    expect(
      snapshot.semantic.objects.flatMap(object => object.warzoneResources.models),
    ).toHaveLength(6)
    expect(
      snapshot.semantic.objects.every(
        object =>
          object.warzoneResources.contract === WARZONE_PORTABLE_OBJECT_RESOURCE_CONTRACT &&
          object.warzoneResources.models.every(
            model =>
              model.state === 'logical-only' &&
              model.material.state === 'pie-document-unavailable' &&
              model.material.textures.length === 0,
          ),
      ),
    ).toBe(true)
    expect(snapshot.semantic.diagnostics).toContainEqual(
      expect.objectContaining({ code: expect.stringMatching(/material-references-unavailable$/u) }),
    )
    expect(snapshot.worldCandidate.unknownFacets).not.toContain('object-model-bindings')
    expect(snapshot.worldCandidate.unknownFacets).toEqual(
      expect.arrayContaining([
        'object-model-archive-path-resolution',
        'object-pie-texture-directives',
        'runtime-model-selection',
        'runtime-material-semantics',
      ]),
    )

    const world = createCandidateWorldSceneLease(snapshot, [], 16)
    try {
      const info = await world.value.info()
      const objectsFacet = info.facets.find(facet => facet.facet === 'objects')
      if (objectsFacet === undefined) throw new Error('world objects facet is missing')
      const page = await world.value.page({
        facet: 'objects',
        layerId: objectsFacet.layerId,
        limit: 16,
      })
      expect(page.items).toHaveLength(3)
      expect(page.items[0]).toMatchObject({
        facet: 'objects',
        warzoneResources: {
          contract: WARZONE_PORTABLE_OBJECT_RESOURCE_CONTRACT,
          modelReferencesComplete: true,
          materialReferencesComplete: false,
        },
      })
    } finally {
      await world.release()
    }
    expect(JSON.stringify(snapshot)).not.toMatch(/file:\/\/|"[A-Za-z]:[\\/]/u)
  })

  it('fails closed when definitions and queried entities conflict for one identity', async () => {
    const catalog = await catalogWithDefinitionsOnly()
    const feature = catalog.definitions?.find(
      entity => entity.namespace === 'warzone.features' && entity.entityId === 'TreeSnow1',
    )
    if (feature === undefined) throw new Error('fixture feature definition is missing')
    const conflictingCatalog = {
      ...catalog,
      entities: [{ ...feature, fields: { ...feature.fields, model: 'conflict.pie' } }],
    }
    const semantic = await openWarzoneMap({
      ...request(),
      documents: [placedObjectDocuments()[0], placedObjectDocuments()[3]],
      catalog: conflictingCatalog,
    })

    expect(semantic.resolvedCatalogObjects).toBe(0)
    expect(semantic.complete).toBe(false)
    expect(semantic.objects[0]).toMatchObject({
      catalog: { ref: { namespace: 'warzone.features', entityId: 'TreeSnow1' } },
      warzoneResources: { state: 'definition-collision', complete: false },
    })
    expect(semantic.diagnostics).toContainEqual(
      expect.objectContaining({ code: expect.stringMatching(/catalog-entity-collision$/u) }),
    )
  })

  it('keeps logical refs but refuses completeness for a partial resolved definition', async () => {
    const catalog = await catalogWithDefinitionsOnly()
    const partialCatalog = {
      ...catalog,
      definitions: catalog.definitions?.map(entity =>
        entity.namespace === 'warzone.features' && entity.entityId === 'TreeSnow1'
          ? { ...entity, complete: false }
          : entity,
      ),
    }
    const semantic = await openWarzoneMap({
      ...request(),
      documents: [placedObjectDocuments()[0], placedObjectDocuments()[3]],
      catalog: partialCatalog,
    })

    expect(semantic.resolvedCatalogObjects).toBe(1)
    expect(semantic.objects[0]).toMatchObject({
      warzoneResources: {
        state: 'partial',
        modelReferencesComplete: false,
        materialReferencesComplete: false,
      },
    })
    expect(semantic.warzoneResourceBindings).toMatchObject({
      definitionBoundObjects: 1,
      modelBoundObjects: 0,
      logicalModelReferences: 1,
      modelReferencesComplete: false,
      complete: false,
    })
    expect(semantic.diagnostics).toContainEqual(
      expect.objectContaining({ code: expect.stringMatching(/map-object-definition-partial$/u) }),
    )
  })
})

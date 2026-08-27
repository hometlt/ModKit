import { describe, expect, it } from 'vitest'
import { proves } from '@modkitx-x3/testkit'
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
})

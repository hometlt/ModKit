import { describe, expect, it } from 'vitest'
import {
  MAP_PREVIEW_PREPARATION_CONTRACT,
  MAP_PREVIEW_PREPARATION_MATCHER_PROFILE,
  MAP_SEMANTIC_ANALYSIS_CONTRACT,
  MAP_SEMANTIC_MATCHER_PROFILE,
  RESOLVED_MAP_WORKSPACE_CONTRACT,
  WORLD_SCENE_SOURCE_CONTRACT,
  mapLayerWindow,
  type MapLayerDescriptor,
  type MapSemanticSnapshot,
} from '@modkit/sdk/maps'

describe('game-neutral semantic map contract', () => {
  it('publishes stable service and matcher coordinates without game-specific ids', () => {
    expect(MAP_SEMANTIC_ANALYSIS_CONTRACT).toBe('common.map/semantic-analysis')
    expect(MAP_PREVIEW_PREPARATION_CONTRACT).toBe('common.map/preview-preparation')
    expect(RESOLVED_MAP_WORKSPACE_CONTRACT).toBe('common.map/resolved-workspace')
    expect(WORLD_SCENE_SOURCE_CONTRACT).toBe('common.view/world-scene-source')
    expect(MAP_SEMANTIC_MATCHER_PROFILE).toBe('modkit/map-semantic-matcher')
    expect(MAP_PREVIEW_PREPARATION_MATCHER_PROFILE).toBe('modkit/map-preview-preparation-matcher')
  })

  it('keeps catalog discovery explicit before a map can claim complete schema bindings', () => {
    const snapshot = {
      schemaVersion: 1,
      workspaceId: 'workspace',
      gameId: 'example/game',
      mapId: 'example/map',
      analyzerId: 'example/analyzer',
      documentPaths: ['Objects'],
      regions: [],
      objects: [],
      catalogQueries: [{ namespace: 'Unit', entityId: 'Infantry' }],
      resolvedCatalogObjects: 0,
      diagnostics: [],
      complete: false,
    } satisfies MapSemanticSnapshot

    expect(snapshot.catalogQueries).toEqual([{ namespace: 'Unit', entityId: 'Infantry' }])
    expect(snapshot.complete).toBe(false)
  })
})

describe('map layer windows', () => {
  const layer: MapLayerDescriptor = {
    id: 'height', label: 'Height', meaning: 'height', width: 4, height: 3, minimum: 0, maximum: 9, editable: true,
  }

  it('reads the whole layer or a window of all four fields', () => {
    expect(mapLayerWindow(layer, { layer: 'height' })).toEqual({ x: 0, y: 0, width: 4, height: 3 })
    expect(mapLayerWindow(layer, { layer: 'height', x: 1, y: 2, width: 3, height: 1 })).toEqual({ x: 1, y: 2, width: 3, height: 1 })
    expect(() => mapLayerWindow(layer, { layer: 'height', x: 1, y: 1 })).toThrow(/all of x, y, width and height/u)
    expect(() => mapLayerWindow(layer, { layer: 'height', x: 2, y: 0, width: 3, height: 1 })).toThrow(/leaves the 4x3 layer/u)
    expect(() => mapLayerWindow(layer, { layer: 'cliffs' })).toThrow(/names layer cliffs/u)
  })

  it('writes a whole grid or a placed window of in-range integers', () => {
    expect(mapLayerWindow(layer, { layer: 'height', width: 4, height: 3, values: Array(12).fill(0) })).toEqual({ x: 0, y: 0, width: 4, height: 3 })
    expect(mapLayerWindow(layer, { layer: 'height', x: 3, y: 1, width: 1, height: 2, values: [9, 0] })).toEqual({ x: 3, y: 1, width: 1, height: 2 })
    expect(() => mapLayerWindow(layer, { layer: 'height', x: 1, width: 1, height: 1, values: [0] })).toThrow(/x and y go together/u)
    expect(() => mapLayerWindow(layer, { layer: 'height', width: 1, height: 1, values: [0, 0] })).toThrow(/needs 1 values/u)
    expect(() => mapLayerWindow(layer, { layer: 'height', width: 1, height: 1, values: [10] })).toThrow(/from 0 to 9/u)
    expect(() => mapLayerWindow(layer, { layer: 'height', width: 1, height: 1, values: [0.5] })).toThrow(/from 0 to 9/u)
    expect(() => mapLayerWindow({ ...layer, editable: false }, { layer: 'height', width: 1, height: 1, values: [0] })).toThrow(/read-only/u)
  })
})

import { describe, expect, it } from 'vitest'
import {
  MAP_PREVIEW_PREPARATION_CONTRACT,
  MAP_PREVIEW_PREPARATION_MATCHER_PROFILE,
  MAP_SEMANTIC_ANALYSIS_CONTRACT,
  MAP_SEMANTIC_MATCHER_PROFILE,
  RESOLVED_MAP_WORKSPACE_CONTRACT,
  WORLD_SCENE_SOURCE_CONTRACT,
  type MapSemanticSnapshot,
} from '@modkitx-x3/sdk/maps'

describe('game-neutral semantic map contract', () => {
  it('publishes stable service and matcher coordinates without game-specific ids', () => {
    expect(MAP_SEMANTIC_ANALYSIS_CONTRACT).toBe('common.map/semantic-analysis')
    expect(MAP_PREVIEW_PREPARATION_CONTRACT).toBe('common.map/preview-preparation')
    expect(RESOLVED_MAP_WORKSPACE_CONTRACT).toBe('common.map/resolved-workspace')
    expect(WORLD_SCENE_SOURCE_CONTRACT).toBe('common.view/world-scene-source')
    expect(MAP_SEMANTIC_MATCHER_PROFILE).toBe('org.modkitx/map-semantic-matcher')
    expect(MAP_PREVIEW_PREPARATION_MATCHER_PROFILE).toBe(
      'org.modkitx/map-preview-preparation-matcher',
    )
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

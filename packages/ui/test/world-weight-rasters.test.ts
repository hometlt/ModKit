import { expect, it } from 'vitest'
import type {
  CandidateWorldSceneInfo,
  CandidateWorldSceneSource,
  WorldSceneLayerItem,
} from '@modkit/sdk/maps'
import { WORLD_MAX_TERRAIN_WEIGHT_RASTERS } from '@modkit/scene/world'
import { inspectCandidateWorld } from '../src/world/index.js'

/** A world whose ground blends `count` weight rasters, one material each. */
function world(count: number): CandidateWorldSceneSource {
  const layer: WorldSceneLayerItem = {
    facet: 'layers',
    id: 'layer:materials',
    layerId: 'layer:materials',
    kind: 'terrain-materials',
    state: 'available',
    itemCount: 0,
    lods: ['raster-exact'],
    weightRasters: Array.from({ length: count }, (_, index) => ({
      resourceId: `weights-${String(index)}`,
      width: 2,
      height: 2,
      materialIds: [`ground-${String(index)}`],
      encoding: 'rgba8-unorm' as const,
      normalization: 'sum' as const,
    })),
  }
  const info = {
    contract: 'example.publisher/world-source',
    major: 1,
    maturity: 'publisher-candidate',
    snapshotId: `rasters-${String(count)}`,
    mapId: 'rasters',
    coordinateSpaces: [],
    crossSpaceTransforms: [],
    bounds: [],
    facets: [
      {
        facet: 'terrain-materials',
        layerId: layer.layerId,
        state: 'available',
        itemCount: 0,
        lods: ['raster-exact'],
      },
    ],
    provenance: [],
    unknownFacets: [],
    lossPolicy: 'explicit-partial',
    complete: true,
  } as unknown as CandidateWorldSceneInfo
  return {
    contract: info.contract,
    major: 1,
    snapshotId: info.snapshotId,
    info: async () => info,
    page: async request => ({
      snapshotId: info.snapshotId,
      facet: request.facet,
      state: 'available',
      items: request.facet === 'layers' ? [layer] : [],
    }),
  }
}

it('says when the ground blends more weight rasters than the world draws', async () => {
  const codes = async (count: number) =>
    (
      await inspectCandidateWorld(world(count), { maxLayers: 2, maxItemsPerLayer: 8 })
    ).terrainTextureDiagnostics?.map(item => item.code)
  expect(await codes(WORLD_MAX_TERRAIN_WEIGHT_RASTERS)).not.toContain(
    'x3.ui/world-terrain-weight-rasters-capped',
  )
  expect(await codes(WORLD_MAX_TERRAIN_WEIGHT_RASTERS + 1)).toContain(
    'x3.ui/world-terrain-weight-rasters-capped',
  )
})
